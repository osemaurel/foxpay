export type Shop = {
  id: string
  owner_id: string
  slug: string
  name: string
  description: string | null
  logo_url: string | null
  banner_url: string | null
  accent_color: string
  contact_email: string | null
  country: string
  created_at: string
  updated_at: string
}

export type Product = {
  id: string
  shop_id: string
  slug: string
  /** Ordre d'affichage sur la page boutique. */
  position: number
  title: string
  description: string | null
  price: number
  currency: string
  cover_url: string | null
  file_path: string | null
  file_name: string | null
  file_size: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

export type Order = {
  id: string
  shop_id: string
  product_id: string
  buyer_email: string
  buyer_name: string | null
  buyer_phone: string | null
  amount: number
  currency: string
  status: OrderStatus
  provider: string
  deposit_id: string
  country: string
  provider_transaction_id: string | null
  failure_reason: string | null
  checkout_url: string | null
  paid_at: string | null
  download_token: string
  download_expires_at: string | null
  download_count: number
  max_downloads: number
  delivered_at: string | null
  created_at: string
  updated_at: string
}

/** Pays de la zone franc CFA (XOF) couverts par pawaPay. */
export const XOF_COUNTRIES: { code: string; name: string }[] = [
  { code: 'BEN', name: 'Bénin' },
  { code: 'BFA', name: 'Burkina Faso' },
  { code: 'CIV', name: "Côte d'Ivoire" },
  { code: 'MLI', name: 'Mali' },
  { code: 'NER', name: 'Niger' },
  { code: 'SEN', name: 'Sénégal' },
  { code: 'TGO', name: 'Togo' },
]
