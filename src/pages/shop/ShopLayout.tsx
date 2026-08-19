import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Product, Shop } from '../../lib/types'
import { initPixel, track } from '../../lib/pixel'
import { useLangue, type Langue } from '../../lib/i18n'
import { Spinner } from '../../components/ui'
import ThemeToggle from '../../components/ThemeToggle'

export type ShopContext = { shop: Shop; products: Product[] }

export function useShop() {
  return useOutletContext<ShopContext>()
}

/**
 * Coquille de la boutique publique : en-tête permanente, accent de la boutique
 * injecté une seule fois, et chargement des produits en vente partagé entre
 * l'accueil et les pages produit.
 */
export default function ShopLayout() {
  const { slug } = useParams<{ slug: string }>()
  const { t } = useLangue()
  const [shop, setShop] = useState<Shop | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: shopRow } = await supabase
        .from('shops')
        .select('*')
        .eq('slug', slug!)
        .maybeSingle()

      if (shopRow) {
        setShop(shopRow)
        const { data } = await supabase
          .from('products')
          .select('*')
          .eq('shop_id', shopRow.id)
          .eq('is_active', true)
          .order('position')
          .order('created_at')
        setProducts(data ?? [])
      } else {
        setShop(null)
      }
      setLoading(false)
    }
    void load()
  }, [slug])

  usePixel(shop)

  if (loading) return <Spinner />

  if (!shop) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <p className="text-ink-muted">{t('boutiqueIntrouvable')}</p>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-canvas"
      style={{ '--accent': shop.accent_color } as React.CSSProperties}
    >
      <ShopHeader shop={shop} />

      <div className="flex-1">
        <Outlet context={{ shop, products } satisfies ShopContext} />
      </div>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-8">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-faint">
            {shop.name}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {shop.contact_email && (
              <a
                href={`mailto:${shop.contact_email}`}
                className="text-sm text-ink-faint underline-offset-4 hover:text-ink hover:underline"
              >
                {shop.contact_email}
              </a>
            )}
            <LanguePicker />
          </div>
        </div>
      </footer>
    </div>
  )
}

/**
 * Le choix de langue, en pied de page.
 *
 * La langue de l'appareil décide à l'ouverture ; ce sélecteur est là pour
 * l'acheteur qu'elle dessert — un téléphone en anglais dans un pays
 * francophone, ou l'inverse. Le choix est gardé d'une visite à l'autre.
 */
function LanguePicker() {
  const { langue, setLangue, t } = useLangue()

  const choix: { code: Langue; nom: string }[] = [
    { code: 'fr', nom: 'Français' },
    { code: 'en', nom: 'English' },
  ]

  return (
    <div className="flex items-center gap-2">
      <span className="sr-only" id="choix-langue">
        {t('choixLangue')}
      </span>
      <div
        role="group"
        aria-labelledby="choix-langue"
        className="flex overflow-hidden rounded-lg border border-line"
      >
        {choix.map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => setLangue(c.code)}
            aria-pressed={langue === c.code}
            className={
              'px-3 py-1.5 text-xs transition ' +
              (langue === c.code
                ? 'bg-raise font-medium text-ink'
                : 'text-ink-faint hover:text-ink')
            }
          >
            {c.nom}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Charge le pixel de la boutique, puis compte une vue de page à chaque
 * navigation. Sans pixel configuré, rien de tout cela ne s'exécute.
 */
function usePixel(shop: Shop | null) {
  const { pathname } = useLocation()
  const pixel = shop?.facebook_pixel_id ?? null

  useEffect(() => {
    if (!initPixel(pixel)) return
    // `init` n'envoie rien de lui-même : c'est bien à nous de compter la vue,
    // à l'ouverture comme à chaque navigation interne — la boutique est une
    // application d'une seule page, Meta ne les voit pas passer.
    track('PageView')
  }, [pixel, pathname])
}

/** En-tête de boutique : identité à gauche, réglages à droite, toujours visible. */
function ShopHeader({ shop }: { shop: Shop }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
        <Link to={`/boutique/${shop.slug}`} className="flex min-w-0 items-center gap-3">
          {shop.logo_url ? (
            <img
              src={shop.logo_url}
              alt=""
              className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover"
            />
          ) : (
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {shop.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate font-medium text-ink">{shop.name}</span>
        </Link>

        <ThemeToggle />
      </div>
    </header>
  )
}
