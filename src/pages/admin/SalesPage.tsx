import { useEffect, useState } from 'react'
import { callFunctionAuth, supabase } from '../../lib/supabase'
import type { Order, Product } from '../../lib/types'
import { formatCharged, formatDate, formatPrice } from '../../lib/format'
import { countryName, providerName } from '../../lib/mmo'
import { Card, Eyebrow, Spinner } from '../../components/ui'
import { useAdmin } from './AdminLayout'

const STATUS: Record<Order['status'], { text: string; className: string }> = {
  paid: { text: 'Payé', className: 'bg-go/15 text-go' },
  pending: { text: 'En attente', className: 'bg-wait/15 text-wait' },
  failed: { text: 'Échoué', className: 'bg-stop/15 text-stop' },
  cancelled: { text: 'Annulé', className: 'bg-tint text-ink-muted' },
}

/**
 * Les codes d'échec de pawaPay, expliqués au vendeur.
 *
 * Ce ne sont pas les mêmes phrases que celles montrées à l'acheteur : lui a
 * besoin de savoir quoi refaire, le vendeur a besoin de savoir s'il a perdu une
 * vente, et pourquoi.
 */
const ECHECS: Record<string, string> = {
  PAYMENT_NOT_APPROVED: "L'acheteur n'a pas composé son code PIN à temps.",
  INSUFFICIENT_BALANCE: "Le solde mobile money de l'acheteur était insuffisant.",
  PAYMENT_IN_PROGRESS: "Une autre transaction était déjà en cours sur le compte de l'acheteur.",
  PAYER_NOT_FOUND: "Le numéro ne correspondait pas à l'opérateur choisi.",
  WALLET_LIMIT_REACHED: "Le portefeuille de l'acheteur a atteint sa limite.",
  UNSPECIFIED_FAILURE: "L'opérateur a refusé sans donner de raison.",
  PROVIDER_TEMPORARILY_UNAVAILABLE: "L'opérateur était en panne à ce moment-là.",
  INVALID_PHONE_NUMBER: 'Le numéro était invalide pour cet opérateur.',
  AMOUNT_OUT_OF_BOUNDS: "Le montant sortait des limites de transaction de l'opérateur.",
  NOT_FOUND: "La demande de paiement n'est jamais parvenue au processeur.",
  PAYMENT_REJECTED: "L'opérateur a refusé le paiement.",
}

/** Les deux prestataires qui encaissent, tels qu'on les nomme au vendeur. */
const PROCESSEURS: Record<string, string> = {
  pawapay: 'pawaPay',
  sebpay: 'SebPay',
}

const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'paid', label: 'Payées' },
  { id: 'pending', label: 'En attente' },
  { id: 'failed', label: 'Échouées' },
] as const

export default function SalesPage() {
  const { shop, products } = useAdmin()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const [openId, setOpenId] = useState<string | null>(null)

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
      : orders.filter((o) =>
          filter === 'failed' ? o.status !== 'paid' && o.status !== 'pending' : o.status === filter,
        )

  const open = orders.find((o) => o.id === openId) ?? null

  return (
    <>
      <Card title="Résumé">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-ink">{formatPrice(total)}</p>
            {/* Le prix des produits, pas la somme des montants débités : ceux-ci
                incluent les frais et peuvent être dans une autre devise. */}
            <p className="text-sm text-ink-faint">Prix des produits vendus</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-ink">{paid.length}</p>
            <p className="text-sm text-ink-faint">{paid.length > 1 ? 'ventes' : 'vente'}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-ink">{orders.length}</p>
            <p className="text-sm text-ink-faint">tentatives au total</p>
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
                    ? 'bg-ink text-canvas'
                    : 'text-ink-faint hover:bg-tint hover:text-ink')
                }
              >
                {f.label}
              </button>
            ))}
          </div>
          {orders.length > 0 && <ExportButton orders={orders} slug={shop.slug} />}
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-ink-faint">
            {orders.length === 0
              ? "Aucune commande pour l'instant. Elles apparaîtront ici dès le premier achat."
              : 'Aucune commande dans cette catégorie.'}
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-faint">
              Clique sur une ligne pour voir le détail de la commande.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-ink-faint">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">Acheteur</th>
                    <th className="py-2 pr-4 font-medium">Payé</th>
                    <th className="py-2 pr-4 font-medium">Pays</th>
                    <th className="py-2 font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => setOpenId(order.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setOpenId(order.id)
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Détail de la commande de ${order.buyer_email}`}
                      className="cursor-pointer border-b border-line-soft transition last:border-0 hover:bg-tint focus:bg-tint focus:outline-none"
                    >
                      <td className="whitespace-nowrap py-2 pr-4 text-ink-faint">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="py-2 pr-4 text-ink">
                        {order.buyer_email}
                        {order.buyer_name && (
                          <span className="block text-xs text-ink-faint">{order.buyer_name}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 tabular-nums">
                        {montantPaye(order)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-ink-muted">
                        {countryName(order.country) ?? '—'}
                      </td>
                      <td className="py-2">
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STATUS[order.status].className}`}
                        >
                          {STATUS[order.status].text}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {open && (
        <OrderDetail
          order={open}
          product={products.find((p) => p.id === open.product_id) ?? null}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  )
}

/** Ce que l'acheteur a réellement payé, dans sa devise. */
function montantPaye(order: Order): string {
  if (order.charged_amount !== null && order.charged_currency) {
    return formatCharged(String(order.charged_amount), order.charged_currency)
  }
  // Commandes d'avant les frais et la conversion : seul le prix était connu.
  return formatPrice(order.amount, order.currency)
}

function OrderDetail({
  order,
  product,
  onClose,
}: {
  order: Order
  product: Product | null
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Le fond ne doit pas défiler sous le panneau.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  // Les frais ne sont recalculables que si le paiement était dans la devise du
  // prix. Hors zone CFA le montant a été converti, et le taux d'alors n'est pas
  // conservé : mieux vaut ne rien afficher qu'un chiffre reconstitué.
  const frais =
    order.charged_amount !== null && order.charged_currency === order.currency
      ? order.charged_amount - order.amount
      : null

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Détail de la commande"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-card p-6 sm:rounded-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS[order.status].className}`}
            >
              {STATUS[order.status].text}
            </span>
            <h2 className="mt-2 text-lg font-medium leading-snug text-ink">
              {product?.title ?? 'Produit supprimé'}
            </h2>
            <p className="text-sm text-ink-faint">{formatDate(order.created_at)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Fermer"
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted transition hover:bg-raise"
          >
            Fermer
          </button>
        </div>

        <Section titre="Acheteur">
          <Ligne label="Nom" valeur={order.buyer_name} />
          <Ligne label="Email" valeur={order.buyer_email} />
          <Ligne label="Téléphone" valeur={order.buyer_phone ? `+${order.buyer_phone}` : null} />
          <Ligne label="Pays" valeur={countryName(order.country)} />
        </Section>

        <Section titre="Paiement">
          <Ligne label="Opérateur" valeur={providerName(order.mmo_provider)} />
          <Ligne label="Encaissé par" valeur={PROCESSEURS[order.provider] ?? order.provider} />
          <Ligne label="Montant payé" valeur={montantPaye(order)} />
          <Ligne label="Prix du produit" valeur={formatPrice(order.amount, order.currency)} />
          {frais !== null && (
            <Ligne
              label="dont frais de paiement"
              valeur={formatPrice(frais, order.currency)}
            />
          )}
          <Ligne
            label="Confirmé le"
            valeur={order.paid_at ? formatDate(order.paid_at) : null}
          />
        </Section>

        {order.status === 'failed' && (
          <Section titre="Pourquoi ça n'a pas abouti">
            <p className="text-sm leading-relaxed text-ink">
              {(order.failure_code && ECHECS[order.failure_code]) ??
                "L'opérateur a refusé le paiement."}
            </p>
            {order.failure_reason && (
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                Message de {PROCESSEURS[order.provider] ?? order.provider} :{' '}
                {order.failure_reason}
              </p>
            )}
          </Section>
        )}

        {order.status === 'paid' && (
          <Section titre="Livraison">
            <Ligne
              label="Email envoyé"
              valeur={order.delivered_at ? formatDate(order.delivered_at) : 'Pas encore'}
            />
            <Ligne
              label="Téléchargements"
              valeur={`${order.download_count} sur ${order.max_downloads}`}
            />
            <Ligne
              label="Lien valable jusqu'au"
              valeur={order.download_expires_at ? formatDate(order.download_expires_at) : null}
            />
            <Renvoi order={order} />
          </Section>
        )}

        <Section titre="Références">
          <Ligne label="Commande" valeur={order.id} mono />
          {/* SebPay réconcilie sur l'identifiant de commande ci-dessus ; seul
              pawaPay a son propre identifiant de dépôt. */}
          {order.provider === 'pawapay' && (
            <Ligne label="Dépôt pawaPay" valeur={order.deposit_id} mono />
          )}
          <Ligne label="Transaction opérateur" valeur={order.provider_transaction_id} mono />
        </Section>
      </div>
    </div>
  )
}

/**
 * Renvoyer l'email de livraison.
 *
 * Deux cas, et le libellé du bouton dit lequel : rattraper une vente dont
 * l'email n'est jamais parti — une panne d'envoi laisse la commande livrée à
 * moitié — ou réexpédier à un acheteur qui ne le trouve plus.
 */
function Renvoi({ order }: { order: Order }) {
  const [etat, setEtat] = useState<'idle' | 'busy' | 'ok'>('idle')
  const [error, setError] = useState<string | null>(null)

  const dejaEnvoye = Boolean(order.delivered_at)

  async function envoyer() {
    setEtat('busy')
    setError(null)
    try {
      await callFunctionAuth('resend-delivery', { order_id: order.id, force: dejaEnvoye })
      setEtat('ok')
    } catch (e) {
      setError((e as Error).message)
      setEtat('idle')
    }
  }

  if (etat === 'ok') {
    return (
      <p className="pt-1 text-sm text-go">
        Email envoyé à {order.buyer_email}.
      </p>
    )
  }

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={envoyer}
        disabled={etat === 'busy'}
        className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition hover:bg-raise disabled:opacity-40"
      >
        {etat === 'busy' ? '…' : dejaEnvoye ? "Renvoyer l'email" : "Envoyer l'email"}
      </button>
      {error && <p className="mt-2 text-xs leading-relaxed text-stop">{error}</p>}
    </div>
  )
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line-soft py-4 first-of-type:border-t-0 first-of-type:pt-0">
      <Eyebrow>{titre}</Eyebrow>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  )
}

/** Une information manquante est dite, pas masquée : « — » vaut réponse. */
function Ligne({
  label,
  valeur,
  mono,
}: {
  label: string
  valeur: string | null
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-ink-faint">{label}</span>
      <span className={`text-right text-ink ${mono ? 'break-all font-mono text-xs' : ''}`}>
        {valeur || '—'}
      </span>
    </div>
  )
}

function ExportButton({ orders, slug }: { orders: Order[]; slug: string }) {
  function download() {
    const header = [
      'Date',
      'Email',
      'Nom',
      'Téléphone',
      'Pays',
      'Opérateur',
      'Prix produit',
      'Devise produit',
      'Montant payé',
      'Devise payée',
      'Statut',
      'Échec',
    ]
    const rows = orders.map((o) => [
      o.created_at,
      o.buyer_email,
      o.buyer_name ?? '',
      o.buyer_phone ?? '',
      countryName(o.country) ?? '',
      providerName(o.mmo_provider) ?? '',
      String(o.amount),
      o.currency,
      o.charged_amount !== null ? String(o.charged_amount) : '',
      o.charged_currency ?? '',
      o.status,
      o.failure_code ?? '',
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
      className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-canvas"
    >
      Exporter en CSV
    </button>
  )
}
