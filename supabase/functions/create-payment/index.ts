import { admin, SITE_URL } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { describeFailure } from '../_shared/failures.ts'
import {
  createDeposit,
  DepositRejected,
  formatAmount,
  getActiveConf,
  predictProvider,
  priceForCountry,
  type ShopCurrency,
  withFee,
} from '../_shared/pawapay.ts'

type Body = {
  slug?: string
  product_slug?: string
  buyer_name?: string
  buyer_email?: string
  phone?: string
  country?: string
  provider?: string
  /** Code à usage unique, pour les opérateurs à préautorisation (Orange BFA). */
  otp?: string
}

type Product = {
  id: string
  slug: string
  title: string
  price: number
  currency: string
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

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
  const name = body.buyer_name?.trim()
  const email = body.buyer_email?.trim().toLowerCase()
  const country = body.country?.trim().toUpperCase()
  const provider = body.provider?.trim()
  const phone = body.phone?.trim()

  if (!slug) return fail('Boutique manquante')
  if (!name) return fail('Ton nom est nécessaire')
  if (!email || !EMAIL.test(email)) return fail('Cet email est invalide')
  if (!country || !provider) return fail('Choisis ton pays et ton opérateur')
  if (!phone) return fail('Ton numéro mobile money est nécessaire')

  const { data: shop } = await admin
    .from('shops')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle()

  if (!shop) return fail('Boutique introuvable', 404)

  const query = admin
    .from('products')
    .select('id, slug, title, price, currency')
    .eq('shop_id', shop.id)
    .eq('is_active', true)

  const { data: found } = body.product_slug
    ? await query.eq('slug', body.product_slug).maybeSingle()
    : await query.order('position').order('created_at').limit(1).maybeSingle()

  const item = found as Product | null
  if (!item) return fail("Ce produit n'est pas en vente", 404)
  if (item.price <= 0) return fail('Produit mal configuré', 409)

  // ---- Ce que le navigateur a envoyé n'est qu'une intention ---------------
  // Le pays, l'opérateur et le montant sont revalidés ici contre la
  // configuration réelle du compte. Sans ça, une requête forgée pourrait payer
  // 1 XOF un produit à 15 000.

  let conf
  try {
    conf = await getActiveConf()
  } catch (e) {
    console.error('create-payment: active-conf', e)
    return fail('Les moyens de paiement sont momentanément indisponibles.', 502)
  }

  const countryConf = conf.find((c) => c.country === country)
  const providerConf = countryConf?.providers.find((p) => p.provider === provider)
  if (!countryConf || !providerConf) return fail("Cet opérateur n'est pas disponible", 400)
  if (providerConf.deposit.status === 'CLOSED') {
    return fail(describeFailure('PROVIDER_TEMPORARILY_UNAVAILABLE'), 409)
  }

  const { data: extras } = await admin
    .from('shop_currencies')
    .select('currency, rate, decimals, round_to')
    .eq('shop_id', shop.id)
    .eq('is_active', true)

  // Le montant réellement débité inclut les frais de paiement, exactement comme
  // la page l'a annoncé à l'acheteur : le même calcul des deux côtés.
  const priced = priceForCountry(country, withFee(item.price), (extras ?? []) as ShopCurrency[])
  if (!priced || priced.currency !== providerConf.currency) {
    return fail("Ce produit n'est pas en vente dans ce pays", 400)
  }

  const amount = formatAmount(priced.amount, providerConf.deposit.decimalsInAmount)
  const { minAmount, maxAmount } = providerConf.deposit
  if ((minAmount && Number(amount) < minAmount) || (maxAmount && Number(amount) > maxAmount)) {
    return fail(describeFailure('AMOUNT_OUT_OF_BOUNDS'), 409)
  }

  if (providerConf.deposit.authType === 'PREAUTH' && !body.otp?.trim()) {
    return fail("Cet opérateur demande un code d'autorisation avant le paiement")
  }

  // ---- Le numéro ---------------------------------------------------------
  // pawaPay exige un MSISDN exact ; les acheteurs tapent des espaces et des
  // zéros en trop. C'est aussi le seul moyen de refuser un numéro invalide
  // avant de créer une commande.
  let prediction
  try {
    prediction = await predictProvider(phone)
  } catch (e) {
    console.error('create-payment: predict-provider', e)
    return fail('Impossible de vérifier ce numéro. Réessaie dans un instant.', 502)
  }

  if (!prediction) return fail("Ce numéro n'est pas valide")
  if (prediction.country !== country) {
    return fail(`Ce numéro n'est pas un numéro ${countryConf.name}`)
  }

  // ---- La commande, avant l'appel ----------------------------------------
  // Elle est écrite d'abord : si la réponse de pawaPay se perd en route, on a
  // toujours le deposit_id pour aller redemander l'état du paiement.
  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      shop_id: shop.id,
      product_id: item.id,
      buyer_email: email,
      buyer_name: name,
      buyer_phone: prediction.phoneNumber,
      amount: item.price,
      currency: item.currency,
      charged_amount: Number(amount),
      charged_currency: priced.currency,
      country,
      mmo_provider: provider,
    })
    .select('id, deposit_id')
    .single()

  if (orderError) return fail(`Création de la commande impossible : ${orderError.message}`, 500)

  const returnUrl = `${SITE_URL()}/boutique/${shop.slug}/checkout/${item.slug}?order=${order.id}`

  try {
    const { nextStep } = await createDeposit({
      depositId: order.deposit_id,
      amount,
      currency: priced.currency,
      phoneNumber: prediction.phoneNumber,
      provider,
      customerMessage: item.title,
      clientReferenceId: order.id,
      preAuthorisationCode: body.otp?.trim() || null,
      // Utilisés uniquement par les opérateurs à redirection (Wave) : ils
      // ramènent l'acheteur sur sa page de paiement, pas ailleurs.
      ...(providerConf.deposit.authType === 'REDIRECT_AUTH'
        ? { successfulUrl: returnUrl, failedUrl: returnUrl }
        : {}),
    })

    return json({ order_id: order.id, next_step: nextStep })
  } catch (e) {
    if (e instanceof DepositRejected) {
      await admin
        .from('orders')
        .update({ status: 'failed', failure_code: e.code, failure_reason: e.message })
        .eq('id', order.id)

      console.warn('create-payment: rejet', e.code, e.message)
      return json({ error: describeFailure(e.code), failure_code: e.code }, 409)
    }

    // Panne réseau ou réponse illisible : on ne sait pas si le dépôt est parti.
    // La commande reste en attente et le suivi tranchera — la marquer en échec
    // ici pourrait faire passer pour perdu un paiement effectivement débité.
    console.error('create-payment', e)
    return json({ order_id: order.id, next_step: null })
  }
})
