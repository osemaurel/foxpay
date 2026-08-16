import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { callFunction } from '../../lib/supabase'
import type { Product } from '../../lib/types'
import { formatFileSize, formatPrice } from '../../lib/format'
import { Alert, Eyebrow, Field, inputClass } from '../../components/ui'
import { useShop } from './ShopLayout'

/**
 * Page de paiement dédiée. Séparer cette étape de la fiche produit évite que
 * l'acheteur remplisse ses coordonnées au milieu d'une page qui continue de le
 * solliciter, et donne une adresse propre à laquelle revenir.
 */
export default function Checkout() {
  const { productSlug } = useParams<{ productSlug: string }>()
  const { shop, products } = useShop()
  const product = products.find((p) => p.slug === productSlug)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!product) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-24 text-center">
        <p className="text-ink-muted">Ce produit n'est plus disponible.</p>
        <Link
          to={`/boutique/${shop.slug}`}
          className="mt-4 inline-block text-sm text-ink-faint underline underline-offset-4 hover:text-ink"
        >
          Voir le catalogue
        </Link>
      </main>
    )
  }

  const accent = product.cta_color ?? 'var(--accent)'

  async function pay(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { redirectUrl } = await callFunction<{ redirectUrl: string }>('create-payment', {
        slug: shop.slug,
        product_slug: product!.slug,
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
    <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
      <Link
        to={`/boutique/${shop.slug}/p/${product.slug}`}
        className="text-sm text-ink-faint transition hover:text-ink"
      >
        ← Retour au produit
      </Link>

      <h1 className="mt-5 text-2xl font-medium text-ink sm:text-3xl">Finaliser la commande</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start">
        <form
          onSubmit={pay}
          className="order-2 space-y-5 rounded-2xl border border-line bg-card p-6 sm:p-8 lg:order-1"
        >
          <Eyebrow>Tes coordonnées</Eyebrow>

          <Field
            label="Ton email"
            hint="C'est là que le lien de téléchargement sera envoyé. Vérifie-le bien."
          >
            <input
              type="email"
              required
              autoComplete="email"
              autoFocus
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
            hint="Indicatif compris, ex. 2250700000000. Il pré-remplit la page de paiement."
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
            style={{ backgroundColor: accent }}
            className="inline-flex w-full items-center justify-center rounded-xl px-6 py-3.5 font-medium text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {busy
              ? 'Redirection…'
              : `Payer ${formatPrice(product.price, product.currency)}`}
          </button>

          <p className="text-center text-xs leading-relaxed text-ink-faint">
            Tu vas être redirigé vers la page de paiement mobile money. Aucun montant n'est
            débité avant ta confirmation.
          </p>
        </form>

        <aside className="order-1 space-y-4 lg:order-2">
          <Summary product={product} accent={accent} />
          <Delivery product={product} />
        </aside>
      </div>
    </main>
  )
}

function Summary({ product, accent }: { product: Product; accent: string }) {
  const discount =
    product.compare_at_price && product.compare_at_price > product.price
      ? Math.round((1 - product.price / product.compare_at_price) * 100)
      : null

  return (
    <section className="rounded-2xl border border-line bg-raise p-5">
      <Eyebrow>Ta commande</Eyebrow>

      <div className="mt-4 flex gap-4">
        {product.cover_url && (
          <img
            src={product.cover_url}
            alt=""
            className="aspect-square w-16 shrink-0 rounded-xl border border-line object-cover"
          />
        )}
        <p className="min-w-0 font-medium leading-snug text-ink">{product.title}</p>
      </div>

      <div className="mt-5 space-y-2 border-t border-line-soft pt-4 text-sm">
        {product.compare_at_price && (
          <div className="flex items-center justify-between text-ink-faint">
            <span>Prix habituel</span>
            <span className="tabular-nums line-through">
              {formatPrice(product.compare_at_price, product.currency)}
            </span>
          </div>
        )}
        {discount !== null && (
          <div className="flex items-center justify-between text-go">
            <span>Remise</span>
            <span className="tabular-nums">−{discount} %</span>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-1">
          <span className="font-medium text-ink">Total</span>
          <span className="text-xl font-medium tabular-nums" style={{ color: accent }}>
            {formatPrice(product.price, product.currency)}
          </span>
        </div>
      </div>
    </section>
  )
}

/** Ce que l'acheteur reçoit, rappelé au moment où il sort son téléphone. */
function Delivery({ product }: { product: Product }) {
  const lines = [
    ['Le fichier', product.file_name ?? 'Fichier numérique', formatFileSize(product.file_size)],
    ['Livraison', 'Par email, immédiate', 'Dès le paiement confirmé'],
    ['Ton accès', '24 h · 3 téléchargements', 'De quoi le mettre à l’abri'],
  ]

  return (
    <section className="rounded-2xl border border-line bg-raise p-5">
      <Eyebrow>Ce que tu reçois</Eyebrow>
      <dl className="mt-4 space-y-3 text-sm">
        {lines.map(([label, value, note]) => (
          <div key={label}>
            <dt className="text-xs text-ink-faint">{label}</dt>
            <dd className="truncate font-medium text-ink" title={value}>
              {value}
            </dd>
            {note && <dd className="text-xs text-ink-faint">{note}</dd>}
          </div>
        ))}
      </dl>
    </section>
  )
}
