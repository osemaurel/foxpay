import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Order, Shop } from '../../lib/types'
import { formatDate, formatPrice } from '../../lib/format'
import { Card, Spinner } from '../../components/ui'

const STATUS_LABEL: Record<Order['status'], { text: string; className: string }> = {
  paid: { text: 'Payé', className: 'bg-emerald-100 text-emerald-800' },
  pending: { text: 'En attente', className: 'bg-amber-100 text-amber-800' },
  failed: { text: 'Échoué', className: 'bg-red-100 text-red-800' },
  cancelled: { text: 'Annulé', className: 'bg-slate-100 text-slate-600' },
}

export default function Sales({ shop }: { shop: Shop }) {
  const [orders, setOrders] = useState<Order[] | null>(null)

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

  return (
    <Card title="Ventes">
      <div className="mb-6 flex gap-8">
        <div>
          <p className="text-2xl font-semibold text-slate-900">{formatPrice(total)}</p>
          <p className="text-sm text-slate-500">Total encaissé</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-slate-900">{paid.length}</p>
          <p className="text-sm text-slate-500">
            {paid.length > 1 ? 'ventes' : 'vente'} sur {orders.length} tentative
            {orders.length > 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune commande pour l'instant.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Acheteur</th>
                <th className="py-2 pr-4 font-medium">Montant</th>
                <th className="py-2 pr-4 font-medium">Statut</th>
                <th className="py-2 font-medium">Téléch.</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const status = STATUS_LABEL[order.status]
                return (
                  <tr key={order.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4 whitespace-nowrap text-slate-500">
                      {formatDate(order.created_at)}
                    </td>
                    <td className="py-2 pr-4 text-slate-900">{order.buyer_email}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatPrice(order.amount, order.currency)}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${status.className}`}>
                        {status.text}
                      </span>
                    </td>
                    <td className="py-2 text-slate-500">
                      {order.status === 'paid'
                        ? `${order.download_count}/${order.max_downloads}`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
