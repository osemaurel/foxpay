import { requireEnv } from './admin.ts'

/**
 * Intégration SasPay — API v1, endpoint « softpay ».
 *
 * Écrit contre la documentation officielle (docs.saspay.me).
 *
 * Troisième processeur, choisi pour varier les routes : quand un opérateur
 * tombe chez l'un, un autre peut souvent encore encaisser. Il ne débloque
 * aucun pays nouveau — les quatorze que vend la boutique sont déjà couverts —
 * mais il donne une seconde ou une troisième main sur chacun.
 *
 * Trois choses le distinguent des deux autres, et expliquent ce fichier :
 *
 *   - il **n'exige aucune adresse IP déclarée**, contrairement à SebPay : les
 *     appels partent en direct, sans passer par le relais facturé à la requête ;
 *   - les réponses sont enveloppées dans `{ success, data, code }`, et un
 *     HTTP 200 ne suffit pas — `success` porte le verdict ;
 *   - l'idempotence est explicite, par un en-tête `Idempotency-Key` que nous
 *     fournissons. Sans lui, un simple retry réseau pousse une **seconde**
 *     demande de paiement sur le téléphone de l'acheteur. On envoie donc
 *     toujours l'identifiant de la commande.
 */

const BASE = 'https://api.saspay.me/api/v1'

function headers(idempotence?: string): HeadersInit {
  const base: Record<string, string> = {
    Authorization: `Bearer ${requireEnv('SASPAY_API_KEY')}`,
    'Content-Type': 'application/json',
  }
  if (idempotence) base['Idempotency-Key'] = idempotence
  return base
}

export class SasPayError extends Error {
  constructor(
    readonly status: number,
    /** Code métier stable (`invalid_method`, `no_route_available`…), si fourni. */
    readonly code: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'SasPayError'
  }
}

/**
 * Déballe l'enveloppe commune `{ success, data, code }`.
 *
 * Le champ `error` prend deux formes : un objet métier `{message, code}`, ou un
 * dictionnaire de validation champ par champ. On aplatit le second pour que
 * l'appelant n'ait jamais qu'une chaîne à afficher ou à journaliser.
 */
async function appel<T>(chemin: string, init: RequestInit = {}, idempotence?: string): Promise<T> {
  const res = await fetch(`${BASE}${chemin}`, { ...init, headers: headers(idempotence) })
  const texte = await res.text()

  let corps: {
    success?: boolean
    data?: T
    error?: unknown
    message?: string
  }

  try {
    corps = JSON.parse(texte)
  } catch {
    throw new SasPayError(res.status, null, `Réponse SasPay illisible : ${texte.slice(0, 300)}`)
  }

  if (!res.ok || corps.success === false) {
    const { code, message } = lireErreur(corps.error, corps.message, texte)
    throw new SasPayError(res.status, code, message)
  }

  // Les réponses de création ne sont pas enveloppées de la même façon que les
  // lectures : `data` est absent et la charge utile est à la racine.
  return (corps.data ?? (corps as unknown)) as T
}

function lireErreur(
  erreur: unknown,
  message: string | undefined,
  brut: string,
): { code: string | null; message: string } {
  if (erreur && typeof erreur === 'object') {
    const objet = erreur as Record<string, unknown>

    if (typeof objet.message === 'string') {
      return { code: typeof objet.code === 'string' ? objet.code : null, message: objet.message }
    }

    // Erreur de validation : { champ: ["message"], … }
    const details = Object.entries(objet)
      .map(([champ, messages]) => `${champ} : ${[messages].flat().join(', ')}`)
      .join(' — ')

    if (details) return { code: 'validation_error', message: details }
  }

  return { code: null, message: message ?? brut.slice(0, 300) }
}

// ============================================================
// Catalogue
// ============================================================

/**
 * Un pays du référentiel. Les noms de champs sont ceux de leur réponse réelle,
 * pas ceux de la documentation : `iso_code` et non `code`, `default_currency`
 * et non `currency`, et **aucun indicatif téléphonique** — vérifié en direct
 * contre l'API.
 */
export type SasPayCountry = {
  id: string
  name: string
  /** ISO alpha-2. */
  iso_code: string
  default_currency: string
  /** Le référentiel contient des pays réservés à un usage futur (Autriche…). */
  is_active: boolean
}

export type SasPayNetwork = {
  id: string
  name: string
  /** Ce qu'attend `network` sur un paiement : `mtn_bj`, `wave_ci`… */
  code: string
  /** L'identifiant du pays, pas son code : une jointure à faire nous-mêmes. */
  country: string
  is_active: boolean
}

/** Catalogue public : c'est le seul endpoint qui ne demande pas de clé. */
export const listCountries = () => appel<SasPayCountry[]>('/countries/')

/**
 * Les réseaux, avec leur état réel.
 *
 * La documentation insiste : un réseau peut exister au catalogue tout en
 * n'étant routé vers aucun gateway. Proposer un opérateur inactif ferait
 * échouer le paiement au dernier moment, avec un `invalid_method`.
 */
export async function listNetworks(): Promise<SasPayNetwork[]> {
  const page = await appel<{ results?: SasPayNetwork[] } | SasPayNetwork[]>('/networks/?page_size=200')
  return Array.isArray(page) ? page : (page.results ?? [])
}

// ============================================================
// Encaissement
// ============================================================

export type PaiementCree = {
  id: string
  status: string
  /** Vide dans l'immense majorité des cas : softpay pousse sans redirection. */
  checkout_url?: string
  message?: string
}

/**
 * Pousse la demande de paiement sur le téléphone de l'acheteur.
 *
 * `fee_charge_mode` est fixé à DEDUCTED : notre prix affiché inclut déjà la
 * majoration de 3 %, et laisser SasPay ajouter la sienne par-dessus ferait
 * débiter l'acheteur d'un montant supérieur à celui qu'il a vu à l'écran.
 * L'acheteur paie donc exactement le prix annoncé, et la commission est
 * prélevée sur ce que la boutique reçoit.
 */
export function creerPaiement(input: {
  /** Sert de clé d'idempotence : l'identifiant de notre commande. */
  reference: string
  amount: number
  currency: string
  /** ISO alpha-2. */
  country: string
  network: string
  phone: string
  email: string
  prenom: string
  nom: string
  description: string
}): Promise<PaiementCree> {
  return appel<PaiementCree>(
    '/payments/softpay/',
    {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount.toFixed(2),
        currency: input.currency,
        country: input.country,
        network: input.network,
        description: input.description,
        fee_charge_mode: 'DEDUCTED',
        customer: {
          email: input.email,
          first_name: input.prenom,
          last_name: input.nom,
          phone: input.phone,
        },
        // Notre identifiant de commande voyage aussi dans les métadonnées :
        // le webhook ne le renvoie pas, mais il rend le rapprochement possible
        // depuis leur tableau de bord.
        metadata: { order_id: input.reference },
      }),
    },
    input.reference,
  )
}

export type EtatPaiement = {
  status: string
  /** Référence lisible côté SasPay : TXN-20260812-000512. */
  reference: string | null
  /** Identifiant chez l'opérateur, quand il est connu. */
  externalReference: string | null
}

/**
 * L'état réel du paiement. Tant qu'il est `PENDING`, SasPay redemande
 * lui-même au gateway avant de répondre — c'est donc une source de vérité,
 * pas un statut mémorisé.
 */
export async function lirePaiement(id: string): Promise<EtatPaiement> {
  const data = await appel<Record<string, unknown>>(`/payments/${encodeURIComponent(id)}/verify/`)

  return {
    status: String(data.status ?? ''),
    reference: (data.reference as string) ?? null,
    externalReference: (data.external_reference as string) ?? null,
  }
}

/** Confirme un paiement par code OTP, pour les réseaux qui l'exigent. */
export function confirmerOtp(id: string, otp: string): Promise<unknown> {
  return appel(`/payments/${encodeURIComponent(id)}/confirm-otp/`, {
    method: 'POST',
    body: JSON.stringify({ otp }),
  })
}

/** Traduit le vocabulaire SasPay vers le nôtre. */
export function lireStatut(status: string): 'paid' | 'failed' | 'pending' {
  const s = status.toUpperCase()
  if (s === 'SUCCESS') return 'paid'
  if (s === 'FAILED' || s === 'CANCELLED' || s === 'EXPIRED') return 'failed'
  return 'pending'
}

// ============================================================
// Webhook
// ============================================================

/** Cinq minutes, comme le demande la documentation. */
const TOLERANCE_S = 300

/**
 * Vérifie la signature d'un webhook.
 *
 * Deux contrôles, pas un seul. La signature seule ne suffit pas : elle ne
 * périme jamais, donc un webhook légitime intercepté resterait rejouable
 * indéfiniment. L'horodatage est inclus dans ce qui est signé, il ne peut donc
 * pas être rajeuni sans casser la signature.
 *
 * Le corps doit être celui **reçu tel quel** : le resérialiser changerait
 * l'ordre des clés ou le format des nombres, et la comparaison échouerait.
 */
export async function verifierSignature(
  corpsBrut: string,
  signature: string | null,
  horodatage: string | null,
): Promise<boolean> {
  if (!signature || !horodatage) return false

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(horodatage))
  if (!Number.isFinite(age) || age > TOLERANCE_S) return false

  const cle = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requireEnv('SASPAY_WEBHOOK_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const brut = await crypto.subtle.sign(
    'HMAC',
    cle,
    new TextEncoder().encode(`${horodatage}.${corpsBrut}`),
  )

  const attendue = Array.from(new Uint8Array(brut))
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('')

  const recue = signature.trim().toLowerCase()
  if (recue.length !== attendue.length) return false

  // Comparaison en temps constant : une comparaison ordinaire s'arrête au
  // premier caractère différent et laisse deviner la signature attendue.
  let ecart = 0
  for (let i = 0; i < attendue.length; i++) ecart |= attendue.charCodeAt(i) ^ recue.charCodeAt(i)
  return ecart === 0
}

/** L'identifiant de transaction porté par un webhook, quelle que soit sa forme. */
export function lireIdWebhook(payload: unknown): string | null {
  const data = (payload as { data?: Record<string, unknown> })?.data
  const id = data?.id
  return typeof id === 'string' ? id : null
}
