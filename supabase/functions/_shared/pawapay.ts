import { requireEnv } from './admin.ts'

/**
 * Intégration pawaPay — Merchant API v2, endpoint « checkouts ».
 *
 * Écrit contre la documentation officielle (docs.pawapay.io/v2), pas reconstitué.
 *
 * Pourquoi « checkout » et non « payment page » : le checkout garde une seule
 * référence pour tout le paiement, y compris les tentatives ratées. En mobile
 * money, un échec est banal — code PIN saisi trop tard, solde insuffisant — et
 * le client réessaie sur la même page. Avec la payment page, chaque essai créait
 * une commande orpheline chez nous.
 */

const baseUrl = () =>
  (Deno.env.get('PAWAPAY_BASE_URL') ?? 'https://api.sandbox.pawapay.io').replace(/\/+$/, '')

function headers() {
  return {
    Authorization: `Bearer ${requireEnv('PAWAPAY_API_TOKEN')}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Zone franc CFA. XOF et XAF sont tous deux arrimés à l'euro au même taux
 * (655,957), donc un prix de 15 000 vaut 15 000 dans les deux devises : le même
 * montant couvre les sept pays sans aucune conversion.
 *
 * pawaPay ne convertit jamais : il affiche le montant fourni pour le pays
 * choisi par l'acheteur. Sortir de la zone CFA imposerait donc un prix par
 * devise, ce qui est une décision commerciale, pas technique.
 */
export const CFA_ZONE = [
  { country: 'BEN', currency: 'XOF' },
  { country: 'BFA', currency: 'XOF' },
  { country: 'CIV', currency: 'XOF' },
  { country: 'SEN', currency: 'XOF' },
  { country: 'CMR', currency: 'XAF' },
  { country: 'COG', currency: 'XAF' },
  { country: 'GAB', currency: 'XAF' },
] as const

/**
 * Pays atteignables avec une devise hors zone CFA. La RDC est le seul pays de
 * la plateforme qui accepte l'USD, sur ses trois opérateurs.
 */
export const EXTRA_CURRENCY_COUNTRIES: Record<string, string[]> = {
  CDF: ['COD'],
  USD: ['COD'],
}

export type ShopCurrency = {
  currency: string
  rate: number
  decimals: number
  round_to: number
}

/**
 * Convertit le prix de référence vers une devise, avec un arrondi commercial :
 * 66 123 CDF devient 66 100 plutôt que d'afficher un montant au franc près,
 * qui a l'air d'une erreur sur une page de paiement.
 */
export function convertPrice(price: number, config: ShopCurrency): string {
  const raw = price * config.rate

  if (config.decimals > 0) return raw.toFixed(config.decimals)

  const step = Math.max(1, Math.round(config.round_to))
  // Jamais zéro : un montant nul serait refusé par pawaPay, et gratuit.
  return String(Math.max(step, Math.round(raw / step) * step))
}

/**
 * Un montant par (pays, devise). L'acheteur choisit son pays sur la page, et
 * pawaPay affiche le montant correspondant — il ne convertit jamais lui-même.
 */
export function buildAmounts(price: number, extras: ShopCurrency[] = []) {
  const amounts = CFA_ZONE.map(({ country, currency }) => ({
    country,
    currency,
    amount: String(price),
  }))

  for (const config of extras) {
    const countries = EXTRA_CURRENCY_COUNTRIES[config.currency]
    if (!countries) continue
    const amount = convertPrice(price, config)
    for (const country of countries) {
      amounts.push({ country, currency: config.currency, amount })
    }
  }

  return amounts
}

/**
 * `reason` s'affiche sur la page de paiement et pawaPay le valide strictement :
 * 4 à 22 caractères, lettres chiffres et espaces uniquement. Un titre avec une
 * apostrophe ou un tiret ferait rejeter la requête entière, d'où le nettoyage
 * plutôt qu'une simple troncature.
 */
export function sanitizeReason(text: string): string {
  const clean = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 22)
    .trim()

  return clean.length >= 4 ? clean : 'Achat en ligne'
}

export type CheckoutCreated = {
  redirectUrl: string
  checkoutCode: string
}

/** Crée un checkout et renvoie l'URL de la page de paiement hébergée. */
export async function createCheckout(input: {
  checkoutId: string
  amount: number
  returnUrl: string
  reason: string
  msisdn?: string | null
  extraCurrencies?: ShopCurrency[]
}): Promise<CheckoutCreated> {
  const reason = sanitizeReason(input.reason)

  const body: Record<string, unknown> = {
    checkoutId: input.checkoutId,
    returnUrl: input.returnUrl,
    returnMethod: 'INSTANT',
    defaultLanguage: 'fr',
    amounts: buildAmounts(input.amount, input.extraCurrencies ?? []),
    reason: { fr: reason, en: reason },
    // Entre 3 et 60 minutes. 30 laisse le temps de chercher son téléphone sans
    // laisser une commande en attente toute la journée.
    expiresAfter: 30,
  }

  if (input.msisdn) {
    body.payer = {
      type: 'MMO',
      accountDetails: {
        phoneNumber: input.msisdn,
        // Le numéro n'est qu'une suggestion : l'acheteur doit pouvoir payer
        // depuis un autre portefeuille que celui qu'il nous a donné.
        allowCustomerToOverride: true,
      },
    }
  }

  const res = await fetch(`${baseUrl()}/v2/checkouts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`pawaPay ${res.status} : ${text}`)

  const data = JSON.parse(text)

  // Un HTTP 200 ne veut pas dire accepté : le statut est dans le corps.
  if (data.status === 'REJECTED') {
    const reason = data.failureReason ?? {}
    throw new Error(
      `pawaPay a refusé le paiement (${reason.failureCode ?? 'inconnu'}) : ` +
        (reason.failureMessage ?? text),
    )
  }

  if (!data.redirectUrl) {
    // DUPLICATE_IGNORED tombe ici : le checkout existe déjà, mais la réponse
    // ne renvoie pas d'URL. On le signale plutôt que de rediriger dans le vide.
    throw new Error(`Réponse pawaPay sans redirectUrl (statut ${data.status}) : ${text}`)
  }

  return { redirectUrl: data.redirectUrl, checkoutCode: data.checkoutCode }
}

/** Statuts de cycle de vie d'un checkout, tels que documentés. */
export type CheckoutStatus =
  | 'WAITING_PAYMENT'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'

export type CheckoutState = {
  status: CheckoutStatus
  providerTransactionId: string | null
  /** Pays depuis lequel l'acheteur a effectivement payé. */
  country: string | null
  failureReason: string | null
}

/**
 * Source de vérité du paiement : on redemande l'état à pawaPay plutôt que de
 * croire le corps d'un callback, qui peut être forgé par n'importe qui.
 */
export async function getCheckout(checkoutId: string): Promise<CheckoutState | null> {
  const res = await fetch(`${baseUrl()}/v2/checkouts/${checkoutId}`, { headers: headers() })
  const text = await res.text()
  if (!res.ok) throw new Error(`pawaPay ${res.status} : ${text}`)

  const payload = JSON.parse(text)
  // La réponse est enveloppée : { status: "FOUND", data: { ... } }
  if (payload.status !== 'FOUND' || !payload.data) return null

  const data = payload.data
  const deposit = data.deposit ?? null

  return {
    status: data.status as CheckoutStatus,
    providerTransactionId: data.providerTransactionId ?? deposit?.providerTransactionId ?? null,
    country: deposit?.country ?? null,
    failureReason:
      deposit?.failureReason?.failureMessage ??
      deposit?.failureReason?.failureCode ??
      null,
  }
}

/** Extrait le checkoutId d'un callback, quelle que soit son enveloppe. */
export function extractCheckoutId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null

  const direct = (payload as Record<string, unknown>).checkoutId
  if (typeof direct === 'string') return direct

  const data = (payload as Record<string, unknown>).data
  if (data && typeof data === 'object') {
    const nested = (data as Record<string, unknown>).checkoutId
    if (typeof nested === 'string') return nested
  }
  return null
}
