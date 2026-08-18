/**
 * Faux Supabase, uniquement pour la preview statique (`npm run build:demo`).
 *
 * Le plugin `mock-supabase` de vite.demo.config.ts redirige tous les imports de
 * `lib/supabase` vers ce fichier. Les pages et composants ne sont pas modifiés :
 * ce qu'on regarde dans la preview est exactement ce qui tourne en production,
 * avec des données en dur à la place du réseau.
 */
import type { Order, Product, Review, Shop } from './types'

/** La preview n'a rien à configurer. */
export const missingEnv: string[] = []

const svg = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`

const LOGO = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="#121212"/><text x="48" y="62" font-family="Inter,system-ui,sans-serif" font-weight="500" font-size="40" fill="#bf854a" text-anchor="middle">K</text></svg>`,
)

const BANNER = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320"><defs><radialGradient id="a" cx="0.3" cy="0" r="0.9"><stop offset="0" stop-color="#bf854a" stop-opacity="0.55"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="320" fill="#000000"/><rect width="1200" height="320" fill="url(#a)"/></svg>`,
)

/** Couvertures carrées, comme la boutique les affiche. */
const cover = (ligne1: string, ligne2: string, teinte: string) =>
  svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><radialGradient id="g" cx="0.75" cy="0.15" r="0.85"><stop offset="0" stop-color="${teinte}" stop-opacity="0.5"/><stop offset="1" stop-color="#050505" stop-opacity="0"/></radialGradient></defs><rect width="600" height="600" fill="#050505"/><rect width="600" height="600" fill="url(#g)"/><text x="48" y="300" font-family="Inter,system-ui,sans-serif" font-weight="500" font-size="42" letter-spacing="-1.4" fill="#ffffff">${ligne1}</text><text x="48" y="352" font-family="Inter,system-ui,sans-serif" font-weight="500" font-size="42" letter-spacing="-1.4" fill="${teinte}">${ligne2}</text></svg>`,
  )

const now = new Date()
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString()

const shop: Shop = {
  id: 'shop-1',
  owner_id: 'user-1',
  slug: 'atelier-kodi',
  name: 'Atelier Kôdi',
  description:
    "J'accompagne les indépendants d'Abidjan qui veulent vendre leurs services en ligne sans y passer leurs nuits.",
  logo_url: LOGO,
  banner_url: BANNER,
  accent_color: '#bf854a',
  contact_email: 'bonjour@atelierkodi.ci',
  // Aucun pixel dans l'aperçu : pas de script tiers ni d'appel vers Meta.
  facebook_pixel_id: null,
  created_at: daysAgo(60),
  updated_at: daysAgo(2),
}

const CATALOGUE: [string, string, string, string, number, string, boolean][] = [
  [
    'vendre-en-ligne',
    "Vendre en ligne en Côte d'Ivoire",
    'Vendre en ligne',
    "en Côte d'Ivoire",
    15000,
    '#bf854a',
    true,
  ],
  [
    'pack-factures',
    'Pack de factures et devis prêts à remplir',
    'Factures',
    'et devis',
    7500,
    '#7c9cbf',
    true,
  ],
  [
    'relances-whatsapp',
    'Les 30 messages de relance WhatsApp',
    '30 messages',
    'de relance',
    5000,
    '#8fbf85',
    true,
  ],
  [
    'atelier-tarifs',
    'Atelier : fixer ses tarifs sans se brader',
    'Fixer',
    'ses tarifs',
    25000,
    '#bf85a8',
    false,
  ],
]

const products: Product[] = CATALOGUE.map(
  ([slug, title, l1, l2, price, teinte, actif], i) => ({
    id: `product-${i}`,
    shop_id: 'shop-1',
    slug,
    position: i,
    title,
    description:
      i === 0
        ? "<p>84 pages pour passer de « je poste sur WhatsApp » à une boutique qui encaisse toute seule.</p><p><strong>Au programme :</strong></p><ul><li>choisir son offre et la formuler</li><li>fixer son prix en FCFA</li><li>brancher le mobile money</li><li>les 12 messages de relance qui marchent</li></ul>"
        : `<p>${title}. Livré immédiatement après paiement, sans intermédiaire.</p>`,
    price,
    // Un prix barré sur deux produits, pour montrer les deux rendus.
    compare_at_price: i % 2 === 0 ? Math.round((price * 4) / 3 / 500) * 500 : null,
    currency: 'XOF',
    cta_label: i === 0 ? 'Je le veux' : null,
    cta_color: null,
    cover_url: cover(l1, l2, teinte),
    file_path: `shop-1/file-${i}.pdf`,
    file_name: `${slug}.pdf`,
    file_size: 1_200_000 * (i + 2),
    is_active: actif,
    created_at: daysAgo(45 - i),
    updated_at: daysAgo(2),
  }),
)

/**
 * Sept commandes qui couvrent ce que l'administration doit savoir montrer :
 * plusieurs pays, plusieurs opérateurs, un paiement converti en francs
 * congolais, une attente, et deux échecs pour des raisons différentes.
 */
const COMMANDES: [string, string, Order['status'], number, number, string, string, string | null][] =
  [
    ['aminata.kone@gmail.com', 'Aminata Koné', 'paid', 0, 0, 'CIV', 'ORANGE_CIV', null],
    ['serge.bamba@yahoo.fr', 'Serge Bamba', 'paid', 1, 1, 'CIV', 'MTN_MOMO_CIV', null],
    ['fatou.d@outlook.com', 'Fatou Diallo', 'pending', 1, 0, 'SEN', 'WAVE_SEN', null],
    ['k.yao@gmail.com', 'Kouamé Yao', 'paid', 2, 2, 'CMR', 'MTN_MOMO_CMR', null],
    [
      'moussa.traore@gmail.com',
      'Moussa Traoré',
      'failed',
      3,
      0,
      'CIV',
      'MOOV_CIV',
      'INSUFFICIENT_BALANCE',
    ],
    ['awa.cisse@gmail.com', 'Awa Cissé', 'paid', 5, 1, 'COD', 'VODACOM_MPESA_COD', null],
    [
      'jb.kouassi@gmail.com',
      'Jean-Baptiste Kouassi',
      'failed',
      8,
      0,
      'SEN',
      'ORANGE_SEN',
      'PAYMENT_NOT_APPROVED',
    ],
  ]

const INDICATIFS: Record<string, string> = { CIV: '225', SEN: '221', CMR: '237', COD: '243' }
const TAUX_CDF = 4.042129
const avecFraisDemo = (prix: number) => Math.ceil(prix * 1.03)

const orders: Order[] = COMMANDES.map(
  ([email, nom, status, days, produit, pays, operateur, echec], i) => {
    const prix = products[produit].price
    const congolais = pays === 'COD'
      ? Math.round((avecFraisDemo(prix) * TAUX_CDF) / 100) * 100
      : null

    return {
      id: `order-${i}`,
      shop_id: 'shop-1',
      product_id: `product-${produit}`,
      buyer_email: email,
      buyer_name: nom,
      // L'indicatif suit le pays : un numéro ivoirien sur une vente congolaise
      // se remarque tout de suite dans l'aperçu.
      buyer_phone: `${INDICATIFS[pays]}0700${String(10 + i).padStart(4, '0')}`,
      amount: prix,
      currency: 'XOF',
      charged_amount: congolais ?? avecFraisDemo(prix),
      charged_currency: congolais ? 'CDF' : 'XOF',
      status,
      provider: 'pawapay',
      mmo_provider: operateur,
      deposit_id: `4a1f${i}b93-7849-49aa-babb-4c3ccbfe3d7${i}`,
      country: pays,
      provider_transaction_id: status === 'paid' ? `PP${8371000 + i * 137}` : null,
      failure_code: echec,
      failure_reason:
        echec === 'INSUFFICIENT_BALANCE'
          ? 'The customer does not have enough funds to perform the deposit.'
          : echec
            ? 'The customer did not approve the authorisation for this payment'
            : null,
      paid_at: status === 'paid' ? daysAgo(days) : null,
      download_token: `token-${i}`,
      download_expires_at: status === 'paid' ? daysAgo(days - 1) : null,
      download_count: status === 'paid' ? [1, 2, 0, 1, 0, 3, 1][i] : 0,
      max_downloads: 3,
      delivered_at: status === 'paid' ? daysAgo(days) : null,
      created_at: daysAgo(days),
      updated_at: daysAgo(days),
    }
  },
)

const AVIS: [number, string, string, number, string][] = [
  [0, 'Aminata Koné', 'Coiffeuse, Abidjan', 5,
   "J'ai suivi le guide un dimanche après-midi. Le mardi j'avais vendu mon premier pack de conseils. Ce qui m'a débloquée, c'est la partie sur le prix : je me bradais depuis deux ans."],
  [0, 'Serge Bamba', 'Photographe, Bouaké', 5,
   "Clair, sans blabla. Les modèles de messages de relance valent à eux seuls le prix. J'ai récupéré trois clients qui ne répondaient plus."],
  [0, 'Fatou Diallo', 'Graphiste, Yamoussoukro', 4,
   "Très bon contenu. J'aurais aimé plus d'exemples sur les prestations récurrentes, mais tout le reste est directement applicable."],
  [0, 'Kouamé Yao', 'Consultant, Abidjan', 5,
   "Je bricolais avec WhatsApp et des captures d'écran de virements. Maintenant tout est automatique et je dors mieux."],
  [0, 'Awa Cissé', 'Pâtissière, Daloa', 5,
   "Le passage sur le mobile money m'a fait gagner un mois d'essais. Merci."],
  [1, 'Moussa Traoré', 'Menuisier, Korhogo', 5,
   "Les factures sont propres et je n'ai plus honte de les envoyer. Ça change l'image que les clients ont de mon travail."],
  [1, 'Jean-Baptiste Kouassi', 'Électricien, San-Pédro', 4,
   'Pratique. Il a fallu que je change deux ou trois choses pour mon activité, mais la base est solide.'],
]

const reviews: Review[] = AVIS.map(([produit, nom, detail, note, texte], i) => ({
  id: `review-${i}`,
  product_id: `product-${produit}`,
  author_name: nom,
  author_detail: detail,
  rating: note,
  body: texte,
  position: i,
  is_visible: true,
  created_at: daysAgo(30 - i),
  updated_at: daysAgo(30 - i),
}))

type Row = Record<string, unknown>

const TABLES: Record<string, Row[]> = {
  shops: [shop] as unknown as Row[],
  products: products as unknown as Row[],
  orders: orders as unknown as Row[],
  reviews: reviews as unknown as Row[],
}

/**
 * Constructeur de requête minimal. `eq` filtre vraiment : sans ça l'aperçu
 * afficherait les brouillons sur la boutique publique, ce qui donnerait une
 * fausse idée du rendu.
 */
function builder(table: Row[], rows: Row[], pending: Row | null = null) {
  function apply(): Row[] {
    if (pending) rows.forEach((row) => Object.assign(row, pending))
    return rows
  }

  const chain = {
    select: () => chain,
    order: () => chain,
    limit: (n: number) => builder(table, rows.slice(0, n), pending),
    eq: (column: string, value: unknown) =>
      builder(table, rows.filter((row) => row[column] === value), pending),
    in: (column: string, values: unknown[]) =>
      builder(table, rows.filter((row) => values.includes(row[column])), pending),
    insert: (values: Row) => {
      const created = { ...values, id: `nouveau-${table.length}`, created_at: new Date().toISOString() }
      table.push(created)
      return builder(table, [created])
    },
    update: (values: Row) => builder(table, rows, values),
    upsert: () => chain,
    delete: () => {
      rows.forEach((row) => {
        const i = table.indexOf(row)
        if (i >= 0) table.splice(i, 1)
      })
      return builder(table, [])
    },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    single: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: apply(), error: null }).then(resolve),
  }
  return chain
}

const uploads = new Map<string, string>()

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })

export const supabase = {
  from: (table: string) => {
    const rows = TABLES[table] ?? []
    return builder(rows, [...rows])
  },

  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({
      error: { message: "Aperçu : l'authentification n'est pas branchée ici." },
    }),
    signUp: async () => ({
      error: { message: "Aperçu : l'authentification n'est pas branchée ici." },
    }),
  },

  storage: {
    from: () => ({
      async upload(path: string, file: File) {
        uploads.set(path, await readAsDataUrl(file))
        return { error: null }
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: uploads.get(path) ?? '' } }),
    }),
  },

  rpc: async () => ({ data: null, error: null }),
  // deno-lint-ignore no-explicit-any
} as any

/**
 * Moyens de paiement de l'aperçu. Sur la vraie boutique, cette liste vient de
 * la configuration du compte pawaPay — elle suit les opérateurs réellement
 * activés, pays par pays.
 */
const PAYS = [
  ['CIV', "Côte d'Ivoire", '225', 'XOF', 1, ['Orange', 'MTN', 'Moov', 'Wave']],
  ['SEN', 'Sénégal', '221', 'XOF', 1, ['Orange', 'Free', 'Wave']],
  ['BEN', 'Bénin', '229', 'XOF', 1, ['MTN', 'Moov']],
  ['CMR', 'Cameroun', '237', 'XAF', 1, ['MTN', 'Orange']],
  // La RDC a sa propre monnaie : le prix y est converti au taux de la boutique.
  ['COD', 'République démocratique du Congo', '243', 'CDF', 4.042129, ['Vodacom', 'Airtel', 'Orange']],
] as const

/** Même calcul que le serveur : 3 % ajoutés, arrondis au supérieur. */
const avecFrais = (prix: number) => Math.ceil(prix * 1.03)

/** Le franc CFA prend le prix tel quel ; une devise convertie s'arrondit à la centaine. */
const convertir = (prix: number, taux: number) =>
  taux === 1 ? prix : Math.round((prix * taux) / 100) * 100

function paymentOptions(product: Product) {
  const price = product.price
  return {
    // Sur la vraie boutique, ce pays est deviné d'après l'IP de l'acheteur.
    detected: 'CIV',
    countries: PAYS.map(([country, name, prefix, currency, taux, operateurs]) => ({
      country,
      name,
      prefix,
      flag: null,
      currency,
      base_amount: String(convertir(price, taux)),
      fee_amount: String(convertir(avecFrais(price), taux) - convertir(price, taux)),
      compare_amount: !product.compare_at_price
        ? null
        : String(convertir(product.compare_at_price, taux)),
      providers: operateurs.map((operateur) => ({
        provider: `${operateur.toUpperCase()}_${country}`,
        name: operateur,
        logo: null,
        amount: String(convertir(avecFrais(price), taux)),
        auth_type: 'PROVIDER_AUTH',
        pin_prompt: 'AUTOMATIC',
        pin_prompt_revivable: false,
        instructions: null,
        merchant_name: 'ATELIER KODI',
      })),
    })),
  }
}

// L'aperçu simule une attente : deux interrogations avant la confirmation,
// comme le temps que met l'acheteur à composer son code PIN.
let attentes = 0

export async function callFunction<T>(name: string, body?: unknown): Promise<T> {
  const params = (body ?? {}) as { product_slug?: string }

  if (name === 'payment-options') {
    const product = products.find((p) => p.slug === params.product_slug) ?? products[0]
    return paymentOptions(product) as T
  }

  if (name === 'predict-phone') {
    return { valid: true, country: 'CIV', provider: 'ORANGE_CIV', phoneNumber: '2250700000000' } as T
  }

  if (name === 'create-payment') {
    attentes = 0
    return { order_id: 'demo', next_step: 'FINAL_STATUS' } as T
  }

  if (name === 'order-status') {
    attentes += 1
    return attentes < 3
      ? ({ status: 'pending', download_url: null, authorization_url: null, message: null } as T)
      : ({ status: 'paid', download_url: '#', authorization_url: null, message: null } as T)
  }

  throw new Error(`Aperçu : la fonction « ${name} » n'est pas branchée.`)
}
