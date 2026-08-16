import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { callFunction, supabase } from '../lib/supabase'
import type { Product, Shop as ShopType } from '../lib/types'
import { formatPrice } from '../lib/format'
import { Alert, Button, Field, inputClass, Spinner } from '../components/ui'

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <p className="text-slate-500">Cette boutique n'existe pas.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {shop.banner_url && (
        <img src={shop.banner_url} alt="" className="h-40 w-full object-cover sm:h-56" />
      )}

      <div className="mx-auto max-w-2xl px-4 py-8">
        <header className="mb-8 flex items-center gap-4">
          {shop.logo_url && (
            <img
              src={shop.logo_url}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full border border-slate-200 bg-white object-contain"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{shop.name}</h1>
            {shop.description && (
              <p className="mt-1 whitespace-pre-line text-slate-600">{shop.description}</p>
            )}
          </div>
        </header>

        {product ? (
          <ProductCard shop={shop} product={product} />
        ) : (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">
            Aucun produit en vente pour le moment.
          </p>
        )}

        {shop.contact_email && (
          <p className="mt-8 text-center text-sm text-slate-400">
            Une question ?{' '}
            <a href={`mailto:${shop.contact_email}`} className="underline">
              {shop.contact_email}
            </a>
          </p>
        )}
      </div>
    </div>
  )
}

function ProductCard({ shop, product }: { shop: ShopType; product: Product }) {
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
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {product.cover_url && (
        <img src={product.cover_url} alt="" className="aspect-video w-full object-cover" />
      )}

      <div className="p-6">
        <h2 className="text-xl font-semibold text-slate-900">{product.title}</h2>
        {product.description && (
          <p className="mt-2 whitespace-pre-line text-slate-600">{product.description}</p>
        )}

        <p className="mt-4 text-2xl font-bold" style={{ color: shop.accent_color }}>
          {formatPrice(product.price, product.currency)}
        </p>

        {!open ? (
          <Button
            onClick={() => setOpen(true)}
            accent={shop.accent_color}
            className="mt-6 w-full"
          >
            Acheter
          </Button>
        ) : (
          <form onSubmit={buy} className="mt-6 space-y-4">
            <Field label="Ton email" hint="C'est là que le lien de téléchargement sera envoyé.">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Ton nom (facultatif)">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Numéro mobile money (facultatif)"
              hint="Indicatif compris, ex. 2250700000000. Pré-remplit la page de paiement."
            >
              <input
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                className={inputClass}
              />
            </Field>

            {error && <Alert kind="error">{error}</Alert>}

            <Button
              type="submit"
              disabled={busy}
              accent={shop.accent_color}
              className="w-full"
            >
              {busy ? 'Redirection…' : `Payer ${formatPrice(product.price, product.currency)}`}
            </Button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-slate-400">
          Paiement mobile money sécurisé · Livraison immédiate par email
        </p>
      </div>
    </article>
  )
}
