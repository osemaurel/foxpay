import { admin, downloadUrl } from './admin.ts'
import { sendDownloadEmail } from './email.ts'
import { getCheckout } from './pawapay.ts'

const DOWNLOAD_WINDOW_HOURS = 24

export type SettleResult = 'paid' | 'failed' | 'pending' | 'unknown'

/**
 * Règle une commande à partir de l'état réel du checkout chez pawaPay.
 *
 * Deux appelants : le callback pawaPay, et le polling de la page de retour.
 * Le polling n'est pas un luxe — un callback peut être retardé, mal configuré
 * ou perdu, et l'acheteur attend son fichier. Les deux chemins passent ici pour
 * que la livraison soit identique quel que soit celui qui arrive en premier.
 *
 * Idempotent : les mises à jour sont filtrées sur status='pending', et l'envoi
 * de l'email est piloté par delivered_at.
 */
export async function settleOrder(checkoutId: string): Promise<SettleResult> {
  const { data: order } = await admin
    .from('orders')
    .select(
      'id, status, delivered_at, download_token, buyer_email, ' +
        'shops(name, contact_email), products(title)',
    )
    .eq('checkout_id', checkoutId)
    .maybeSingle()

  if (!order) return 'unknown'
  if (order.status === 'failed' || order.status === 'cancelled') return 'failed'

  // Déjà payée : il reste peut-être l'email à (re)tenter.
  if (order.status === 'paid') {
    await deliver(order)
    return 'paid'
  }

  const checkout = await getCheckout(checkoutId)
  if (!checkout) return 'pending'

  // WAITING_PAYMENT et PROCESSING ne sont pas des fins de course.
  if (checkout.status === 'WAITING_PAYMENT' || checkout.status === 'PROCESSING') {
    return 'pending'
  }

  if (checkout.status !== 'COMPLETED') {
    // FAILED, EXPIRED ou CANCELLED : la distinction est utile au vendeur, donc
    // on garde le statut pawaPay dans failure_reason plutôt que de l'aplatir.
    await admin
      .from('orders')
      .update({
        status: 'failed',
        failure_reason: checkout.failureReason ?? checkout.status,
      })
      .eq('id', order.id)
      .eq('status', 'pending')
    return 'failed'
  }

  await admin
    .from('orders')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      download_expires_at: new Date(
        Date.now() + DOWNLOAD_WINDOW_HOURS * 3600 * 1000,
      ).toISOString(),
      provider_transaction_id: checkout.providerTransactionId,
      // Le pays n'est connu qu'ici : c'est celui depuis lequel l'acheteur a payé.
      country: checkout.country,
    })
    .eq('id', order.id)
    .eq('status', 'pending')

  await deliver(order)
  return 'paid'
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
