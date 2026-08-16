import { admin, SITE_URL } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { openPaymentPage } from '../_shared/pawapay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  let body: { slug?: string; buyer_email?: string; buyer_name?: string; buyer_phone?: string }
  try {
    body = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  const slug = body.slug?.trim()
  const email = body.buyer_email?.trim().toLowerCase()
  if (!slug) return fail('Boutique manquante')
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Email invalide')

  // La boutique et le produit, en une requête.
  const { data: shop } = await admin
    .from('shops')
    .select('id, slug, name, country, products(id, title, price, currency, is_active)')
    .eq('slug', slug)
    .maybeSingle()

  if (!shop) return fail('Boutique introuvable', 404)

  const product = (shop.products as { is_active: boolean }[] | null)?.find((p) => p.is_active) as
    | { id: string; title: string; price: number; currency: string }
    | undefined

  if (!product) return fail('Aucun produit en vente', 404)
  if (product.price <= 0) return fail('Produit mal configuré', 409)

  // Le montant est figé ici : un changement de prix ultérieur n'affecte pas
  // cette commande.
  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      shop_id: shop.id,
      product_id: product.id,
      buyer_email: email,
      buyer_name: body.buyer_name?.trim() || null,
      buyer_phone: body.buyer_phone?.replace(/\D/g, '') || null,
      amount: product.price,
      currency: product.currency,
      country: shop.country,
    })
    .select('id, deposit_id, buyer_phone')
    .single()

  if (orderError) return fail(`Création de la commande impossible : ${orderError.message}`, 500)

  try {
    const redirectUrl = await openPaymentPage({
      depositId: order.deposit_id,
      amount: product.price,
      currency: product.currency,
      country: shop.country,
      returnUrl: `${SITE_URL()}/boutique/${shop.slug}/retour?order=${order.id}`,
      reason: product.title,
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
