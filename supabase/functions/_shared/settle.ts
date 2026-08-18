import { admin, downloadUrl } from './admin.ts'
import { NOMS_PAYS } from './catalogue.ts'
import { sendDownloadEmail, sendSaleEmail } from './email.ts'
import { getDeposit } from './pawapay.ts'
import { getCollection, readStatus, SebPayError } from './sebpay.ts'

const DOWNLOAD_WINDOW_HOURS = 24

/**
 * Délai avant de conclure qu'une initiation n'a jamais abouti. Juste après
 * l'insertion, la commande peut légitimement être plus rapide que l'appel au
 * processeur : la déclarer perdue tout de suite ferait échouer des paiements
 * qui n'ont pas encore eu le temps d'exister.
 */
const GRACE_MS = 60_000

/**
 * Intervalle minimal entre deux interrogations directes de SebPay pour une même
 * commande. La page redemande le statut toutes les trois secondes ; laisser
 * chaque tick sortir par le relais à IP fixe — facturé à la requête —
 * consommerait cent appels par vente. Le webhook signé reste le chemin normal,
 * ce sondage n'est qu'un filet pour le jour où il ne vient pas.
 */
const SONDAGE_SEBPAY_MS = 25_000

export type SettleResult = 'paid' | 'failed' | 'pending' | 'unknown'

export type SettleOutcome = {
  result: SettleResult
  /** Fourni par les opérateurs à redirection (Wave), une fois disponible. */
  authorizationUrl: string | null
  failureCode: string | null
}

const CHAMPS =
  'id, status, provider, deposit_id, delivered_at, download_token, buyer_email, created_at, ' +
  'failure_code, authorization_url, provider_checked_at, ' +
  'buyer_name, buyer_phone, charged_amount, charged_currency, country, mmo_provider, ' +
  'shops(name, contact_email, owner_id), products(title)'

type Commande = {
  id: string
  status: string
  provider: string
  deposit_id: string
  created_at: string
  failure_code: string | null
  authorization_url: string | null
  provider_checked_at: string | null
  delivered_at: string | null
  download_token: string
  buyer_email: string
  buyer_name: string | null
  buyer_phone: string | null
  charged_amount: number | null
  charged_currency: string | null
  country: string | null
  mmo_provider: string | null
  shops: unknown
  products: unknown
}

type Boutique = { name: string; contact_email: string | null; owner_id: string }

/**
 * Règle une commande à partir de l'état réel du paiement chez son processeur.
 *
 * Trois appelants : les deux callbacks, et le suivi affiché sur la page de
 * paiement. Le suivi n'est pas un luxe — un callback peut être retardé, mal
 * configuré ou perdu, et l'acheteur attend son fichier. Tous les chemins passent
 * ici pour que la livraison soit identique quel que soit celui qui arrive en
 * premier.
 *
 * Idempotent : les mises à jour sont filtrées sur status='pending', et l'envoi
 * de l'email est piloté par delivered_at.
 */
export async function settleOrder(orderId: string): Promise<SettleOutcome> {
  const { data } = await admin.from('orders').select(CHAMPS).eq('id', orderId).maybeSingle()
  return regler(data as Commande | null)
}

/** Même chose, mais retrouvée par l'identifiant de dépôt — le callback pawaPay. */
export async function settleDeposit(depositId: string): Promise<SettleOutcome> {
  const { data } = await admin
    .from('orders')
    .select(CHAMPS)
    .eq('deposit_id', depositId)
    .maybeSingle()
  return regler(data as Commande | null)
}

async function regler(order: Commande | null): Promise<SettleOutcome> {
  if (!order) return done('unknown')

  if (order.status === 'failed' || order.status === 'cancelled') {
    return done('failed', { failureCode: order.failure_code })
  }

  // Déjà payée : il reste peut-être l'email à (re)tenter.
  if (order.status === 'paid') {
    await deliver(order)
    return done('paid')
  }

  return order.provider === 'sebpay' ? await reglerSebpay(order) : await reglerPawapay(order)
}

// ============================================================
// pawaPay
// ============================================================

async function reglerPawapay(order: Commande): Promise<SettleOutcome> {
  const deposit = await getDeposit(order.deposit_id)

  // pawaPay ne connaît pas ce dépôt : l'initiation n'a donc jamais abouti.
  if (!deposit) {
    if (Date.now() - new Date(order.created_at).getTime() < GRACE_MS) return done('pending')

    await echouer(order, 'NOT_FOUND', "Le dépôt n'existe pas chez pawaPay : l'initiation n'a jamais abouti.")
    return done('failed', { failureCode: 'NOT_FOUND' })
  }

  // ACCEPTED, PROCESSING et IN_RECONCILIATION ne sont pas des fins de course.
  // IN_RECONCILIATION en particulier : pawaPay détermine encore le vrai statut,
  // et trancher ici ferait perdre une vente qui a peut-être réussi.
  if (deposit.status !== 'COMPLETED' && deposit.status !== 'FAILED') {
    return done('pending', { authorizationUrl: deposit.authorizationUrl })
  }

  if (deposit.status === 'FAILED') {
    // Le message d'origine est gardé pour le vendeur ; l'acheteur, lui, voit
    // une traduction du code dans describeFailure().
    await echouer(order, deposit.failureCode ?? 'UNSPECIFIED_FAILURE', deposit.failureReason)
    return done('failed', { failureCode: deposit.failureCode })
  }

  // Confirmé par pawaPay : c'est le pays du portefeuille qui a payé.
  await payer(order, deposit.providerTransactionId, deposit.country)
  return done('paid')
}

// ============================================================
// SebPay
// ============================================================

/**
 * Applique un statut déjà connu, sans rien redemander à SebPay.
 *
 * Réservé au webhook, dont la signature HMAC a été vérifiée avec notre clé
 * secrète : le corps est alors authentique, et le redemander ne ferait
 * qu'entamer le quota du relais pour réapprendre ce qu'on sait déjà. Le
 * callback pawaPay, lui, n'est pas signé — d'où le traitement inverse.
 */
export async function settleSebpayWebhook(
  reference: string,
  statut: string,
  transactionId: string | null,
): Promise<SettleOutcome> {
  const { data } = await admin.from('orders').select(CHAMPS).eq('id', reference).maybeSingle()
  const order = data as Commande | null

  if (!order) return done('unknown')
  if (order.provider !== 'sebpay') return done('unknown')
  if (order.status === 'paid') {
    await deliver(order)
    return done('paid')
  }
  if (order.status !== 'pending') return done('failed', { failureCode: order.failure_code })

  return await conclureSebpay(order, statut, transactionId)
}

async function reglerSebpay(order: Commande): Promise<SettleOutcome> {
  const attente = done('pending', { authorizationUrl: order.authorization_url })

  // Le webhook signé fait l'essentiel du travail. On n'interroge SebPay que de
  // loin en loin, et jamais avant que l'initiation ait eu le temps d'aboutir.
  const dernier = order.provider_checked_at ?? order.created_at
  if (Date.now() - new Date(dernier).getTime() < SONDAGE_SEBPAY_MS) return attente

  await admin
    .from('orders')
    .update({ provider_checked_at: new Date().toISOString() })
    .eq('id', order.id)

  let etat
  try {
    etat = await getCollection(order.id)
  } catch (e) {
    // 404 : SebPay ne connaît pas cette référence. Comme chez pawaPay, ce n'est
    // un échec qu'une fois passé le délai de grâce.
    if (e instanceof SebPayError && e.status === 404) {
      if (Date.now() - new Date(order.created_at).getTime() < GRACE_MS) return attente

      await echouer(order, 'NOT_FOUND', "La collecte n'existe pas chez SebPay : l'initiation n'a jamais abouti.")
      return done('failed', { failureCode: 'NOT_FOUND' })
    }

    // Panne passagère : la commande reste en attente, la page réessaiera.
    console.error('settle sebpay', e)
    return attente
  }

  return await conclureSebpay(order, etat.status, etat.transaction_id ?? null)
}

async function conclureSebpay(
  order: Commande,
  statut: string,
  transactionId: string | null,
): Promise<SettleOutcome> {
  const resultat = readStatus(statut)

  if (resultat === 'pending') {
    return done('pending', { authorizationUrl: order.authorization_url })
  }

  if (resultat === 'failed') {
    // SebPay ne détaille pas la cause d'un rejet : l'acheteur verra le message
    // générique, qui reste vrai — le paiement n'a pas abouti.
    await echouer(order, 'PAYMENT_REJECTED', `Collecte rejetée par SebPay (${statut}).`)
    return done('failed', { failureCode: 'PAYMENT_REJECTED' })
  }

  await payer(order, transactionId, null)
  return done('paid')
}

// ============================================================
// Écritures communes
// ============================================================

async function echouer(order: Commande, code: string, raison: string | null): Promise<void> {
  await admin
    .from('orders')
    .update({ status: 'failed', failure_code: code, failure_reason: raison })
    .eq('id', order.id)
    .eq('status', 'pending')
}

async function payer(
  order: Commande,
  transactionId: string | null,
  country: string | null,
): Promise<void> {
  await admin
    .from('orders')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      download_expires_at: new Date(
        Date.now() + DOWNLOAD_WINDOW_HOURS * 3600 * 1000,
      ).toISOString(),
      provider_transaction_id: transactionId,
      country: country ?? undefined,
    })
    .eq('id', order.id)
    .eq('status', 'pending')

  await deliver(order)
}

function done(
  result: SettleResult,
  extra: Partial<Omit<SettleOutcome, 'result'>> = {},
): SettleOutcome {
  return { result, authorizationUrl: null, failureCode: null, ...extra }
}

/**
 * Livre la commande : le fichier à l'acheteur, puis l'avis au vendeur.
 *
 * Une seule fois — `delivered_at` en est le garde-fou. L'échec de l'email
 * d'achat est propagé : c'est la livraison elle-même, l'appelant doit le
 * savoir. Celui du vendeur ne l'est pas : perdre une notification ne doit pas
 * faire retenter une livraison déjà faite.
 */
async function deliver(order: Commande): Promise<void> {
  if (order.delivered_at) return

  const shop = order.shops as Boutique
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

  try {
    await prevenirVendeur(order, shop, product.title)
  } catch (e) {
    console.error('avis de vente', e)
  }
}

/**
 * L'avis de vente, à l'adresse de contact de la boutique — ou, à défaut, à
 * celle du compte. Un vendeur qui n'a pas rempli ce champ doit quand même
 * apprendre qu'il a vendu.
 */
async function prevenirVendeur(
  order: Commande,
  shop: Boutique,
  productTitle: string,
): Promise<void> {
  let destinataire = shop.contact_email

  if (!destinataire) {
    const { data } = await admin.auth.admin.getUserById(shop.owner_id)
    destinataire = data?.user?.email ?? null
  }

  if (!destinataire) {
    console.warn('avis de vente sans destinataire', order.id)
    return
  }

  await sendSaleEmail({
    to: destinataire,
    shopName: shop.name,
    productTitle,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    buyerPhone: order.buyer_phone,
    montant: montantLisible(order),
    countryName: order.country ? (NOMS_PAYS[order.country] ?? order.country) : null,
    operateur: order.mmo_provider,
  })
}

/** Les deux francs CFA s'écrivent FCFA ; le reste garde son code ISO. */
const SIGLES: Record<string, string> = { XOF: 'FCFA', XAF: 'FCFA' }

function montantLisible(order: Commande): string {
  if (order.charged_amount === null || !order.charged_currency) return '—'

  const montant = Math.round(Number(order.charged_amount)).toLocaleString('fr-FR')
  return `${montant} ${SIGLES[order.charged_currency] ?? order.charged_currency}`
}
