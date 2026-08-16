import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Order } from '../../lib/types'
import { formatDate, formatPrice } from '../../lib/format'
import { Card, Spinner } from '../../components/ui'
import { useAdmin } from './AdminLayout'

const STATUS: Record<Order['status'], { text: string; className: string }> = {
  paid: { text: 'Payé', className: 'bg-go/15 text-go' },
  pending: { text: 'En attente', className: 'bg-wait/15 text-wait' },
  failed: { text: 'Échoué', className: 'bg-stop/15 text-stop' },
  cancelled: { text: 'Annulé', className: 'bg-white/5 text-chalk-muted' },
}

const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'paid', label: 'Payées' },
  { id: 'pending', label: 'En attente' },
  { id: 'failed', label: 'Échouées' },
] as const

export default function SalesPage() {
  const { shop } = useAdmin()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')

  useEffect(() => {
    supabase
      .from('orders')
      .select('*')
      .eq('shop_id', shop.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setOrders(data ?? []))
  }, [shop.id])

  if (!orders) return <Spinner />

  const paid = orders.filter((o) => o.status === 'paid')
  const total = paid.reduce((sum, o) => sum + o.amount, 0)
  const shown =
    filter === 'all'
      ? orders
      : orders.filter((o) => (filter === 'failed' ? o.status !== 'paid' && o.status !== 'pending' : o.status === filter))

  return (
    <>
      <Card title="Résumé">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-chalk">
              {formatPrice(total)}
            </p>
            <p className="text-sm text-chalk-faint">Total encaissé</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-chalk">{paid.length}</p>
            <p className="text-sm text-chalk-faint">{paid.length > 1 ? 'ventes' : 'vente'}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-chalk">{orders.length}</p>
            <p className="text-sm text-chalk-faint">tentatives au total</p>
          </div>
        </div>
      </Card>

      <Card title="Commandes">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={
                  'rounded-full px-3 py-1 text-sm transition ' +
                  (filter === f.id
                    ? 'bg-white text-black'
                    : 'text-chalk-faint hover:bg-white/5 hover:text-chalk')
                }
              >
                {f.label}
              </button>
            ))}
          </div>
          {orders.length > 0 && <ExportButton orders={orders} slug={shop.slug} />}
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-chalk-faint">
            {orders.length === 0
              ? "Aucune commande pour l'instant. Elles apparaîtront ici dès le premier achat."
              : 'Aucune commande dans cette catégorie.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-chalk-faint">
                <tr>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Acheteur</th>
                  <th className="py-2 pr-4 font-medium">Montant</th>
                  <th className="py-2 pr-4 font-medium">Statut</th>
                  <th className="py-2 font-medium">Téléch.</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((order) => (
                  <tr key={order.id} className="border-b border-line-soft last:border-0">
                    <td className="whitespace-nowrap py-2 pr-4 text-chalk-faint">
                      {formatDate(order.created_at)}
                    </td>
                    <td className="py-2 pr-4 text-chalk">
                      {order.buyer_email}
                      {order.buyer_name && (
                        <span className="block text-xs text-chalk-faint">{order.buyer_name}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 tabular-nums">
                      {formatPrice(order.amount, order.currency)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STATUS[order.status].className}`}
                      >
                        {STATUS[order.status].text}
                      </span>
                    </td>
                    <td className="py-2 tabular-nums text-chalk-faint">
                      {order.status === 'paid'
                        ? `${order.download_count}/${order.max_downloads}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

function ExportButton({ orders, slug }: { orders: Order[]; slug: string }) {
  function download() {
    const header = ['Date', 'Email', 'Nom', 'Téléphone', 'Montant', 'Devise', 'Statut']
    const rows = orders.map((o) => [
      o.created_at,
      o.buyer_email,
      o.buyer_name ?? '',
      o.buyer_phone ?? '',
      String(o.amount),
      o.currency,
      o.status,
    ])

    // Les guillemets doublés protègent les virgules dans les noms.
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `ventes-${slug}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={download}
      className="rounded-lg border border-line px-3 py-1.5 text-sm text-chalk-muted hover:bg-ink"
    >
      Exporter en CSV
    </button>
  )
}
