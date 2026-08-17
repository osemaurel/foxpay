import { admin, downloadUrl } from './admin.ts'
import { sendDownloadEmail } from './email.ts'
import { getDeposit } from './pawapay.ts'

const DOWNLOAD_WINDOW_HOURS = 24

export type SettleResult = 'paid' | 'failed' | 'pending' | 'unknown'

export type SettleOutcome = {
  result: SettleResult
  /** Fourni par les opérateurs à redirection (Wave), une fois disponible. */
  authorizationUrl: string | null
  failureCode: string | null
}

/**
 * Règle une commande à partir de l'état réel du dépôt chez pawaPay.
 *
 * Deux appelants : le callback pawaPay, et le suivi affiché sur la page de
 * paiement. Le suivi n'est pas un luxe — un callback peut être retardé, mal
 * configuré ou perdu, et l'acheteur attend son fichier. Les deux chemins
 * passent ici pour que la livraison soit identique quel que soit celui qui
 * arrive en premier.
 *
 * Idempotent : les mises à jour sont filtrées sur status='pending', et l'envoi
 * de l'email est piloté par delivered_at.
 */
export async function settleOrder(depositId: string): Promise<SettleOutcome> {
  const { data: order } = await admin
    .from('orders')
    .select(
      'id, status, delivered_at, download_token, buyer_email, created_at, failure_code, ' +
        'shops(name, contact_email), products(title)',
    )
    .eq('deposit_id', depositId)
    .maybeSingle()

  if (!order) return done('unknown')
  if (order.status === 'failed' || order.status === 'cancelled') {
    return done('failed', { failureCode: order.failure_code })
  }

  // Déjà payée : il reste peut-être l'email à (re)tenter.
  if (order.status === 'paid') {
    await deliver(order)
    return done('paid')
  }

  const deposit = await getDeposit(depositId)

  // pawaPay ne connaît pas ce dépôt. L'initiation n'a donc jamais abouti — mais
  // seulement si elle a eu le temps d'échouer : juste après l'insertion, la
  // commande peut légitimement être plus rapide que l'appel.
  if (!deposit) {
    const age = Date.now() - new Date(order.created_at).getTime()
    if (age < 60_000) return done('pending')

    await admin
      .from('orders')
      .update({
        status: 'failed',
        failure_code: 'NOT_FOUND',
        failure_reason: "Le dépôt n'existe pas chez pawaPay : l'initiation n'a jamais abouti.",
      })
      .eq('id', order.id)
      .eq('status', 'pending')
    return done('failed', { failureCode: 'NOT_FOUND' })
  }

  // ACCEPTED, PROCESSING et IN_RECONCILIATION ne sont pas des fins de course.
  // IN_RECONCILIATION en particulier : pawaPay détermine encore le vrai statut,
  // et trancher ici ferait perdre une vente qui a peut-être réussi.
  if (deposit.status !== 'COMPLETED' && deposit.status !== 'FAILED') {
    return done('pending', { authorizationUrl: deposit.authorizationUrl })
  }

  if (deposit.status === 'FAILED') {
    await admin
      .from('orders')
      .update({
        status: 'failed',
        // Le message d'origine est gardé pour le vendeur ; l'acheteur, lui,
        // voit une traduction du code dans describeFailure().
        failure_code: deposit.failureCode ?? 'UNSPECIFIED_FAILURE',
        failure_reason: deposit.failureReason,
      })
      .eq('id', order.id)
      .eq('status', 'pending')
    return done('failed', { failureCode: deposit.failureCode })
  }

  await admin
    .from('orders')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      download_expires_at: new Date(
        Date.now() + DOWNLOAD_WINDOW_HOURS * 3600 * 1000,
      ).toISOString(),
      provider_transaction_id: deposit.providerTransactionId,
      // Confirmé par pawaPay : c'est le pays du portefeuille qui a payé.
      country: deposit.country ?? undefined,
    })
    .eq('id', order.id)
    .eq('status', 'pending')

  await deliver(order)
  return done('paid')
}

function done(
  result: SettleResult,
  extra: Partial<Omit<SettleOutcome, 'result'>> = {},
): SettleOutcome {
  return { result, authorizationUrl: null, failureCode: null, ...extra }
}

type DeliverableOrder = {
  id: string
  delivered_at: string | null
  download_token: string
  buyer_email: string
  shops: unknown
  products: unknown
}

/** Envoie l'email une seule fois. Une erreur d'envoi est propagée à l'appelant. */
async function deliver(order: DeliverableOrder): Promise<void> {
  if (order.delivered_at) return

  const shop = order.shops as { name: string; contact_email: string | null }
  const product = order.products as { title: string }

  await sendDownloadEmail({
    to: order.buyer_email,
    shopName: shop.name,
    productTitle: product.title,
    downloadUrl: downloadUrl(order.download_token),
    contactEmail: shop.contact_email,
  })

  await admin
    .from('orders')
    .update({ delivered_at: new Date().toISOString() })
    .eq('id', order.id)
}
