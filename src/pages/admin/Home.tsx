import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Order } from '../../lib/types'
import { formatPrice } from '../../lib/format'
import { Card } from '../../components/ui'
import { useAdmin } from './AdminLayout'

export default function Home() {
  const { shop, product } = useAdmin()
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
      done: Boolean(product?.title && product.price > 0),
      label: 'Produit décrit et prix fixé',
      to: '/admin/produit',
    },
    { done: Boolean(product?.file_path), label: 'Fichier à livrer envoyé', to: '/admin/produit' },
    { done: Boolean(product?.is_active), label: 'Produit mis en vente', to: '/admin/produit' },
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
                    (step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500')
                  }
                >
                  {step.done ? '✓' : '·'}
                </span>
                {step.done ? (
                  <span className="text-slate-500 line-through">{step.label}</span>
                ) : (
                  <Link to={step.to} className="text-slate-900 underline underline-offset-2">
                    {step.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card title="Tes chiffres">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          <Stat value={formatPrice(total)} label="Total encaissé" />
          <Stat value={String(paid.length)} label={paid.length > 1 ? 'ventes' : 'vente'} />
          <Stat value={String(pending.length)} label="paiements en attente" />
        </div>
        <Link
          to="/admin/ventes"
          className="mt-6 inline-block text-sm text-slate-500 underline underline-offset-2 hover:text-slate-900"
        >
          Voir le détail des ventes
        </Link>
      </Card>
    </>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
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
      <p className="mb-3 text-sm text-slate-600">
        {live
          ? "C'est l'adresse à partager. Elle est en ligne et prête à encaisser."
          : "Cette adresse est déjà en ligne, mais elle n'affichera aucun produit tant que la mise en vente n'est pas terminée."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm text-slate-800">
          {url}
        </code>
        <button
          onClick={copy}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          {copied ? 'Copié' : 'Copier'}
        </button>
        <a
          href={`/boutique/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Ouvrir
        </a>
      </div>
    </Card>
  )
}
