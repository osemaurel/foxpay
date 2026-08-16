import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { callFunction } from '../../lib/supabase'
import type { Product, Shop } from '../../lib/types'
import { formatFileSize, formatPrice } from '../../lib/format'
import { Alert, Button, Eyebrow, Field, inputClass } from '../../components/ui'
import RichContent from '../../components/RichContent'
import { useShop } from './ShopLayout'

export default function ProductPage() {
  const { productSlug } = useParams<{ productSlug: string }>()
  const { shop, products } = useShop()
  const product = products.find((p) => p.slug === productSlug)

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

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:py-16">
      <Link
        to={`/boutique/${shop.slug}`}
        className="text-sm text-ink-faint transition hover:text-ink"
      >
        ← Catalogue
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-12">
        <Cover product={product} />

        <div>
          <Eyebrow>Produit numérique</Eyebrow>

          <h1 className="mt-3 text-3xl font-medium leading-tight text-ink sm:text-4xl">
            {product.title}
          </h1>

          <p
            className="mt-4 text-3xl font-medium tabular-nums"
            style={{ color: 'var(--accent)' }}
          >
            {formatPrice(product.price, product.currency)}
          </p>

          {product.description && (
            <RichContent value={product.description} className="mt-6 text-ink-muted" />
          )}

          <div className="mt-8">
            <Buy shop={shop} product={product} />
          </div>

          <Included product={product} />
        </div>
      </div>
    </main>
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
    <section className="mt-10 grid gap-3 sm:grid-cols-3">
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

function Buy({ shop, product }: { shop: Shop; product: Product }) {
  const [open, setOpen] = useState(false)
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

  if (!open) {
    return (
      <>
        <Button accent onClick={() => setOpen(true)} className="w-full sm:w-auto">
          Acheter — {formatPrice(product.price, product.currency)}
        </Button>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.16em] text-ink-faint">
          Paiement mobile money · Livraison immédiate
        </p>
      </>
    )
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
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <Button type="submit" accent disabled={busy} className="w-full">
        {busy ? 'Redirection…' : `Payer ${formatPrice(product.price, product.currency)}`}
      </Button>
    </form>
  )
}
