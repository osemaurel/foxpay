import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { callFunction } from '../../lib/supabase'
import type { Product, Shop } from '../../lib/types'
import { formatFileSize, formatPrice } from '../../lib/format'
import { Alert, Eyebrow, Field, inputClass } from '../../components/ui'
import RichContent from '../../components/RichContent'
import { useShop } from './ShopLayout'

export default function ProductPage() {
  const { productSlug } = useParams<{ productSlug: string }>()
  const { shop, products } = useShop()
  const product = products.find((p) => p.slug === productSlug)

  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const priceRef = useRef<HTMLDivElement>(null)
  const [priceOffScreen, setPriceOffScreen] = useState(false)

  /**
   * La barre du bas ne se déclenche pas à une hauteur de défilement arbitraire :
   * elle apparaît exactement quand le bloc prix quitte l'écran, donc au moment
   * où l'acheteur perd l'information dont il a besoin pour décider.
   */
  useEffect(() => {
    const el = priceRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setPriceOffScreen(!entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [product?.id])

  if (!product) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-24 text-center">
        <p className="text-ink-muted">Ce produit n'est pas disponible.</p>
        <Link
          to={`/boutique/${shop.slug}`}
          className="mt-4 inline-block text-sm text-ink-faint underline underline-offset-4 hover:text-ink"
        >
          Voir le catalogue
        </Link>
      </main>
    )
  }

  function openForm() {
    setOpen(true)
    // Laisse le formulaire se monter avant de le viser.
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
  }

  return (
    <>
      <main className="mx-auto max-w-5xl px-5 py-6 pb-28 sm:py-10 lg:pb-16">
        <Link
          to={`/boutique/${shop.slug}`}
          className="text-sm text-ink-faint transition hover:text-ink"
        >
          ← Catalogue
        </Link>

        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-12">
          <Cover product={product} />

          <div className="min-w-0">
            {/* Le cadre : le prix et le bouton, rien d'autre. */}
            <section className="rounded-2xl border border-line bg-card p-6 text-center sm:p-8 lg:text-left">
              <div ref={priceRef}>
                <PriceTag product={product} />
              </div>

              <div className="mt-6">
                {open ? (
                  <div ref={formRef}>
                    <BuyForm shop={shop} product={product} />
                  </div>
                ) : (
                  <BuyButton product={product} onClick={openForm} className="w-full" />
                )}
              </div>
            </section>

            {/* Hors du cadre : le nom, puis la description. */}
            <h1 className="mt-8 text-2xl font-medium leading-tight text-ink sm:text-3xl">
              {product.title}
            </h1>

            {product.description && (
              <RichContent value={product.description} className="mt-4 text-ink-muted" />
            )}

            <Included product={product} />
          </div>
        </div>
      </main>

      {/* Barre d'achat mobile, une fois le prix sorti de l'écran. */}
      <StickyBar
        product={product}
        visible={priceOffScreen && !open}
        onBuy={openForm}
      />
    </>
  )
}

/** Le carré est la règle : l'image du produit est cadrée pareil partout. */
function Cover({ product }: { product: Product }) {
  if (!product.cover_url) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-2xl border border-line bg-raise">
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-faint">
          Sans visuel
        </span>
      </div>
    )
  }
  return (
    <img
      src={product.cover_url}
      alt={product.title}
      className="aspect-square w-full rounded-2xl border border-line object-cover"
    />
  )
}

function PriceTag({ product, compact }: { product: Product; compact?: boolean }) {
  const discount =
    product.compare_at_price && product.compare_at_price > product.price
      ? Math.round((1 - product.price / product.compare_at_price) * 100)
      : null

  return (
    <div
      className={
        'flex flex-wrap items-baseline gap-x-3 gap-y-1 ' +
        (compact ? '' : 'justify-center lg:justify-start')
      }
    >
      <span
        className={
          'font-medium tabular-nums ' + (compact ? 'text-xl' : 'text-3xl sm:text-4xl')
        }
        style={{ color: buttonColor(product) }}
      >
        {formatPrice(product.price, product.currency)}
      </span>

      {product.compare_at_price && (
        <span
          className={
            'tabular-nums text-ink-faint line-through ' + (compact ? 'text-sm' : 'text-lg')
          }
        >
          {formatPrice(product.compare_at_price, product.currency)}
        </span>
      )}

      {discount !== null && !compact && (
        <span className="rounded-full bg-go/15 px-2 py-0.5 font-mono text-xs text-go">
          −{discount} %
        </span>
      )}
    </div>
  )
}

/** Couleur du bouton : celle du produit si elle est définie, sinon l'accent. */
function buttonColor(product: Product): string {
  return product.cta_color ?? 'var(--accent)'
}

function BuyButton({
  product,
  onClick,
  className = '',
}: {
  product: Product
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ backgroundColor: buttonColor(product) }}
      className={
        'inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-medium ' +
        'text-white transition hover:brightness-110 ' +
        className
      }
    >
      {product.cta_label?.trim() || 'Acheter'}
    </button>
  )
}

/**
 * Barre fixe en bas d'écran, mobile uniquement : sur grand écran le cadre reste
 * visible en permanence, une barre y serait du bruit.
 */
function StickyBar({
  product,
  visible,
  onBuy,
}: {
  product: Product
  visible: boolean
  onBuy: () => void
}) {
  return (
    <div
      className={
        'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 backdrop-blur ' +
        'transition-transform duration-200 lg:hidden ' +
        (visible ? 'translate-y-0' : 'translate-y-full')
      }
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-hidden={!visible}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
        <PriceTag product={product} compact />
        <BuyButton product={product} onClick={onBuy} className="shrink-0" />
      </div>
    </div>
  )
}

function Included({ product }: { product: Product }) {
  const items = [
    {
      label: 'Le fichier',
      value: product.file_name ?? 'Fichier numérique',
      note: formatFileSize(product.file_size) || 'Téléchargeable immédiatement',
    },
    {
      label: 'Livraison',
      value: 'Par email',
      note: 'Le lien part dès que le paiement est confirmé.',
    },
    {
      label: 'Ton accès',
      value: '24 h · 3 téléchargements',
      note: 'De quoi enregistrer le fichier sur ton téléphone et ton ordinateur.',
    },
  ]

  return (
    <section className="mt-8 grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-line bg-raise p-4">
          <Eyebrow>{item.label}</Eyebrow>
          <p className="mt-2 truncate text-sm font-medium text-ink" title={item.value}>
            {item.value}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">{item.note}</p>
        </div>
      ))}
    </section>
  )
}

function BuyForm({ shop, product }: { shop: Shop; product: Product }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function buy(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { redirectUrl } = await callFunction<{ redirectUrl: string }>('create-payment', {
        slug: shop.slug,
        product_slug: product.slug,
        buyer_email: email,
        buyer_name: name || null,
        buyer_phone: phone || null,
      })
      // On quitte le site vers la page de paiement pawaPay.
      window.location.href = redirectUrl
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={buy} className="space-y-4 text-left">
      <Field label="Ton email" hint="C'est là que le lien de téléchargement sera envoyé.">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Ton nom (facultatif)">
        <input
          value={name}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        label="Numéro mobile money (facultatif)"
        hint="Indicatif compris, ex. 2250700000000."
      >
        <input
          inputMode="numeric"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          className={inputClass}
        />
      </Field>

      {error && <Alert kind="error">{error}</Alert>}

      <button
        type="submit"
        disabled={busy}
        style={{ backgroundColor: buttonColor(product) }}
        className="inline-flex w-full items-center justify-center rounded-xl px-6 py-3 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {busy ? 'Redirection…' : `Payer ${formatPrice(product.price, product.currency)}`}
      </button>
    </form>
  )
}
