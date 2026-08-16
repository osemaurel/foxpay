/**
 * Faux Supabase, uniquement pour la preview statique (`npm run build:demo`).
 *
 * Le plugin `mock-supabase` de vite.demo.config.ts redirige tous les imports de
 * `lib/supabase` vers ce fichier. Les pages et composants ne sont pas modifiés :
 * ce qu'on regarde dans la preview est exactement ce qui tourne en production,
 * avec des données en dur à la place du réseau.
 */
import type { Order, Product, Shop } from './types'

/** La preview n'a rien à configurer. */
export const missingEnv: string[] = []

const svg = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`

const LOGO = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#1c1917"/><text x="48" y="63" font-family="Georgia,serif" font-size="44" fill="#fb923c" text-anchor="middle">K</text></svg>`,
)

const BANNER = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c2d12"/><stop offset="0.55" stop-color="#c2410c"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="1200" height="320" fill="url(#g)"/><circle cx="980" cy="60" r="180" fill="#fff" opacity="0.08"/><circle cx="1120" cy="280" r="120" fill="#fff" opacity="0.06"/></svg>`,
)

const COVER = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#1c1917"/><circle cx="640" cy="90" r="200" fill="#c2410c" opacity="0.35"/><circle cx="180" cy="390" r="160" fill="#f59e0b" opacity="0.25"/><text x="60" y="200" font-family="Georgia,serif" font-size="52" fill="#fafaf9">Vendre en ligne</text><text x="60" y="262" font-family="Georgia,serif" font-size="52" fill="#fb923c">en Côte d'Ivoire</text><text x="62" y="320" font-family="system-ui,sans-serif" font-size="20" fill="#a8a29e" letter-spacing="3">GUIDE COMPLET · 84 PAGES</text></svg>`,
)

const now = new Date()
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString()

const shop: Shop = {
  id: 'shop-1',
  owner_id: 'user-1',
  slug: 'atelier-kodi',
  name: 'Atelier Kôdi',
  description:
    "J'accompagne les indépendants d'Abidjan qui veulent vendre leurs services en ligne sans y passer leurs nuits.\n\nPaiement mobile money, livraison du fichier dans la minute.",
  logo_url: LOGO,
  banner_url: BANNER,
  accent_color: '#c2410c',
  contact_email: 'bonjour@atelierkodi.ci',
  country: 'CIV',
  created_at: daysAgo(60),
  updated_at: daysAgo(2),
}

const product: Product = {
  id: 'product-1',
  shop_id: 'shop-1',
  title: "Vendre en ligne en Côte d'Ivoire — le guide complet",
  description:
    "84 pages pour passer de « je poste sur WhatsApp » à une boutique qui encaisse toute seule.\n\nAu programme : choisir son offre, fixer son prix en XOF, brancher le mobile money, et les 12 messages de relance qui marchent vraiment.",
  price: 15000,
  currency: 'XOF',
  cover_url: COVER,
  file_path: 'shop-1/file-9f2c.pdf',
  file_name: 'vendre-en-ligne-ci.pdf',
  file_size: 4_812_000,
  is_active: true,
  created_at: daysAgo(45),
  updated_at: daysAgo(2),
}

const orders: Order[] = [
  ['aminata.kone@gmail.com', 'paid', 0],
  ['serge.bamba@yahoo.fr', 'paid', 1],
  ['fatou.d@outlook.com', 'pending', 1],
  ['k.yao@gmail.com', 'paid', 2],
  ['moussa.traore@gmail.com', 'failed', 3],
  ['awa.cisse@gmail.com', 'paid', 5],
  ['jb.kouassi@gmail.com', 'paid', 8],
].map(([email, status, days], i) => ({
  id: `order-${i}`,
  shop_id: 'shop-1',
  product_id: 'product-1',
  buyer_email: email as string,
  buyer_name: null,
  buyer_phone: null,
  amount: 15000,
  currency: 'XOF',
  status: status as Order['status'],
  provider: 'pawapay',
  deposit_id: `deposit-${i}`,
  country: 'CIV',
  provider_transaction_id: null,
  failure_reason: null,
  checkout_url: null,
  paid_at: status === 'paid' ? daysAgo(days as number) : null,
  download_token: `token-${i}`,
  download_expires_at: null,
  download_count: status === 'paid' ? [1, 2, 0, 1, 0, 3, 1][i] : 0,
  max_downloads: 3,
  delivered_at: status === 'paid' ? daysAgo(days as number) : null,
  created_at: daysAgo(days as number),
  updated_at: daysAgo(days as number),
}))

type Row = Record<string, unknown>

const TABLES: Record<string, Row[]> = { shops: [shop], products: [product], orders }

/** Constructeur de requête minimal : il accepte les chaînes utilisées par l'app. */
function builder(rows: Row[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    insert: (values: Record<string, unknown>) => builder([{ ...rows[0], ...values }]),
    update: (values: Record<string, unknown>) => {
      Object.assign(rows[0] as object, values)
      return builder(rows)
    },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
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
  from: (table: string) => builder(TABLES[table] ?? []),

  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({
      error: { message: "Preview : l'authentification n'est pas branchée ici." },
    }),
    signUp: async () => ({
      error: { message: "Preview : l'authentification n'est pas branchée ici." },
    }),
  },

  storage: {
    from: () => ({
      async upload(path: string, file: File) {
        uploads.set(path, await readAsDataUrl(file))
        return { error: null }
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: uploads.get(path) ?? '' },
      }),
    }),
  },

  rpc: async () => ({ data: null, error: null }),
  // deno-lint-ignore no-explicit-any
} as any

export async function callFunction<T>(name: string): Promise<T> {
  if (name === 'order-status') {
    return { status: 'paid', download_url: '#' } as T
  }
  throw new Error(
    "Preview : le paiement n'est pas branché. Sur la vraie boutique, ce bouton ouvre la page mobile money.",
  )
}
