import { admin } from '../_shared/admin.ts'
import {
  catalogueUnifie,
  nomPays,
  resolveurDeMethodes,
  type Methode,
  type Processeur,
} from '../_shared/catalogue.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { detectCountry } from '../_shared/geo.ts'
import { lireLangue } from '../_shared/langue.ts'
import { formatAmount, priceForCountry, type ShopCurrency, withFee } from '../_shared/pawapay.ts'

/**
 * Ce que la page de paiement a besoin de savoir : dans quels pays cette
 * boutique peut encaisser, avec quels opérateurs, et combien l'acheteur paiera
 * chez lui.
 *
 * La liste vient des catalogues réels des deux processeurs, pas d'une liste
 * écrite en dur : un opérateur activé ou coupé apparaît ou disparaît tout seul.
 * On ne garde que les pays dont on sait fixer le prix — proposer un pays sans
 * savoir quel montant y demander reviendrait à afficher un prix faux.
 *
 * La réponse porte aussi le pays deviné d'après l'IP, pour que la page s'ouvre
 * déjà remplie : indicatif et opérateurs visibles sans un clic.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  let body: { slug?: string; product_slug?: string; locale?: string }
  try {
    body = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  // Les noms de pays partent dans la langue de l'acheteur : il les lit dans une
  // liste déroulante, c'est le premier choix qu'on lui demande.
  const langue = lireLangue(body.locale)
  const slug = body.slug?.trim()
  if (!slug) return fail('Boutique manquante')

  const { data: shop } = await admin.from('shops').select('id').eq('slug', slug).maybeSingle()
  if (!shop) return fail('Boutique introuvable', 404)

  const query = admin
    .from('products')
    .select('price, compare_at_price')
    .eq('shop_id', shop.id)
    .eq('is_active', true)

  // Tout ce qui ne dépend que de shop.id part ensemble. Cette page est la
  // première chose que voit l'acheteur : chaque aller-retour en série se lit
  // comme une lenteur de la boutique.
  const [productResult, extrasResult, catalogue, reglage, detected] = await Promise.all([
    body.product_slug
      ? query.eq('slug', body.product_slug).maybeSingle()
      : query.order('position').order('created_at').limit(1).maybeSingle(),
    admin
      .from('shop_currencies')
      .select('currency, rate, decimals, round_to')
      .eq('shop_id', shop.id)
      .eq('is_active', true),
    catalogueUnifie(),
    resolveurDeMethodes(shop.id),
    // La géolocalisation est accessoire : son échec ne fait jamais échouer
    // la page, l'acheteur choisira son pays lui-même.
    detectCountry(req).catch(() => null),
  ])

  const product = productResult.data
  if (!product) return fail("Ce produit n'est pas en vente", 404)
  if (catalogue.length === 0) {
    return fail('Les moyens de paiement sont momentanément indisponibles.', 502)
  }

  const extras = (extrasResult.data ?? []) as ShopCurrency[]

  // Regroupé par pays : l'acheteur choisit d'abord où il est, ensuite comment
  // il paie.
  const parPays = new Map<string, Methode[]>()
  for (const m of catalogue) {
    const liste = parPays.get(m.country) ?? []
    liste.push(m)
    parPays.set(m.country, liste)
  }

  const countries = []

  for (const [code, methodes] of parPays) {
    // Deux passages dans la même conversion : le prix seul, puis le prix majoré
    // des frais. Les frais sont la différence des deux, donc l'addition affichée
    // à l'acheteur tombe juste même après arrondi.
    const base = priceForCountry(code, product.price, extras)
    const priced = priceForCountry(code, withFee(product.price), extras)
    if (!base || !priced) continue

    const providers = []

    for (const m of methodes) {
      // La devise du pays chez le processeur doit être celle qu'on sait
      // facturer : un opérateur qui n'encaisse qu'en naira n'a rien à faire
      // dans une boutique qui vend en franc CFA.
      if (m.currency !== priced.currency) continue

      // Une méthode retirée par le vendeur n'apparaît pas : c'est tout l'objet
      // du réglage, épurer la page de paiement de ce qui ne sert pas ici.
      const { processeur, active } = reglage(m)
      if (!active || !processeur) continue
      if (processeur === 'pawapay' && m.pawapay?.status === 'CLOSED') continue

      const decimals = processeur === 'pawapay' ? (m.pawapay?.decimals ?? 'NONE') : 'NONE'

      providers.push({
        // Le slug canonique, pas le code d'un processeur : la page n'a pas à
        // savoir lequel des deux traitera le paiement.
        provider: m.method,
        name: m.name,
        logo: m.logo,
        amount: formatAmount(priced.amount, decimals),
        ...detailsAuthentification(m, processeur),
      })
    }

    if (providers.length === 0) continue

    // Le prix barré suit la même conversion que le total — sans quoi le
    // récapitulatif mélangerait deux monnaies — mais pas les frais : ceux-ci
    // ont leur propre ligne, et seraient sinon comptés deux fois.
    const compare = product.compare_at_price
      ? priceForCountry(code, product.compare_at_price, extras)
      : null

    const premier = methodes[0]
    countries.push({
      country: code,
      name: nomPays(code, langue, premier.countryName),
      prefix: premier.prefix,
      flag: methodes.find((m) => m.flag)?.flag ?? null,
      currency: priced.currency,
      base_amount: formatAmount(base.amount, 'NONE'),
      fee_amount: formatAmount(priced.amount - base.amount, 'NONE'),
      compare_amount: compare ? formatAmount(compare.amount, 'NONE') : null,
      providers,
    })
  }

  countries.sort((a, b) => a.name.localeCompare(b.name, langue))

  // On ne renvoie le pays deviné que si la boutique y vend vraiment : ailleurs,
  // mieux vaut ne rien présélectionner que de présélectionner un pays inutile.
  const vendable = countries.some((c) => c.country === detected)

  return json({ countries, detected: vendable ? detected : null })
})

/**
 * Comment l'acheteur autorisera le paiement, exprimé dans le vocabulaire que la
 * page connaît déjà — celui de pawaPay. SebPay décrit la même chose autrement :
 * un opérateur à OTP est un opérateur à préautorisation, et son code USSD tient
 * lieu d'instructions.
 */
function detailsAuthentification(m: Methode, processeur: Processeur) {
  if (processeur === 'pawapay' && m.pawapay) {
    return {
      auth_type: m.pawapay.authType,
      pin_prompt: m.pawapay.pinPrompt,
      pin_prompt_revivable: m.pawapay.pinPromptRevivable,
      instructions: m.pawapay.instructions,
      merchant_name: m.pawapay.merchantName,
    }
  }

  // SasPay pousse la demande directement, sans code à composer d'avance : du
  // point de vue de l'acheteur, c'est le même geste que chez pawaPay. Les rares
  // réseaux à OTP (Wizall, Coris) ne sont pas dans ce que vend la boutique, et
  // le catalogue n'expose de toute façon aucun indicateur pour les distinguer.
  if (processeur === 'saspay') {
    return {
      auth_type: 'PROVIDER_AUTH',
      pin_prompt: 'AUTOMATIC',
      pin_prompt_revivable: false,
      instructions: null,
      merchant_name: null,
    }
  }

  const seb = m.sebpay!
  return {
    auth_type: seb.otpRequired ? 'PREAUTH' : 'PROVIDER_AUTH',
    pin_prompt: seb.otpRequired ? null : 'AUTOMATIC',
    pin_prompt_revivable: false,
    // Les étapes reprennent la forme de celles de pawaPay, dans les deux
    // langues : la page de paiement les affiche sans savoir d'où elles viennent.
    instructions: seb.ussdCode
      ? {
          channels: [
            {
              type: 'USSD',
              displayName: {
                fr: 'Pour obtenir ton code de validation',
                en: 'To get your confirmation code',
              },
              quickLink: seb.ussdCode,
              instructions: {
                fr: [
                  { text: `Compose ${seb.ussdCode} sur ton téléphone` },
                  { text: 'Note le code reçu par SMS' },
                ],
                en: [
                  { text: `Dial ${seb.ussdCode} on your phone` },
                  { text: 'Note down the code you receive by SMS' },
                ],
              },
            },
          ],
        }
      : null,
    merchant_name: null,
  }
}
