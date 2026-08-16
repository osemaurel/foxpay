import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { callFunction, supabase } from '../lib/supabase'
import type { Product, Shop as ShopType } from '../lib/types'
import { formatFileSize, formatPrice } from '../lib/format'
import { Alert, Button, Eyebrow, Field, inputClass, Spinner } from '../components/ui'
import RichContent from '../components/RichContent'
import ThemeToggle from '../components/ThemeToggle'

export default function Shop() {
  const { slug } = useParams<{ slug: string }>()
  const [shop, setShop] = useState<ShopType | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: shopRow } = await supabase
        .from('shops')
        .select('*')
        .eq('slug', slug!)
        .maybeSingle()

      if (shopRow) {
        setShop(shopRow)
        const { data: productRow } = await supabase
          .from('products')
          .select('*')
          .eq('shop_id', shopRow.id)
          .eq('is_active', true)
          .maybeSingle()
        setProduct(productRow)
      }
      setLoading(false)
    }
    void load()
  }, [slug])

  if (loading) return <Spinner />

  if (!shop) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <p className="text-ink-muted">Cette boutique n'existe pas.</p>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen bg-canvas"
      style={{ '--accent': shop.accent_color } as React.CSSProperties}
    >
      <Hero shop={shop} />

      <main className="mx-auto max-w-4xl px-5 pb-24">
        {product ? (
          <>
            <ProductBlock shop={shop} product={product} />
            <Included product={product} />
          </>
        ) : (
          <div className="rounded-2xl border border-line bg-card p-12 text-center">
            <p className="text-ink-muted">Aucun produit en vente pour le moment.</p>
          </div>
        )}
      </main>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-8">
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-faint">
              {shop.name}
            </p>
          </div>
          {shop.contact_email && (
            <a
              href={`mailto:${shop.contact_email}`}
              className="text-sm text-ink-faint underline-offset-4 hover:text-ink hover:underline"
            >
              {shop.contact_email}
            </a>
          )}
        </div>
      </footer>
    </div>
  )
}

/**
 * La bannière sert de matière, pas d'illustration : elle est fondue dans le
 * noir pour que le titre reste lisible quelle que soit l'image envoyée.
 */
function Hero({ shop }: { shop: ShopType }) {
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
        style={{
          background: 'radial-gradient(closest-side, var(--accent), transparent)',
        }}
      />

      <div className="relative mx-auto max-w-4xl px-5 pb-16 pt-20 sm:pb-24 sm:pt-28">
        {shop.logo_url && (
          <img
            src={shop.logo_url}
            alt=""
            className="mb-8 h-16 w-16 rounded-2xl border border-line bg-card object-contain p-1.5"
          />
        )}

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

function ProductBlock({ shop, product }: { shop: ShopType; product: Product }) {
  const [open, setOpen] = useState(false)

  return (
    <article className="-mt-8 overflow-hidden rounded-2xl border border-line bg-card sm:-mt-12">
      {product.cover_url && (
        <img
          src={product.cover_url}
          alt=""
          className="aspect-[16/9] w-full border-b border-line-soft object-cover"
        />
      )}

      <div className="p-6 sm:p-10">
        <Eyebrow>Produit numérique</Eyebrow>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <h2 className="max-w-xl text-2xl font-medium leading-tight text-ink sm:text-4xl">
            {product.title}
          </h2>
          <p
            className="text-3xl font-medium tabular-nums sm:text-4xl"
            style={{ color: 'var(--accent)' }}
          >
            {formatPrice(product.price, product.currency)}
          </p>
        </div>

        {product.description && (
          <RichContent value={product.description} className="mt-6 max-w-2xl text-ink-muted" />
        )}

        <div className="mt-8">
          {open ? (
            <BuyForm shop={shop} product={product} />
          ) : (
            <>
              <Button accent onClick={() => setOpen(true)} className="w-full sm:w-auto">
                Acheter — {formatPrice(product.price, product.currency)}
              </Button>
              <p className="mt-4 font-mono text-xs uppercase tracking-[0.16em] text-ink-faint">
                Paiement mobile money · Livraison immédiate
              </p>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

/** Ce que l'acheteur obtient concrètement, en trois cartes. */
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
      note: "Le lien part dès que le paiement est confirmé, sans intervention de notre part.",
    },
    {
      label: 'Ton accès',
      value: '24 h · 3 téléchargements',
      note: 'Largement de quoi enregistrer le fichier sur ton téléphone et ton ordinateur.',
    },
  ]

  return (
    <section className="mt-6 grid gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-line bg-raise p-6">
          <Eyebrow>{item.label}</Eyebrow>
          <p className="mt-3 truncate font-medium text-ink" title={item.value}>
            {item.value}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-faint">{item.note}</p>
        </div>
      ))}
    </section>
  )
}

function BuyForm({ shop, product }: { shop: ShopType; product: Product }) {
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
    <form
      onSubmit={buy}
      className="space-y-5 rounded-2xl border border-line bg-raise p-6 sm:p-8"
    >
      <Eyebrow>Finaliser l'achat</Eyebrow>

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

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Ton nom (facultatif)">
          <input
            value={name}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Numéro mobile money (facultatif)" hint="Indicatif compris, ex. 2250700000000.">
          <input
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            className={inputClass}
          />
        </Field>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <Button type="submit" accent disabled={busy} className="w-full">
        {busy ? 'Redirection…' : `Payer ${formatPrice(product.price, product.currency)}`}
      </Button>
    </form>
  )
}
