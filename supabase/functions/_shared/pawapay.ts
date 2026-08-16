import { requireEnv } from './admin.ts'

/**
 * Intégration pawaPay (Merchant API v2).
 *
 * ⚠️ À VÉRIFIER CONTRE LA DOC (docs.pawapay.io/v2) AVANT LA MISE EN PRODUCTION.
 * Le domaine de la documentation était inaccessible au moment d'écrire ce
 * fichier, la forme exacte du corps de `openPaymentPage` est donc reconstituée.
 * Les champs sûrs : depositId (UUIDv4 fourni par le marchand), returnUrl,
 * reason, msisdn. Les champs à confirmer sont marqués ci-dessous.
 *
 * Le reste du code ne dépend pas de ces détails : la confirmation de paiement
 * passe par getDepositStatus(), jamais par le corps du callback.
 */

const baseUrl = () =>
  (Deno.env.get('PAWAPAY_BASE_URL') ?? 'https://api.sandbox.pawapay.io').replace(/\/+$/, '')

function headers() {
  return {
    Authorization: `Bearer ${requireEnv('PAWAPAY_API_TOKEN')}`,
    'Content-Type': 'application/json',
  }
}

export type PaymentPageInput = {
  depositId: string
  amount: number
  currency: string
  country: string
  returnUrl: string
  reason: string
  msisdn?: string | null
}

/** Ouvre une Payment Page hébergée et renvoie l'URL de redirection. */
export async function openPaymentPage(input: PaymentPageInput): Promise<string> {
  const body: Record<string, unknown> = {
    depositId: input.depositId,
    returnUrl: input.returnUrl,
    // `reason` s'affiche sur la page de paiement, limité côté pawaPay.
    reason: input.reason.slice(0, 22),
    // ⚠️ À CONFIRMER : en v2 le montant est regroupé avec la devise dans
    // amountDetails, et le montant est une chaîne. Le XOF n'ayant pas de
    // décimales, on envoie l'entier tel quel.
    amountDetails: { amount: String(input.amount), currency: input.currency },
    country: input.country,
  }
  if (input.msisdn) body.msisdn = input.msisdn

  const res = await fetch(`${baseUrl()}/v2/paymentpage`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`pawaPay ${res.status} : ${text}`)

  const data = JSON.parse(text)
  const url = data.redirectUrl ?? data.url
  if (!url) throw new Error(`Réponse pawaPay sans redirectUrl : ${text}`)
  return url as string
}

export type DepositStatus = 'COMPLETED' | 'FAILED' | 'PENDING'

/**
 * Source de vérité du paiement : on redemande le statut à pawaPay au lieu de
 * croire le corps du callback. Ça protège d'un faux callback et rend le code
 * insensible à la forme exacte du payload.
 */
export async function getDepositStatus(
  depositId: string,
): Promise<{ status: DepositStatus; providerTransactionId: string | null; reason: string | null }> {
  const res = await fetch(`${baseUrl()}/v2/deposits/${depositId}`, { headers: headers() })
  const text = await res.text()
  if (!res.ok) throw new Error(`pawaPay ${res.status} : ${text}`)

  const deposit = findDeposit(JSON.parse(text))
  const raw = String(deposit?.status ?? '').toUpperCase()

  return {
    status: raw === 'COMPLETED' ? 'COMPLETED' : raw === 'FAILED' ? 'FAILED' : 'PENDING',
    providerTransactionId: (deposit?.providerTransactionId as string) ?? null,
    reason:
      (deposit?.failureReason as { failureMessage?: string })?.failureMessage ??
      (deposit?.failureReason as string) ??
      null,
  }
}

/**
 * pawaPay a enveloppé la réponse différemment entre v1 et v2 (objet nu, tableau,
 * ou { data: { deposit } }). On cherche l'objet qui porte un depositId plutôt
 * que de parier sur un seul niveau d'imbrication.
 */
function findDeposit(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findDeposit(item)
      if (found) return found
    }
    return null
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    if ('depositId' in obj && 'status' in obj) return obj
    for (const value of Object.values(obj)) {
      const found = findDeposit(value)
      if (found) return found
    }
  }
  return null
}

/** Extrait le depositId d'un callback, quelle que soit son enveloppe. */
export function extractDepositId(payload: unknown): string | null {
  const deposit = findDeposit(payload)
  if (deposit) return String(deposit.depositId)
  if (payload && typeof payload === 'object' && 'depositId' in payload) {
    return String((payload as Record<string, unknown>).depositId)
  }
  return null
}
