import { requireEnv } from './admin.ts'

/**
 * Intégration SebPay — API v1, endpoint « collections ».
 *
 * Écrit contre la documentation officielle (new.sebpay.bj/fr/docs).
 *
 * SebPay vient compléter pawaPay, pas le remplacer : il ouvre des méthodes que
 * le compte pawaPay n'a pas — Wave en Côte d'Ivoire, Orange au Cameroun, le
 * Togo, le Burkina. Chaque méthode de paiement est routée vers l'un ou l'autre
 * depuis l'administration.
 *
 * Trois différences de fond avec pawaPay, qui expliquent les conversions
 * disséminées dans ce fichier :
 *
 *   - les pays sont en ISO alpha-2 (CI) là où pawaPay et notre base utilisent
 *     l'alpha-3 (CIV) ;
 *   - l'opérateur est identifié par son `code` (« mtn »), pas par son `slug` ;
 *   - le callback est signé en HMAC-SHA256, donc vérifiable — pawaPay n'en
 *     signe pas, ce qui nous obligeait à toujours redemander le statut.
 */

const BASE = 'https://newapi.sebpay.bj/api/v1'

function headers() {
  return {
    'X-Public-Key': requireEnv('SEBPAY_PUBLIC_KEY'),
    'X-Secret-Key': requireEnv('SEBPAY_SECRET_KEY'),
    'Content-Type': 'application/json',
  }
}

/**
 * Toutes les réponses sont enveloppées : { success, data, message }.
 * On déballe ici pour que le reste du code ne voie que la charge utile.
 */
async function appel<T>(chemin: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${chemin}`, { ...init, headers: headers() })
  const texte = await res.text()

  let enveloppe: { success?: boolean; data?: T; message?: string }
  try {
    enveloppe = JSON.parse(texte)
  } catch {
    throw new Error(`Réponse SebPay illisible (${res.status}) : ${texte.slice(0, 300)}`)
  }

  // Un HTTP 200 ne suffit pas : `success` porte le verdict, comme le `status`
  // de pawaPay. Les deux sont à vérifier séparément.
  if (!res.ok || enveloppe.success === false) {
    throw new SebPayError(res.status, enveloppe.message ?? texte.slice(0, 300))
  }

  return (enveloppe.data ?? enveloppe) as T
}

export class SebPayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SebPayError'
  }
}

// ============================================================
// Catalogue
// ============================================================

export type SebPayCountry = {
  id: string
  country_name: string
  country_code: string
  prefix: string
  currency: unknown
}

export type SebPayOperator = {
  id: string
  name: string
  /**
   * Identifiant complet, de la forme « mtn-bj ». Trompeur : la documentation
   * appelle le champ `operator` de POST /collections un « slug », mais l'envoi
   * de `mtn-bj` est refusé — « Operator not found or not configured for this
   * country ». C'est `code` qu'il faut envoyer. Vérifié contre l'API.
   */
  slug: string
  /** Ce qu'attend POST /collections. Insensible à la casse. */
  code: string
  country: unknown
  otp_required: boolean
  /** Code USSD à composer pour obtenir l'OTP, quand l'opérateur en exige un. */
  ussd_code?: string
}

export const listCountries = () => appel<SebPayCountry[]>('/countries')

/**
 * La documentation est explicite : ne pas figer la liste des opérateurs ni
 * celle des OTP, elle évolue. On l'interroge donc à chaque fois qu'on a besoin
 * de savoir quoi proposer.
 */
export const listOperators = (country?: string) =>
  appel<SebPayOperator[]>(country ? `/operators?country=${encodeURIComponent(country)}` : '/operators')

// ============================================================
// Collectes
// ============================================================

export type CollectionCreated = {
  transaction_id: string
  status: string
  external_reference: string
  amount: number
  currency: string
  /** Wave et consorts : l'acheteur doit être envoyé sur ce lien pour valider. */
  provider_link?: string | null
  message?: string
}

/**
 * Demande le paiement. `external_reference` est notre identifiant de commande :
 * il sert de clé de réconciliation, et permet de retrouver la transaction même
 * si la réponse HTTP se perd — `GET /collections/{reference}` l'accepte.
 */
export function createCollection(input: {
  amount: number
  currency: string
  phone: string
  operator: string
  country: string
  externalReference: string
  callbackUrl?: string
  otpCode?: string | null
}): Promise<CollectionCreated> {
  const body: Record<string, unknown> = {
    amount: input.amount,
    currency: input.currency,
    // Format international sans le « + ».
    phone: input.phone.replace(/\D/g, ''),
    // `code` de l'opérateur, pas son `slug` — voir SebPayOperator.
    operator: input.operator,
    country: input.country,
    external_reference: input.externalReference,
  }

  if (input.callbackUrl) body.callback_url = input.callbackUrl
  if (input.otpCode) body.otp_code = input.otpCode

  return appel<CollectionCreated>('/collections', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export type CollectionState = {
  transaction_id: string
  external_reference: string
  /** pending, approved ou rejected. */
  status: string
  amount: number
  currency: string
}

export const getCollection = (reference: string) =>
  appel<CollectionState>(`/collections/${encodeURIComponent(reference)}`)

/** Traduit le vocabulaire SebPay vers le nôtre. */
export function readStatus(status: string): 'paid' | 'failed' | 'pending' {
  const s = status.toLowerCase()
  if (s === 'approved' || s === 'success') return 'paid'
  if (s === 'rejected' || s === 'failed') return 'failed'
  return 'pending'
}

// ============================================================
// Webhook
// ============================================================

/**
 * Vérifie la signature HMAC-SHA256 du corps reçu, calculée avec la clé secrète.
 *
 * Comparaison en temps constant : une comparaison de chaînes ordinaire s'arrête
 * au premier caractère différent, ce qui laisse deviner la signature octet par
 * octet en mesurant le temps de réponse.
 */
export async function verifySignature(corps: string, signature: string | null): Promise<boolean> {
  if (!signature) return false

  const cle = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requireEnv('SEBPAY_SECRET_KEY')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const brut = await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(corps))
  const attendue = Array.from(new Uint8Array(brut))
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('')

  const recue = signature.trim().toLowerCase().replace(/^sha256=/, '')
  if (recue.length !== attendue.length) return false

  let ecart = 0
  for (let i = 0; i < attendue.length; i++) ecart |= attendue.charCodeAt(i) ^ recue.charCodeAt(i)
  return ecart === 0
}
