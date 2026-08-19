import { admin, SITE_URL } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { describeFailure } from '../_shared/failures.ts'
import { sendRetryEmail } from '../_shared/email.ts'
import { lireLangue } from '../_shared/langue.ts'
import { settleOrder } from '../_shared/settle.ts'

/**
 * Écrire à l'acheteur d'une commande, à la demande du vendeur.
 *
 * Deux courriers selon l'état de la commande, et c'est elle qui décide — pas
 * l'appelant :
 *
 *   - payée : on renvoie le lien de téléchargement. Rattrape une vente dont
 *     l'email n'est jamais parti, ou dépanne un acheteur qui l'a perdu ;
 *   - échouée : on relance, avec un lien pour reprendre l'achat.
 *
 * Toujours déclenché à la main. Une relance automatique à la seconde où le
 * paiement échoue tomberait souvent sur quelqu'un qui vient de manquer de
 * solde — le vendeur est mieux placé pour choisir son moment.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  const jeton = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jeton) return fail('Authentification requise', 401)

  const { data: auth } = await admin.auth.getUser(jeton)
  if (!auth?.user) return fail('Session expirée', 401)

  let body: { order_id?: string; force?: boolean }
  try {
    body = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  const orderId = body.order_id?.trim()
  if (!orderId) return fail('Commande manquante')

  // La commande doit appartenir à la boutique de la personne connectée : sans
  // cette vérification, un vendeur pourrait écrire aux clients d'un autre.
  const { data: order } = await admin
    .from('orders')
    .select(
      'id, status, delivered_at, buyer_email, failure_code, locale, ' +
        'shops!inner(name, slug, owner_id, contact_email), products(title, slug)',
    )
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return fail('Commande introuvable', 404)

  const shop = order.shops as {
    name: string
    slug: string
    owner_id: string
    contact_email: string | null
  }

  if (shop.owner_id !== auth.user.id) return fail('Commande introuvable', 404)

  return order.status === 'paid'
    ? await renvoyerLivraison(order, Boolean(body.force))
    : await relancer(order, shop)
})

/**
 * Le lien de téléchargement. C'est settleOrder qui fait le travail : sur une
 * commande déjà payée il ne refait que la livraison, et `delivered_at`
 * l'empêche de partir deux fois.
 */
async function renvoyerLivraison(
  order: { id: string; delivered_at: string | null; buyer_email: string },
  force: boolean,
): Promise<Response> {
  // Un renvoi demandé explicitement doit repartir même si le premier email a
  // été marqué comme envoyé — c'est tout l'intérêt quand l'acheteur l'a perdu.
  if (force && order.delivered_at) {
    await admin.from('orders').update({ delivered_at: null }).eq('id', order.id)
  }

  try {
    await settleOrder(order.id)
  } catch (e) {
    console.error('resend-delivery', e)
    return fail(`Envoi impossible : ${(e as Error).message}`, 502)
  }

  const { data: apres } = await admin
    .from('orders')
    .select('delivered_at')
    .eq('id', order.id)
    .maybeSingle()

  if (!apres?.delivered_at) return fail("L'email n'est pas parti.", 502)

  return json({ ok: true, kind: 'delivery', to: order.buyer_email })
}

/** La relance, avec un lien qui ramène sur la page de paiement du produit. */
async function relancer(
  order: {
    id: string
    status: string
    buyer_email: string
    failure_code: string | null
    locale: string
    products: unknown
  },
  shop: { name: string; slug: string; contact_email: string | null },
): Promise<Response> {
  if (order.status === 'pending') {
    return fail("Ce paiement est encore en cours : attends qu'il soit tranché.", 409)
  }

  const product = order.products as { title: string; slug: string } | null
  if (!product) return fail("Ce produit n'existe plus", 409)

  // La relance repart dans la langue où l'acheteur avait fait sa tentative.
  const langue = lireLangue(order.locale)

  try {
    await sendRetryEmail({
      to: order.buyer_email,
      shopName: shop.name,
      productTitle: product.title,
      retryUrl: `${SITE_URL()}/boutique/${shop.slug}/checkout/${product.slug}`,
      raison: describeFailure(order.failure_code, langue),
      contactEmail: shop.contact_email,
      langue,
    })
  } catch (e) {
    console.error('relance', e)
    return fail(`Envoi impossible : ${(e as Error).message}`, 502)
  }

  return json({ ok: true, kind: 'retry', to: order.buyer_email })
}
