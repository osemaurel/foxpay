import { admin, SITE_URL } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { openPaymentPage } from '../_shared/pawapay.ts'

type Body = {
  slug?: string
  product_slug?: string
  buyer_email?: string
  buyer_name?: string
  buyer_phone?: string
}

type Product = {
  id: string
  slug: string
  title: string
  price: number
  currency: string
  is_active: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  const slug = body.slug?.trim()
  const email = body.buyer_email?.trim().toLowerCase()
  if (!slug) return fail('Boutique manquante')
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Email invalide')

  const { data: shop } = await admin
    .from('shops')
    .select('id, slug, name, country')
    .eq('slug', slug)
    .maybeSingle()

  if (!shop) return fail('Boutique introuvable', 404)

  // Le produit est désigné par son lien. Sans lui — vieil onglet ouvert avant
  // le passage au multi-produit — on retombe sur le premier produit en vente
  // plutôt que d'échouer.
  const query = admin
    .from('products')
    .select('id, slug, title, price, currency, is_active')
    .eq('shop_id', shop.id)
    .eq('is_active', true)

  const { data: product } = body.product_slug
    ? await query.eq('slug', body.product_slug).maybeSingle()
    : await query.order('position').order('created_at').limit(1).maybeSingle()

  const item = product as Product | null
  if (!item) return fail("Ce produit n'est pas en vente", 404)
  if (item.price <= 0) return fail('Produit mal configuré', 409)

  // Le montant est figé ici : un changement de prix ultérieur n'affecte pas
  // cette commande.
  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      shop_id: shop.id,
      product_id: item.id,
      buyer_email: email,
      buyer_name: body.buyer_name?.trim() || null,
      buyer_phone: body.buyer_phone?.replace(/\D/g, '') || null,
      amount: item.price,
      currency: item.currency,
      country: shop.country,
    })
    .select('id, deposit_id, buyer_phone')
    .single()

  if (orderError) return fail(`Création de la commande impossible : ${orderError.message}`, 500)

  try {
    const redirectUrl = await openPaymentPage({
      depositId: order.deposit_id,
      amount: item.price,
      currency: item.currency,
      country: shop.country,
      returnUrl: `${SITE_URL()}/boutique/${shop.slug}/retour?order=${order.id}`,
      reason: item.title,
      msisdn: order.buyer_phone,
    })

    await admin.from('orders').update({ checkout_url: redirectUrl }).eq('id', order.id)
    return json({ orderId: order.id, redirectUrl })
  } catch (e) {
    // La commande reste tracée en 'failed' : on veut voir les échecs
    // d'initiation dans l'admin, pas seulement les paiements refusés.
    await admin
      .from('orders')
      .update({ status: 'failed', failure_reason: (e as Error).message })
      .eq('id', order.id)

    console.error('create-payment', e)
    return fail("Le paiement n'a pas pu être initié. Réessaie dans un instant.", 502)
  }
})
