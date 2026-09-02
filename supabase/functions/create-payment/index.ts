import { admin, requireEnv, SITE_URL } from '../_shared/admin.ts'
import {
  catalogueUnifie,
  nomPays,
  resolveurDeMethodes,
  type Methode,
  type Verdict,
} from '../_shared/catalogue.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { describeFailure } from '../_shared/failures.ts'
import { lireLangue, type Langue } from '../_shared/langue.ts'
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
import { creerPaiement, SasPayError } from '../_shared/saspay.ts'

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
  /** La langue que lit l'acheteur, détectée par la page de paiement. */
  locale?: string
}

/**
 * Les refus que voit l'acheteur, dans sa langue.
 *
 * Ce ne sont pas des erreurs techniques : chacun lui dit ce qu'il peut corriger
 * sur le formulaire. Les vrais échecs de paiement, eux, passent par
 * describeFailure(). Ce qui reste en français ici — corps JSON illisible,
 * méthode HTTP interdite — n'arrive jamais depuis la page de paiement.
 */
const MESSAGES = {
  boutiqueManquante: { fr: 'Boutique manquante', en: 'Missing shop' },
  nomRequis: { fr: 'Ton nom est nécessaire', en: 'Your name is required' },
  emailInvalide: { fr: 'Cet email est invalide', en: 'This email address is invalid' },
  paysEtOperateur: {
    fr: 'Choisis ton pays et ton opérateur',
    en: 'Choose your country and your provider',
  },
  numeroRequis: {
    fr: 'Ton numéro mobile money est nécessaire',
    en: 'Your mobile money number is required',
  },
  boutiqueIntrouvable: { fr: 'Boutique introuvable', en: 'Shop not found' },
  produitPasEnVente: { fr: "Ce produit n'est pas en vente", en: "This product isn't on sale" },
  produitMalConfigure: { fr: 'Produit mal configuré', en: 'This product is misconfigured' },
  moyensIndisponibles: {
    fr: 'Les moyens de paiement sont momentanément indisponibles.',
    en: 'Payment methods are temporarily unavailable.',
  },
  operateurIndisponible: {
    fr: "Cet opérateur n'est pas disponible",
    en: "This provider isn't available",
  },
  pasEnVenteIci: {
    fr: "Ce produit n'est pas en vente dans ce pays",
    en: "This product isn't on sale in that country",
  },
  otpRequis: {
    fr: "Cet opérateur demande un code d'autorisation avant le paiement",
    en: 'This provider requires an authorisation code before payment',
  },
  numeroInverifiable: {
    fr: 'Impossible de vérifier ce numéro. Réessaie dans un instant.',
    en: "We couldn't check this number. Try again in a moment.",
  },
  numeroInvalide: { fr: "Ce numéro n'est pas valide", en: 'This number is not valid' },
  pasDuPays: {
    fr: (pays: string) => `Ce numéro n'est pas un numéro ${pays}`,
    en: (pays: string) => `This isn't a ${pays} number`,
  },
  commandeImpossible: {
    fr: (raison: string) => `Création de la commande impossible : ${raison}`,
    en: (raison: string) => `Could not create the order: ${raison}`,
  },
} as const

type Product = {
  id: string
  slug: string
  title: string
  price: number
  currency: string
}

// L'extension fait au moins deux lettres : il n'en existe aucune d'une seule,
// et une adresse comme « mau@t.v » passait notre contrôle pour se faire refuser
// par le processeur, après la création de la commande.
const EMAIL = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*\.[A-Za-z]{2,}$/

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
  const langue = lireLangue(body.locale)

  // Le type de retour est celui de la version française : les deux versions
  // ayant la même forme, une entrée à paramètre reste une fonction typée.
  function dire<K extends keyof typeof MESSAGES>(cle: K): (typeof MESSAGES)[K]['fr'] {
    return MESSAGES[cle][langue] as (typeof MESSAGES)[K]['fr']
  }

  if (!slug) return fail(dire('boutiqueManquante'))
  if (!name) return fail(dire('nomRequis'))
  if (!email || !EMAIL.test(email)) return fail(dire('emailInvalide'))
  if (!country || !choix) return fail(dire('paysEtOperateur'))
  if (!phone) return fail(dire('numeroRequis'))

  const { data: shop } = await admin
    .from('shops')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle()

  if (!shop) return fail(dire('boutiqueIntrouvable'), 404)

  const query = admin
    .from('products')
    .select('id, slug, title, price, currency')
    .eq('shop_id', shop.id)
    .eq('is_active', true)

  const { data: found } = body.product_slug
    ? await query.eq('slug', body.product_slug).maybeSingle()
    : await query.order('position').order('created_at').limit(1).maybeSingle()

  const item = found as Product | null
  if (!item) return fail(dire('produitPasEnVente'), 404)
  if (item.price <= 0) return fail(dire('produitMalConfigure'), 409)

  // ---- Qui encaisse, et sous quel identifiant ------------------------------

  let catalogue: Methode[]
  let reglage: (m: Methode) => Verdict
  try {
    ;[catalogue, reglage] = await Promise.all([catalogueUnifie(), resolveurDeMethodes(shop.id)])
  } catch (e) {
    console.error('create-payment: catalogue', e)
    return fail(dire('moyensIndisponibles'), 502)
  }

  const methode = catalogue.find((m) => m.country === country && m.method === choix)
  if (!methode) return fail(dire('operateurIndisponible'), 400)

  // Une méthode retirée par le vendeur est refusée ici aussi : la page ne la
  // propose plus, mais une requête forgée passerait sans cette vérification.
  const { processeur, active } = reglage(methode)
  if (!active || !processeur) return fail(dire('operateurIndisponible'), 400)
  if (processeur === 'pawapay' && methode.pawapay?.status === 'CLOSED') {
    return fail(describeFailure('PROVIDER_TEMPORARILY_UNAVAILABLE', langue), 409)
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
    return fail(dire('pasEnVenteIci'), 400)
  }

  const decimals = processeur === 'pawapay' ? (methode.pawapay!.decimals) : 'NONE'
  const amount = formatAmount(priced.amount, decimals)

  if (processeur === 'pawapay') {
    const { minAmount, maxAmount } = methode.pawapay!
    if ((minAmount && Number(amount) < minAmount) || (maxAmount && Number(amount) > maxAmount)) {
      return fail(describeFailure('AMOUNT_OUT_OF_BOUNDS', langue), 409)
    }
  }

  const otp = body.otp?.trim() || null
  // SasPay pousse la demande sans code préalable : seuls quelques réseaux qu'on
  // ne sert pas en réclament un, et leur catalogue ne les signale pas.
  const otpRequis =
    processeur === 'pawapay'
      ? methode.pawapay!.authType === 'PREAUTH'
      : processeur === 'sebpay'
        ? Boolean(methode.sebpay!.otpRequired)
        : false

  if (otpRequis && !otp) {
    return fail(dire('otpRequis'))
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
      return fail(dire('numeroInverifiable'), 502)
    }

    if (!prediction) return fail(dire('numeroInvalide'))
    if (prediction.country !== country) {
      return fail(dire('pasDuPays')(nomPays(country, langue, methode.countryName)))
    }
    numero = prediction.phoneNumber
  } else {
    // Le prédicteur de pawaPay ne connaît que les pays de pawaPay : l'utiliser
    // ici rejetterait des numéros togolais parfaitement valides. On se contente
    // donc de la forme — indicatif du pays choisi, longueur plausible.
    const propre = normaliserNumero(phone, methode.prefix)
    if (!propre) return fail(dire('pasDuPays')(nomPays(country, langue, methode.countryName)))
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
      locale: langue,
      provider: processeur,
      // L'identifiant réellement envoyé au processeur, pas le slug interne :
      // c'est lui qui permet de retrouver la transaction chez eux.
      mmo_provider:
        processeur === 'pawapay'
          ? methode.pawapay!.provider
          : processeur === 'saspay'
            ? methode.saspay!.code
            : methode.sebpay!.code,
    })
    .select('id, deposit_id')
    .single()

  if (orderError) return fail(dire('commandeImpossible')(orderError.message), 500)

  const ctx = { order, methode, amount, currency: priced.currency, numero, otp, langue }

  if (processeur === 'pawapay') return await payerPawapay({ ...ctx, item, shop })
  if (processeur === 'saspay') return await payerSaspay({ ...ctx, email, name })
  return await payerSebpay(ctx)
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
  langue: Langue
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
      return json({ error: describeFailure(e.code, ctx.langue), failure_code: e.code }, 409)
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
      return json(
        { error: describeFailure('PAYMENT_REJECTED', ctx.langue), failure_code: 'PAYMENT_REJECTED' },
        409,
      )
    }

    // Comme chez pawaPay : sans réponse claire, on ne conclut pas à l'échec.
    console.error('create-payment: sebpay', e)
    return json({ order_id: order.id, next_step: null })
  }
}

/**
 * SasPay demande un prénom et un nom séparés, là où la boutique ne collecte
 * qu'un nom complet. On coupe au premier espace — et jamais de champ vide, que
 * l'API refuserait.
 */
function couperNom(complet: string): { prenom: string; nom: string } {
  const morceaux = complet.trim().split(/\s+/)
  if (morceaux.length < 2) return { prenom: complet.trim() || 'Client', nom: complet.trim() || 'Client' }
  return { prenom: morceaux[0], nom: morceaux.slice(1).join(' ') }
}

/**
 * L'adresse qu'on déclare à SasPay pour l'acheteur.
 *
 * SasPay envoie son propre reçu à l'adresse qu'on lui donne : un courrier de
 * plus, d'un expéditeur que l'acheteur ne connaît pas, juste avant le nôtre.
 * Leur API n'offre aucun moyen de le couper — ni champ sur le paiement, ni
 * réglage marchand exposé —, et `customer.email` est obligatoire. Le seul
 * levier est donc de ne pas leur donner l'adresse de l'acheteur.
 *
 * Ce qu'on y perd : chez eux, toutes nos transactions portent la même adresse.
 * Le rapprochement reste possible par le téléphone, qui est le vrai
 * identifiant, et par `metadata.order_id` qu'on envoie déjà.
 *
 * Sans le secret — ou avec un secret mal formé —, on continue d'envoyer
 * l'adresse de l'acheteur : la boutique ne doit pas dépendre d'une
 * configuration pour encaisser. Le contrôle de forme n'est pas de la
 * prudence gratuite : SasPay refuserait une adresse invalide par un
 * `validation_error`, que nous traduisons en « corrige ton email » — et
 * l'acheteur passerait sa journée à corriger le sien, qui n'y est pour rien.
 */
function emailDeclare(acheteur: string): string {
  const substitut = Deno.env.get('SASPAY_CUSTOMER_EMAIL')?.trim()
  return substitut && EMAIL.test(substitut) ? substitut : acheteur
}

async function payerSaspay(ctx: Contexte & { email: string; name: string }): Promise<Response> {
  const { order, methode } = ctx
  const { prenom, nom } = couperNom(ctx.name)

  let paiement
  try {
    paiement = await creerPaiement({
      // L'identifiant de la commande sert de clé d'idempotence : un retry
      // réseau ne doit jamais pousser une seconde demande sur le téléphone.
      reference: order.id,
      amount: Number(ctx.amount),
      currency: ctx.currency,
      country: methode.saspay!.alpha2,
      network: methode.saspay!.code,
      phone: ctx.numero,
      email: emailDeclare(ctx.email),
      prenom,
      nom,
      description: 'Achat en ligne',
    })
  } catch (e) {
    if (e instanceof SasPayError && e.status < 500) {
      // Refus à l'initiation. Deux familles bien distinctes : ce que l'acheteur
      // a saisi et peut corriger — son email, son numéro —, et ce qui ne dépend
      // pas de lui, réseau inactif ou aucun gateway disponible. Les confondre
      // sous « l'opérateur a refusé » enverrait quelqu'un réessayer en boucle
      // avec la même adresse invalide.
      const saisie = e.code === 'validation_error' || e.code === 'invalid_customer'
      const code = saisie ? 'INVALID_CUSTOMER' : 'PAYMENT_REJECTED'

      await marquerEchec(order.id, code, e.message)
      console.warn('create-payment: rejet saspay', e.status, e.code, e.message)
      return json({ error: describeFailure(code, ctx.langue), failure_code: code }, 409)
    }

    // Comme ailleurs : sans réponse claire, on ne conclut pas.
    console.error('create-payment: saspay', e)
    return json({ order_id: order.id, next_step: null })
  }

  // L'identifiant SasPay est ce qui relie leur webhook à cette commande : leur
  // enveloppe ne renvoie pas nos métadonnées. Il est donc gardé tout de suite.
  await admin.from('orders').update({ deposit_id: paiement.id }).eq('id', order.id)

  return json({
    order_id: order.id,
    // Rare, mais prévu par leur documentation : certains réseaux retombent sur
    // un écran d'autorisation au lieu du push direct.
    next_step: paiement.checkout_url ? 'REDIRECT_TO_AUTH_URL' : null,
    authorization_url: paiement.checkout_url || null,
  })
}

function marquerEchec(orderId: string, code: string, raison: string) {
  return admin
    .from('orders')
    .update({ status: 'failed', failure_code: code, failure_reason: raison })
    .eq('id', orderId)
}
