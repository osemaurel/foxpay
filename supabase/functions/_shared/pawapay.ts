import { requireEnv } from './admin.ts'

/**
 * Intégration pawaPay — Merchant API v2, endpoint « deposits ».
 *
 * Écrit contre la documentation officielle (docs.pawapay.io/v2).
 *
 * Pourquoi « deposits » et non la page hébergée : avec un dépôt, la demande de
 * paiement part directement vers le téléphone de l'acheteur. Il ne quitte
 * jamais la boutique — il compose son code PIN et c'est fini. En échange, c'est
 * à nous de demander le pays, le numéro et l'opérateur, et de vérifier que le
 * montant est acceptable pour cet opérateur avant d'envoyer quoi que ce soit.
 */

const baseUrl = () =>
  (Deno.env.get('PAWAPAY_BASE_URL') ?? 'https://api.sandbox.pawapay.io').replace(/\/+$/, '')

function headers() {
  return {
    Authorization: `Bearer ${requireEnv('PAWAPAY_API_TOKEN')}`,
    'Content-Type': 'application/json',
  }
}

// ============================================================
// Tarification par pays
// ============================================================

/**
 * Zone franc CFA. XOF et XAF sont tous deux arrimés à l'euro au même taux
 * (655,957) : un prix de 15 000 vaut 15 000 dans les deux devises, donc le
 * prix de la boutique s'applique tel quel dans ces sept pays.
 */
export const CFA_CURRENCIES: Record<string, string> = {
  BEN: 'XOF',
  BFA: 'XOF',
  CIV: 'XOF',
  SEN: 'XOF',
  CMR: 'XAF',
  COG: 'XAF',
  GAB: 'XAF',
}

/** Pays atteignables avec une devise hors zone CFA, par devise. */
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
export function convertPrice(price: number, config: ShopCurrency): number {
  const raw = price * config.rate
  if (config.decimals > 0) return Math.round(raw * 100) / 100

  const step = Math.max(1, Math.round(config.round_to))
  // Jamais zéro : un montant nul serait refusé par pawaPay, et gratuit.
  return Math.max(step, Math.round(raw / step) * step)
}

/**
 * Le montant à demander dans un pays donné, ou null si on ne sait pas y vendre.
 *
 * pawaPay ne convertit jamais : il prélève exactement ce qu'on lui donne, dans
 * la devise qu'on lui donne. Un pays hors zone CFA sans taux enregistré n'est
 * donc pas vendable, et il vaut mieux ne pas le proposer du tout que d'y
 * afficher un prix faux.
 */
export function priceForCountry(
  country: string,
  price: number,
  extras: ShopCurrency[] = [],
): { currency: string; amount: number } | null {
  const cfa = CFA_CURRENCIES[country]
  if (cfa) return { currency: cfa, amount: price }

  for (const config of extras) {
    if (EXTRA_CURRENCY_COUNTRIES[config.currency]?.includes(country)) {
      return { currency: config.currency, amount: convertPrice(price, config) }
    }
  }
  return null
}

/**
 * Met le montant au format attendu : chaîne, sans zéro décimal final.
 * Le motif imposé par pawaPay refuse « 10.50 » et « 10.00 » — il faut écrire
 * « 10.5 » et « 10 ». Les opérateurs qui ne gèrent pas les décimales imposent
 * en plus un entier.
 */
export function formatAmount(value: number, decimals: 'NONE' | 'TWO_PLACES'): string {
  if (decimals === 'NONE') return String(Math.max(1, Math.round(value)))

  return (Math.round(value * 100) / 100)
    .toFixed(2)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
}

/**
 * `customerMessage` apparaît dans le SMS de reçu de l'acheteur, et pawaPay le
 * valide strictement : 4 à 22 caractères, lettres chiffres et espaces
 * uniquement. Un titre avec une apostrophe ou un accent ferait rejeter la
 * requête entière, d'où le nettoyage plutôt qu'une simple troncature.
 */
export function sanitizeCustomerMessage(text: string): string {
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

// ============================================================
// Configuration active du compte
// ============================================================

export type DepositConfig = {
  authType: 'PROVIDER_AUTH' | 'PREAUTH' | 'REDIRECT_AUTH'
  pinPrompt: 'AUTOMATIC' | 'MANUAL' | null
  pinPromptRevivable: boolean
  /** Instructions localisées à montrer à l'acheteur (composer *144#, etc.). */
  instructions: unknown
  minAmount: number | null
  maxAmount: number | null
  decimalsInAmount: 'NONE' | 'TWO_PLACES'
  status: 'OPERATIONAL' | 'DELAYED' | 'CLOSED'
}

export type ProviderConf = {
  provider: string
  displayName: string
  /** Nom affiché à l'acheteur sur l'invite de code PIN. */
  nameDisplayedToCustomer: string
  logo: string | null
  currency: string
  deposit: DepositConfig
}

export type CountryConf = {
  country: string
  name: string
  prefix: string
  flag: string | null
  providers: ProviderConf[]
}

/**
 * La documentation décrit `operationTypes` comme un objet, mais un exemple le
 * montre en tableau. On accepte les deux plutôt que de parier.
 */
function readDeposit(operationTypes: unknown): Record<string, unknown> | null {
  if (!operationTypes || typeof operationTypes !== 'object') return null

  if (Array.isArray(operationTypes)) {
    for (const entry of operationTypes) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      if (record.DEPOSIT) return record.DEPOSIT as Record<string, unknown>
      if (record.operationType === 'DEPOSIT') return record
    }
    return null
  }

  const deposit = (operationTypes as Record<string, unknown>).DEPOSIT
  return deposit && typeof deposit === 'object' ? (deposit as Record<string, unknown>) : null
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseActiveConf(payload: unknown): CountryConf[] {
  const countries = (payload as { countries?: unknown[] })?.countries
  if (!Array.isArray(countries)) return []

  const result: CountryConf[] = []

  for (const raw of countries) {
    const entry = raw as Record<string, any>
    const providers: ProviderConf[] = []

    for (const rawProvider of entry.providers ?? []) {
      const provider = rawProvider as Record<string, any>

      for (const rawCurrency of provider.currencies ?? []) {
        const currency = rawCurrency as Record<string, any>
        const deposit = readDeposit(currency.operationTypes)
        // Un opérateur sans configuration de dépôt ne peut pas encaisser :
        // il n'a rien à faire dans la liste montrée à l'acheteur.
        if (!deposit) continue

        providers.push({
          provider: provider.provider,
          displayName: provider.displayName ?? provider.provider,
          nameDisplayedToCustomer: provider.nameDisplayedToCustomer ?? '',
          logo: provider.logo ?? null,
          currency: currency.currency,
          deposit: {
            authType: (deposit.authType as DepositConfig['authType']) ?? 'PROVIDER_AUTH',
            pinPrompt: (deposit.pinPrompt as DepositConfig['pinPrompt']) ?? null,
            pinPromptRevivable: Boolean(deposit.pinPromptRevivable),
            instructions: deposit.authTokenInstructions ?? deposit.pinPromptInstructions ?? null,
            minAmount: toNumber(deposit.minAmount ?? deposit.minTransactionLimit),
            maxAmount: toNumber(deposit.maxAmount ?? deposit.maxTransactionLimit),
            decimalsInAmount:
              deposit.decimalsInAmount === 'TWO_PLACES' ? 'TWO_PLACES' : 'NONE',
            status: (deposit.status as DepositConfig['status']) ?? 'OPERATIONAL',
          },
        })
      }
    }

    result.push({
      country: entry.country,
      name: entry.displayName?.fr ?? entry.displayName?.en ?? entry.country,
      prefix: String(entry.prefix ?? ''),
      flag: entry.flag ?? null,
      providers,
    })
  }

  return result
}

// La configuration bouge rarement, et l'acheteur la charge à l'ouverture de la
// page de paiement : la garder en mémoire évite un aller-retour sur chaque
// visite. Les instances d'Edge Function sont réutilisées quelques minutes.
let confCache: { at: number; value: CountryConf[] } | null = null
const CONF_TTL_MS = 10 * 60 * 1000

export async function getActiveConf(): Promise<CountryConf[]> {
  if (confCache && Date.now() - confCache.at < CONF_TTL_MS) return confCache.value

  const res = await fetch(`${baseUrl()}/v2/active-conf?operationType=DEPOSIT`, {
    headers: headers(),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`pawaPay ${res.status} : ${text}`)

  const value = parseActiveConf(JSON.parse(text))
  confCache = { at: Date.now(), value }
  return value
}

// ============================================================
// Numéro de téléphone
// ============================================================

export type Prediction = {
  country: string
  provider: string
  phoneNumber: string
}

/**
 * Valide et normalise un numéro, et devine l'opérateur.
 *
 * pawaPay exige le MSISDN exact ; les acheteurs, eux, tapent des espaces, des
 * tirets et parfois un zéro de trop. C'est aussi le seul moyen de refuser un
 * numéro invalide avant de créer une commande. Renvoie null si le numéro n'est
 * pas exploitable.
 */
export async function predictProvider(phoneNumber: string): Promise<Prediction | null> {
  const res = await fetch(`${baseUrl()}/v2/predict-provider`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ phoneNumber }),
  })

  const text = await res.text()
  if (!res.ok) return null

  const data = JSON.parse(text)
  if (!data.provider || !data.phoneNumber) return null

  return { country: data.country, provider: data.provider, phoneNumber: data.phoneNumber }
}

// ============================================================
// Dépôts
// ============================================================

export type DepositCreated = {
  /** FINAL_STATUS : il n'y a plus qu'à attendre. GET_AUTH_URL : voir plus bas. */
  nextStep: string | null
}

/**
 * Demande le paiement. Un HTTP 200 ne veut pas dire accepté : le statut est
 * dans le corps, et une erreur d'initiation doit être montrée tout de suite à
 * l'acheteur — c'est le seul moment où il peut corriger quelque chose.
 */
export async function createDeposit(input: {
  depositId: string
  amount: string
  currency: string
  phoneNumber: string
  provider: string
  customerMessage: string
  clientReferenceId?: string
  preAuthorisationCode?: string | null
  successfulUrl?: string
  failedUrl?: string
}): Promise<DepositCreated> {
  const body: Record<string, unknown> = {
    depositId: input.depositId,
    amount: input.amount,
    currency: input.currency,
    payer: {
      type: 'MMO',
      accountDetails: { phoneNumber: input.phoneNumber, provider: input.provider },
    },
    customerMessage: sanitizeCustomerMessage(input.customerMessage),
  }

  if (input.clientReferenceId) body.clientReferenceId = input.clientReferenceId
  if (input.preAuthorisationCode) body.preAuthorisationCode = input.preAuthorisationCode
  // Uniquement pour les opérateurs à autorisation par redirection (Wave).
  if (input.successfulUrl) body.successfulUrl = input.successfulUrl
  if (input.failedUrl) body.failedUrl = input.failedUrl

  const res = await fetch(`${baseUrl()}/v2/deposits`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let data: Record<string, any> = {}
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Réponse pawaPay illisible (${res.status}) : ${text}`)
  }

  // Un 500 sans statut ne prouve pas l'échec : la documentation demande
  // explicitement de vérifier avant de conclure. On laisse la commande en
  // attente, le polling tranchera.
  if (res.status >= 500 && !data.status) {
    return { nextStep: null }
  }

  if (data.status === 'REJECTED' || !res.ok) {
    throw new DepositRejected(
      data.failureReason?.failureCode ?? 'UNKNOWN_ERROR',
      data.failureReason?.failureMessage ?? text,
    )
  }

  return { nextStep: data.nextStep ?? null }
}

/** Rejet à l'initiation : le code permet d'écrire un message utile en français. */
export class DepositRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DepositRejected'
  }
}

export type DepositStatus =
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'IN_RECONCILIATION'
  | 'COMPLETED'
  | 'FAILED'

export type DepositState = {
  status: DepositStatus
  nextStep: string | null
  /** Fourni par les opérateurs à redirection, une fois disponible. */
  authorizationUrl: string | null
  providerTransactionId: string | null
  country: string | null
  failureCode: string | null
  failureReason: string | null
}

/**
 * Source de vérité du paiement : on redemande l'état à pawaPay plutôt que de
 * croire le corps d'un callback, qui peut être forgé par n'importe qui.
 *
 * Renvoie null quand pawaPay ne connaît pas ce dépôt (`NOT_FOUND`) — cas d'une
 * initiation qui n'a jamais abouti.
 */
export async function getDeposit(depositId: string): Promise<DepositState | null> {
  const res = await fetch(`${baseUrl()}/v2/deposits/${depositId}`, { headers: headers() })
  const text = await res.text()
  if (!res.ok) throw new Error(`pawaPay ${res.status} : ${text}`)

  const payload = JSON.parse(text)
  // La réponse est enveloppée : { status: "FOUND", data: { ... } }
  if (payload.status === 'NOT_FOUND') return null
  if (payload.status !== 'FOUND' || !payload.data) {
    throw new Error(`Réponse pawaPay inattendue : ${text}`)
  }

  const data = payload.data
  return {
    status: data.status as DepositStatus,
    nextStep: data.nextStep ?? null,
    authorizationUrl: data.authorizationUrl ?? null,
    providerTransactionId: data.providerTransactionId ?? null,
    country: data.country ?? null,
    failureCode: data.failureReason?.failureCode ?? null,
    failureReason: data.failureReason?.failureMessage ?? null,
  }
}

/** Extrait le depositId d'un callback, quelle que soit son enveloppe. */
export function extractDepositId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null

  const direct = (payload as Record<string, unknown>).depositId
  if (typeof direct === 'string') return direct

  const data = (payload as Record<string, unknown>).data
  if (data && typeof data === 'object') {
    const nested = (data as Record<string, unknown>).depositId
    if (typeof nested === 'string') return nested
  }
  return null
}
