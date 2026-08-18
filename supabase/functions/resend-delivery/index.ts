import { admin } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { settleOrder } from '../_shared/settle.ts'

/**
 * Renvoie l'email de livraison d'une vente, à la demande du vendeur.
 *
 * Deux usages : rattraper une commande payée dont l'email n'est jamais parti —
 * une panne d'envoi laisse la vente livrée à moitié — et réexpédier à un
 * acheteur qui ne trouve plus le sien.
 *
 * C'est settleOrder qui fait le travail : sur une commande déjà payée, il ne
 * refait que la livraison, et `delivered_at` l'empêche de partir deux fois.
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
  // cette vérification, un vendeur pourrait renvoyer les fichiers d'un autre.
  const { data: order } = await admin
    .from('orders')
    .select('id, status, delivered_at, buyer_email, shops!inner(owner_id)')
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return fail('Commande introuvable', 404)
  if ((order.shops as { owner_id: string }).owner_id !== auth.user.id) {
    return fail('Commande introuvable', 404)
  }
  if (order.status !== 'paid') return fail("Cette commande n'a pas été payée", 409)

  // Un renvoi demandé explicitement doit repartir même si le premier email a
  // été marqué comme envoyé — c'est tout l'intérêt quand l'acheteur l'a perdu.
  if (body.force && order.delivered_at) {
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

  return json({ ok: true, to: order.buyer_email, delivered_at: apres.delivered_at })
})
