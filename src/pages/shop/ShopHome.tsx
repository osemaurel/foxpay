import { Link } from 'react-router-dom'
import type { Product, Shop } from '../../lib/types'
import { formatPrice } from '../../lib/format'
import { Eyebrow } from '../../components/ui'
import { useShop } from './ShopLayout'

export default function ShopHome() {
  const { shop, products } = useShop()

  return (
    <>
      <Hero shop={shop} />

      <main className="mx-auto max-w-5xl px-5 pb-24">
        {products.length === 0 ? (
          <div className="rounded-2xl border border-line bg-card p-12 text-center">
            <p className="text-ink-muted">Aucun produit en vente pour le moment.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-baseline justify-between gap-4">
              <Eyebrow>Le catalogue</Eyebrow>
              <span className="font-mono text-xs text-ink-faint">
                {products.length} produit{products.length > 1 ? 's' : ''}
              </span>
            </div>

            <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <ProductCard key={product.id} shop={shop} product={product} />
              ))}
            </section>
          </>
        )}
      </main>
    </>
  )
}

function Hero({ shop }: { shop: Shop }) {
  return (
    <header className="relative overflow-hidden border-b border-line-soft">
      {shop.banner_url && (
        <div className="absolute inset-0">
          <img src={shop.banner_url} alt="" className="h-full w-full object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-b from-canvas/50 via-canvas/85 to-canvas" />
        </div>
      )}

      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--accent), transparent)' }}
      />

      <div className="relative mx-auto max-w-5xl px-5 pb-14 pt-16 sm:pb-20 sm:pt-24">
        <h1 className="max-w-2xl text-4xl font-medium leading-[1.05] text-ink sm:text-6xl">
          {shop.name}
        </h1>
        {shop.description && (
          <p className="mt-6 max-w-xl whitespace-pre-line text-lg leading-relaxed text-ink-muted">
            {shop.description}
          </p>
        )}
      </div>
    </header>
  )
}

/**
 * Carte du catalogue. L'image est cadrée en carré : c'est ce qui garde la
 * grille régulière quelles que soient les images envoyées par le vendeur.
 */
function ProductCard({ shop, product }: { shop: Shop; product: Product }) {
  return (
    <Link
      to={`/boutique/${shop.slug}/p/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition hover:border-[var(--accent)]"
    >
      {product.cover_url ? (
        <img
          src={product.cover_url}
          alt=""
          className="aspect-square w-full border-b border-line-soft object-cover transition group-hover:opacity-90"
        />
      ) : (
        <div className="grid aspect-square w-full place-items-center border-b border-line-soft bg-raise">
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-faint">
            Sans visuel
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col p-5">
        <h2 className="font-medium leading-snug text-ink">{product.title}</h2>
        <div className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-4">
          <span
            className="text-xl font-medium tabular-nums"
            style={{ color: product.cta_color ?? 'var(--accent)' }}
          >
            {formatPrice(product.price, product.currency)}
          </span>
          {product.compare_at_price && (
            <span className="text-sm tabular-nums text-ink-faint line-through">
              {formatPrice(product.compare_at_price, product.currency)}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
