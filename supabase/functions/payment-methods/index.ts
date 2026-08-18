import { admin } from '../_shared/admin.ts'
import { catalogueUnifie, processeurParDefaut } from '../_shared/catalogue.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'

/**
 * Toutes les méthodes de paiement connues des deux processeurs, avec celui qui
 * les traite aujourd'hui pour cette boutique.
 *
 * C'est la liste que montre l'écran de routage dans les paramètres. Elle ne peut
 * pas venir du navigateur : le catalogue s'obtient avec les clés API des deux
 * processeurs, qui ne doivent jamais quitter le serveur.
 *
 * L'enregistrement d'un choix, lui, passe directement par la base : la table
 * payment_routes n'est accessible qu'à la propriétaire de la boutique, et une
 * fonction de plus n'apporterait rien.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  // Le jeton est celui de la session admin. On s'en sert pour retrouver la
  // boutique de la personne connectée : rien n'est pris depuis le corps.
  const jeton = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jeton) return fail('Authentification requise', 401)

  const { data: auth } = await admin.auth.getUser(jeton)
  if (!auth?.user) return fail('Session expirée', 401)

  const { data: shop } = await admin
    .from('shops')
    .select('id')
    .eq('owner_id', auth.user.id)
    .maybeSingle()

  if (!shop) return fail('Boutique introuvable', 404)

  const [catalogue, routesResult] = await Promise.all([
    catalogueUnifie().catch((e) => {
      console.error('payment-methods: catalogue', e)
      return null
    }),
    admin.from('payment_routes').select('country, method, processor').eq('shop_id', shop.id),
  ])

  if (!catalogue) {
    return fail('Impossible de lire le catalogue des processeurs pour le moment.', 502)
  }

  const choix = new Map(
    (routesResult.data ?? []).map((r) => [`${r.country}:${r.method}`, r.processor as string]),
  )

  const methods = catalogue.map((m) => {
    // Un choix qui ne correspond plus à rien — opérateur retiré du compte —
    // est signalé plutôt que caché : sinon le vendeur croit router vers un
    // processeur qui, en réalité, ne traite plus cette méthode.
    const voulu = choix.get(`${m.country}:${m.method}`) ?? null
    const valide = voulu === 'pawapay' ? Boolean(m.pawapay) : voulu === 'sebpay' ? Boolean(m.sebpay) : false

    return {
      country: m.country,
      country_name: m.countryName,
      method: m.method,
      name: m.name,
      logo: m.logo,
      currency: m.currency,
      pawapay: Boolean(m.pawapay),
      sebpay: Boolean(m.sebpay),
      /** Le choix enregistré, s'il y en a un. */
      chosen: voulu,
      /** Le processeur qui traitera réellement le paiement. */
      effective: valide ? voulu : processeurParDefaut(m),
      /** Vrai quand un opérateur pawaPay est temporairement coupé. */
      closed: m.pawapay?.status === 'CLOSED',
    }
  })

  return json({ methods })
})
