import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Product } from '../../lib/types'
import { formatPrice } from '../../lib/format'
import { Alert, Button, Card } from '../../components/ui'
import { useAdmin } from './AdminLayout'

export default function ProductsList() {
  const { products, reloadProducts } = useAdmin()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Échange la position de deux produits voisins. */
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= products.length) return

    setBusy(true)
    setError(null)
    const a = products[index]
    const b = products[target]
    const { error } = await supabase.from('products').upsert([
      { id: a.id, shop_id: a.shop_id, position: target },
      { id: b.id, shop_id: b.shop_id, position: index },
    ])
    if (error) setError(error.message)
    else await reloadProducts()
    setBusy(false)
  }

  async function remove(product: Product) {
    if (!window.confirm(`Supprimer « ${product.title} » ? C'est définitif.`)) return

    setBusy(true)
    setError(null)
    const { error } = await supabase.from('products').delete().eq('id', product.id)
    if (error) {
      // La clé étrangère des commandes est en on delete restrict : on ne perd
      // jamais l'historique d'une vente à cause d'un ménage dans le catalogue.
      setError(
        error.code === '23503'
          ? "Ce produit a déjà été vendu, il ne peut pas être supprimé sans effacer l'historique. Retire-le de la vente à la place."
          : error.message,
      )
    } else {
      await reloadProducts()
    }
    setBusy(false)
  }

  return (
    <>
      <Card title="Ton catalogue">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            {products.length === 0
              ? "Aucun produit pour l'instant."
              : `${products.length} produit${products.length > 1 ? 's' : ''}, dont ${
                  products.filter((p) => p.is_active).length
                } en vente.`}
          </p>
          <Button onClick={() => navigate('/admin/produits/nouveau')}>Ajouter un produit</Button>
        </div>

        {error && (
          <div className="mt-4">
            <Alert kind="error">{error}</Alert>
          </div>
        )}
      </Card>

      {products.length > 0 && (
        <div className="space-y-3">
          {products.map((product, index) => (
            <article
              key={product.id}
              className="flex items-center gap-4 rounded-2xl border border-line bg-card p-3 sm:p-4"
            >
              <Thumb url={product.cover_url} />

              <div className="min-w-0 flex-1">
                <Link
                  to={`/admin/produits/${product.id}`}
                  className="block truncate font-medium text-ink hover:underline"
                >
                  {product.title || 'Sans titre'}
                </Link>
                <p className="mt-0.5 truncate text-sm text-ink-faint">
                  {formatPrice(product.price, product.currency)} · /{product.slug}
                </p>
              </div>

              <span
                className={
                  'shrink-0 rounded-full px-2 py-0.5 text-xs ' +
                  (product.is_active ? 'bg-go/15 text-go' : 'bg-tint-strong text-ink-faint')
                }
              >
                {product.is_active ? 'En vente' : 'Brouillon'}
              </span>

              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  label="Monter"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </IconButton>
                <IconButton
                  label="Descendre"
                  disabled={busy || index === products.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </IconButton>
                <IconButton label="Supprimer" disabled={busy} onClick={() => remove(product)}>
                  ✕
                </IconButton>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Vignette carrée. Le carré est la règle du catalogue : c'est ce qui garde la
 * grille régulière quelles que soient les images envoyées.
 */
function Thumb({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="grid aspect-square w-16 shrink-0 place-items-center rounded-xl border border-line bg-raise text-ink-faint">
        <span className="text-xs">—</span>
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className="aspect-square w-16 shrink-0 rounded-xl border border-line object-cover"
    />
  )
}

function IconButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-8 rounded-lg border border-line text-sm text-ink-faint transition hover:bg-tint hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  )
}
