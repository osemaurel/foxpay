import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Order } from '../../lib/types'
import { formatPrice } from '../../lib/format'
import { Card } from '../../components/ui'
import Analytique from './Analytique'
import { useAdmin } from './AdminLayout'

export default function Home() {
  const { shop, products } = useAdmin()
  const [orders, setOrders] = useState<Order[] | null>(null)

  useEffect(() => {
    supabase
      .from('orders')
      .select('*')
      .eq('shop_id', shop.id)
      .then(({ data }) => setOrders(data ?? []))
  }, [shop.id])

  const paid = orders?.filter((o) => o.status === 'paid') ?? []
  const pending = orders?.filter((o) => o.status === 'pending') ?? []
  const total = paid.reduce((sum, o) => sum + o.amount, 0)

  // Ce qui bloque la vente, dans l'ordre où il faut le régler.
  const steps = [
    { done: true, label: 'Boutique créée', to: '/admin/parametres' },
    {
      done: products.length > 0,
      label: 'Premier produit créé',
      to: '/admin/produits/nouveau',
    },
    {
      done: products.some((p) => p.file_path),
      label: 'Fichier à livrer envoyé',
      to: '/admin/produits',
    },
    {
      done: products.some((p) => p.is_active),
      label: 'Au moins un produit en vente',
      to: '/admin/produits',
    },
  ]
  const ready = steps.every((s) => s.done)

  return (
    <>
      <ShopLink slug={shop.slug} live={ready} />

      {!ready && (
        <Card title="Avant de pouvoir vendre">
          <ol className="space-y-3">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-3">
                <span
                  className={
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ' +
                    (step.done ? 'bg-go/15 text-go' : 'bg-tint-strong text-ink-faint')
                  }
                >
                  {step.done ? '✓' : '·'}
                </span>
                {step.done ? (
                  <span className="text-ink-faint line-through">{step.label}</span>
                ) : (
                  <Link to={step.to} className="text-ink underline underline-offset-2">
                    {step.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card title="Tes chiffres">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat value={formatPrice(total)} label="Total encaissé" />
          <Stat value={String(paid.length)} label={paid.length > 1 ? 'ventes' : 'vente'} />
          <Stat value={String(pending.length)} label="paiements en attente" />
          <Stat
            value={String(products.filter((p) => p.is_active).length)}
            label="produits en vente"
          />
        </div>
        <Link
          to="/admin/ventes"
          className="mt-6 inline-block text-sm text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          Voir le détail des ventes
        </Link>
      </Card>

      {orders && <Analytique orders={orders} />}
    </>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-sm text-ink-faint">{label}</p>
    </div>
  )
}

function ShopLink({ slug, live }: { slug: string; live: boolean }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/boutique/${slug}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Le presse-papiers peut être refusé : le lien reste sélectionnable à la main.
    }
  }

  return (
    <Card title="Ta boutique">
      <p className="mb-3 text-sm text-ink-muted">
        {live
          ? "C'est l'adresse à partager. Elle est en ligne et prête à encaisser."
          : "Cette adresse est déjà en ligne, mais elle n'affichera aucun produit tant que la mise en vente n'est pas terminée."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-tint px-3 py-2 font-mono text-sm text-ink">
          {url}
        </code>
        <button
          onClick={copy}
          className="rounded-lg border border-line px-3 py-2 text-sm text-ink-muted hover:bg-canvas"
        >
          {copied ? 'Copié' : 'Copier'}
        </button>
        <a
          href={`/boutique/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-line px-3 py-2 text-sm text-ink-muted hover:bg-canvas"
        >
          Ouvrir
        </a>
      </div>
    </Card>
  )
}
