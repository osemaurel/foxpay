import { admin, requireEnv, SITE_URL } from '../_shared/admin.ts'
import {
  catalogueUnifie,
  resolveurDeMethodes,
  type Methode,
  type Verdict,
} from '../_shared/catalogue.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { describeFailure } from '../_shared/failures.ts'
import {
  createDeposit,
  DepositRejected,
  formatAmount,
  predictProvider,
  priceForCountry,
  type ShopCurrency,
  withFee,
} from '../_shared/pawapay.ts'
import { createCollection, SebPayError } from '../_shared/sebpay.ts'

/**
 * Demande le paiement, chez le processeur qui a la charge de cette méthode.
 *
 * Le navigateur n'envoie qu'une intention : un pays et un slug de méthode
 * (« wave », « mtn »). C'est ici, contre le catalogue réel et le routage choisi
 * par le vendeur, qu'on décide qui encaisse et sous quel identifiant. Sans cette
 * revalidation, une requête forgée pourrait payer 1 franc un produit à 15 000.
 */

type Body = {
  slug?: string
  product_slug?: string
  buyer_name?: string
  buyer_email?: string
  phone?: string
  country?: string
  provider?: string
  /** Code à usage unique, pour les opérateurs qui en exigent un. */
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
  const choix = body.provider?.trim()
  const phone = body.phone?.trim()

  if (!slug) return fail('Boutique manquante')
  if (!name) return fail('Ton nom est nécessaire')
  if (!email || !EMAIL.test(email)) return fail('Cet email est invalide')
  if (!country || !choix) return fail('Choisis ton pays et ton opérateur')
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

  // ---- Qui encaisse, et sous quel identifiant ------------------------------

  let catalogue: Methode[]
  let reglage: (m: Methode) => Verdict
  try {
    ;[catalogue, reglage] = await Promise.all([catalogueUnifie(), resolveurDeMethodes(shop.id)])
  } catch (e) {
    console.error('create-payment: catalogue', e)
    return fail('Les moyens de paiement sont momentanément indisponibles.', 502)
  }

  const methode = catalogue.find((m) => m.country === country && m.method === choix)
  if (!methode) return fail("Cet opérateur n'est pas disponible", 400)

  // Une méthode retirée par le vendeur est refusée ici aussi : la page ne la
  // propose plus, mais une requête forgée passerait sans cette vérification.
  const { processeur, active } = reglage(methode)
  if (!active || !processeur) return fail("Cet opérateur n'est pas disponible", 400)
  if (processeur === 'pawapay' && methode.pawapay?.status === 'CLOSED') {
    return fail(describeFailure('PROVIDER_TEMPORARILY_UNAVAILABLE'), 409)
  }

  // ---- Le montant ---------------------------------------------------------
  // Le débit inclut les frais de paiement, exactement comme la page l'a annoncé
  // à l'acheteur : le même calcul des deux côtés.

  const { data: extras } = await admin
    .from('shop_currencies')
    .select('currency, rate, decimals, round_to')
    .eq('shop_id', shop.id)
    .eq('is_active', true)

  const priced = priceForCountry(country, withFee(item.price), (extras ?? []) as ShopCurrency[])
  if (!priced || priced.currency !== methode.currency) {
    return fail("Ce produit n'est pas en vente dans ce pays", 400)
  }

  const decimals = processeur === 'pawapay' ? (methode.pawapay!.decimals) : 'NONE'
  const amount = formatAmount(priced.amount, decimals)

  if (processeur === 'pawapay') {
    const { minAmount, maxAmount } = methode.pawapay!
    if ((minAmount && Number(amount) < minAmount) || (maxAmount && Number(amount) > maxAmount)) {
      return fail(describeFailure('AMOUNT_OUT_OF_BOUNDS'), 409)
    }
  }

  const otp = body.otp?.trim() || null
  const otpRequis =
    processeur === 'pawapay'
      ? methode.pawapay!.authType === 'PREAUTH'
      : Boolean(methode.sebpay!.otpRequired)

  if (otpRequis && !otp) {
    return fail("Cet opérateur demande un code d'autorisation avant le paiement")
  }

  // ---- Le numéro ----------------------------------------------------------

  let numero: string
  if (processeur === 'pawapay') {
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
      return fail(`Ce numéro n'est pas un numéro ${methode.countryName}`)
    }
    numero = prediction.phoneNumber
  } else {
    // Le prédicteur de pawaPay ne connaît que les pays de pawaPay : l'utiliser
    // ici rejetterait des numéros togolais parfaitement valides. On se contente
    // donc de la forme — indicatif du pays choisi, longueur plausible.
    const propre = normaliserNumero(phone, methode.prefix)
    if (!propre) return fail(`Ce numéro n'est pas un numéro ${methode.countryName}`)
    numero = propre
  }

  // ---- La commande, avant l'appel -----------------------------------------
  // Elle est écrite d'abord : si la réponse du processeur se perd en route, il
  // reste de quoi aller redemander l'état du paiement.

  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      shop_id: shop.id,
      product_id: item.id,
      buyer_email: email,
      buyer_name: name,
      buyer_phone: numero,
      amount: item.price,
      currency: item.currency,
      charged_amount: Number(amount),
      charged_currency: priced.currency,
      country,
      provider: processeur,
      // L'identifiant réellement envoyé au processeur, pas le slug interne :
      // c'est lui qui permet de retrouver la transaction chez eux.
      mmo_provider: processeur === 'pawapay' ? methode.pawapay!.provider : methode.sebpay!.code,
    })
    .select('id, deposit_id')
    .single()

  if (orderError) return fail(`Création de la commande impossible : ${orderError.message}`, 500)

  return processeur === 'pawapay'
    ? await payerPawapay({ order, methode, amount, currency: priced.currency, numero, otp, item, shop })
    : await payerSebpay({ order, methode, amount, currency: priced.currency, numero, otp })
})

/**
 * Vérifie qu'un numéro a bien la forme d'un numéro du pays choisi, et le rend
 * en chiffres seuls. Renvoie null s'il n'a pas le bon indicatif ou une longueur
 * plausible — c'est tout ce qu'on peut affirmer sans annuaire.
 */
function normaliserNumero(phone: string, prefix: string): string | null {
  const chiffres = phone.replace(/\D/g, '')
  if (!chiffres.startsWith(prefix)) return null

  const national = chiffres.slice(prefix.length)
  if (national.length < 6 || national.length > 12) return null

  return chiffres
}

type Contexte = {
  order: { id: string; deposit_id: string }
  methode: Methode
  amount: string
  currency: string
  numero: string
  otp: string | null
}

async function payerPawapay(
  ctx: Contexte & { item: Product; shop: { slug: string } },
): Promise<Response> {
  const { order, methode, item, shop } = ctx
  const returnUrl = `${SITE_URL()}/boutique/${shop.slug}/checkout/${item.slug}?order=${order.id}`

  try {
    const { nextStep } = await createDeposit({
      depositId: order.deposit_id,
      amount: ctx.amount,
      currency: ctx.currency,
      phoneNumber: ctx.numero,
      provider: methode.pawapay!.provider,
      customerMessage: item.title,
      clientReferenceId: order.id,
      preAuthorisationCode: ctx.otp,
      // Utilisés uniquement par les opérateurs à redirection (Wave) : ils
      // ramènent l'acheteur sur sa page de paiement, pas ailleurs.
      ...(methode.pawapay!.authType === 'REDIRECT_AUTH'
        ? { successfulUrl: returnUrl, failedUrl: returnUrl }
        : {}),
    })

    return json({ order_id: order.id, next_step: nextStep })
  } catch (e) {
    if (e instanceof DepositRejected) {
      await marquerEchec(order.id, e.code, e.message)
      console.warn('create-payment: rejet pawapay', e.code, e.message)
      return json({ error: describeFailure(e.code), failure_code: e.code }, 409)
    }

    // Panne réseau ou réponse illisible : on ne sait pas si le dépôt est parti.
    // La commande reste en attente et le suivi tranchera — la marquer en échec
    // ici pourrait faire passer pour perdu un paiement effectivement débité.
    console.error('create-payment: pawapay', e)
    return json({ order_id: order.id, next_step: null })
  }
}

async function payerSebpay(ctx: Contexte): Promise<Response> {
  const { order, methode } = ctx

  try {
    const collecte = await createCollection({
      // SebPay attend un nombre. Les devises servies ici n'ont pas de centimes,
      // et le montant a déjà été arrondi à l'entier plus haut.
      amount: Number(ctx.amount),
      currency: ctx.currency,
      phone: ctx.numero,
      operator: methode.sebpay!.code,
      country: methode.sebpay!.alpha2,
      // Notre identifiant de commande sert de clé de réconciliation : c'est lui
      // que le webhook renverra, et lui qu'accepte GET /collections/{ref}.
      externalReference: order.id,
      callbackUrl: `${requireEnv('SUPABASE_URL')}/functions/v1/sebpay-callback`,
      otpCode: ctx.otp,
    })

    // Wave et consorts imposent leur propre écran d'autorisation. Le lien est
    // gardé sur la commande : la page de suivi y enverra l'acheteur, même s'il
    // a rechargé entre-temps.
    if (collecte.provider_link) {
      await admin
        .from('orders')
        .update({
          authorization_url: collecte.provider_link,
          provider_transaction_id: collecte.transaction_id ?? null,
        })
        .eq('id', order.id)
    } else if (collecte.transaction_id) {
      await admin
        .from('orders')
        .update({ provider_transaction_id: collecte.transaction_id })
        .eq('id', order.id)
    }

    return json({
      order_id: order.id,
      next_step: collecte.provider_link ? 'REDIRECT_TO_AUTH_URL' : null,
      // Renvoyé tout de suite : attendre le premier sondage ferait patienter
      // l'acheteur trois secondes devant un écran qui ne le concerne pas.
      authorization_url: collecte.provider_link ?? null,
    })
  } catch (e) {
    if (e instanceof SebPayError && e.status < 500) {
      // Refus à l'initiation : numéro inconnu de l'opérateur, OTP faux, compte
      // bloqué. L'acheteur peut corriger, il faut donc le lui dire tout de suite.
      await marquerEchec(order.id, 'PAYMENT_REJECTED', e.message)
      console.warn('create-payment: rejet sebpay', e.status, e.message)
      return json({ error: describeFailure('PAYMENT_REJECTED'), failure_code: 'PAYMENT_REJECTED' }, 409)
    }

    // Comme chez pawaPay : sans réponse claire, on ne conclut pas à l'échec.
    console.error('create-payment: sebpay', e)
    return json({ order_id: order.id, next_step: null })
  }
}

function marquerEchec(orderId: string, code: string, raison: string) {
  return admin
    .from('orders')
    .update({ status: 'failed', failure_code: code, failure_reason: raison })
    .eq('id', orderId)
}
