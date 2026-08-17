import { admin } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { detectCountry } from '../_shared/geo.ts'
import {
  formatAmount,
  getActiveConf,
  priceForCountry,
  type ShopCurrency,
} from '../_shared/pawapay.ts'

/**
 * Ce que la page de paiement a besoin de savoir : dans quels pays cette
 * boutique peut encaisser, avec quels opérateurs, et combien l'acheteur paiera
 * chez lui.
 *
 * La liste vient de la configuration réelle du compte pawaPay, pas d'une liste
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

  let body: { slug?: string; product_slug?: string }
  try {
    body = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

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
  const [productResult, extrasResult, confResult, detected] = await Promise.all([
    body.product_slug
      ? query.eq('slug', body.product_slug).maybeSingle()
      : query.order('position').order('created_at').limit(1).maybeSingle(),
    admin
      .from('shop_currencies')
      .select('currency, rate, decimals, round_to')
      .eq('shop_id', shop.id)
      .eq('is_active', true),
    getActiveConf().catch((e) => {
      console.error('payment-options: active-conf', e)
      return null
    }),
    // La géolocalisation est accessoire : son échec ne fait jamais échouer
    // la page, l'acheteur choisira son pays lui-même.
    detectCountry(req).catch(() => null),
  ])

  const product = productResult.data
  if (!product) return fail("Ce produit n'est pas en vente", 404)

  if (!confResult) return fail('Les moyens de paiement sont momentanément indisponibles.', 502)
  const conf = confResult
  const extras = extrasResult.data

  const countries = []

  for (const country of conf) {
    const priced = priceForCountry(country.country, product.price, (extras ?? []) as ShopCurrency[])
    if (!priced) continue

    const retenus = country.providers.filter(
      (p) => p.currency === priced.currency && p.deposit.status !== 'CLOSED',
    )

    const providers = retenus.map((p) => ({
        provider: p.provider,
        name: p.displayName,
        logo: p.logo,
        // Le montant dépend de l'opérateur : tous n'acceptent pas les décimales.
        amount: formatAmount(priced.amount, p.deposit.decimalsInAmount),
        auth_type: p.deposit.authType,
        pin_prompt: p.deposit.pinPrompt,
        pin_prompt_revivable: p.deposit.pinPromptRevivable,
        instructions: p.deposit.instructions,
        // Le nom qui s'affichera sur l'invite de code PIN. Le montrer d'avance
        // évite que l'acheteur prenne la demande pour une tentative d'arnaque.
        merchant_name: p.nameDisplayedToCustomer || null,
      }))

    if (providers.length > 0) {
      // Le prix barré suit la même conversion que le total : afficher
      // « 20 000 FCFA » au-dessus d'un total en francs congolais mélangerait
      // deux monnaies dans le même récapitulatif.
      const compare = product.compare_at_price
        ? priceForCountry(country.country, product.compare_at_price, (extras ?? []) as ShopCurrency[])
        : null

      countries.push({
        country: country.country,
        name: country.name,
        prefix: country.prefix,
        flag: country.flag,
        currency: priced.currency,
        compare_amount: compare
          ? formatAmount(compare.amount, retenus[0].deposit.decimalsInAmount)
          : null,
        providers,
      })
    }
  }

  countries.sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  // On ne renvoie le pays deviné que si la boutique y vend vraiment : ailleurs,
  // mieux vaut ne rien présélectionner que de présélectionner un pays inutile.
  const vendable = countries.some((c) => c.country === detected)

  return json({ countries, detected: vendable ? detected : null })
})
