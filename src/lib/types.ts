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
  /** Pixel Meta, chiffres uniquement. Vide = aucun script tiers sur la boutique. */
  facebook_pixel_id: string | null
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
  /** Prix de référence affiché barré. Nul = pas de promotion. */
  compare_at_price: number | null
  currency: string
  /** Texte du bouton d'achat. Nul = « Acheter ». */
  cta_label: string | null
  /** Couleur du bouton propre au produit. Nul = accent de la boutique. */
  cta_color: string | null
  cover_url: string | null
  file_path: string | null
  file_name: string | null
  file_size: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Review = {
  id: string
  product_id: string
  author_name: string
  /** Ville, métier, entreprise : ce qui rend le témoignage situable. */
  author_detail: string | null
  rating: number | null
  body: string
  position: number
  is_visible: boolean
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
  /** Ce que l'acheteur a réellement payé, frais compris et dans sa devise. */
  charged_amount: number | null
  charged_currency: string | null
  status: OrderStatus
  /** Le prestataire de paiement : pawapay. */
  provider: string
  /** L'opérateur mobile money choisi par l'acheteur (MTN_MOMO_CIV…). */
  mmo_provider: string | null
  deposit_id: string
  /** Pays du portefeuille utilisé pour payer. */
  country: string | null
  provider_transaction_id: string | null
  /** Code d'échec pawaPay (PAYMENT_NOT_APPROVED…). */
  failure_code: string | null
  /** Message d'origine de pawaPay, en anglais, destiné au vendeur. */
  failure_reason: string | null
  paid_at: string | null
  download_token: string
  download_expires_at: string | null
  download_count: number
  max_downloads: number
  delivered_at: string | null
  created_at: string
  updated_at: string
}
