import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { Card, Eyebrow, Spinner } from '../../components/ui'

/**
 * Ce que les acheteurs ont répondu, un jour après leur achat.
 *
 * À ne pas confondre avec les témoignages saisis sur chaque fiche produit :
 * ceux-là sont choisis et publics, ceux-ci sont bruts et privés. Personne ne les
 * voit à part le vendeur — c'est ce qui est promis dans le courrier, et c'est ce
 * qui fait qu'un acheteur mécontent écrit ce qu'il pense vraiment.
 *
 * Il n'y a donc rien pour les publier, rien pour y répondre depuis ici : le
 * numéro WhatsApp est dans l'email, et une réclamation se règle là-bas, pas dans
 * un tableau de bord.
 */
type Avis = {
  id: string
  rating: number
  body: string | null
  created_at: string
  orders: {
    buyer_name: string | null
    buyer_email: string
    products: { title: string } | null
  } | null
}

const FILTRES = [
  { id: 'tous', label: 'Tous' },
  { id: 'positifs', label: '4 et 5 étoiles' },
  { id: 'negatifs', label: '3 étoiles et moins' },
] as const

export default function AvisClients() {
  const [avis, setAvis] = useState<Avis[] | null>(null)
  const [filtre, setFiltre] = useState<(typeof FILTRES)[number]['id']>('tous')

  useEffect(() => {
    async function charger() {
      const { data } = await supabase
        .from('order_feedback')
        .select('id, rating, body, created_at, orders!inner(buyer_name, buyer_email, products(title))')
        .order('created_at', { ascending: false })
        .limit(500)

      setAvis((data ?? []) as unknown as Avis[])
    }

    void charger()
  }, [])

  if (!avis) return <Spinner />

  const montres = avis.filter((a) =>
    filtre === 'tous' ? true : filtre === 'positifs' ? a.rating >= 4 : a.rating <= 3,
  )

  // La moyenne d'une poignée d'avis ne veut rien dire ; on ne l'affiche qu'à
  // partir du moment où elle commence à en vouloir un.
  const moyenne =
    avis.length >= 5 ? avis.reduce((somme, a) => somme + a.rating, 0) / avis.length : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Avis des acheteurs</Eyebrow>
          <p className="mt-1 text-sm text-ink-faint">
            Reçus par email un jour après l'achat. Visibles par toi seul.
          </p>
        </div>
        {moyenne !== null && (
          <p className="text-sm text-ink-muted">
            <span className="text-lg font-medium text-ink">{moyenne.toFixed(1)}</span> / 5 sur{' '}
            {avis.length} avis
          </p>
        )}
      </div>

      <Card title="Avis reçus">
        {avis.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {FILTRES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltre(f.id)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  filtre === f.id
                    ? 'bg-ink text-canvas'
                    : 'bg-tint text-ink-muted hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {montres.length === 0 ? (
          <p className="text-sm text-ink-faint">
            {avis.length === 0
              ? "Aucun avis pour l'instant. Le premier arrivera un jour après le prochain téléchargement."
              : 'Aucun avis dans cette catégorie.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {montres.map((a) => (
              <li key={a.id} className="rounded-xl border border-line bg-raise p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Etoiles note={a.rating} />
                  <span className="text-xs text-ink-faint">{formatDate(a.created_at)}</span>
                </div>

                {a.body && (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {a.body}
                  </p>
                )}

                <p className="mt-3 text-xs text-ink-faint">
                  {a.orders?.buyer_name || a.orders?.buyer_email}
                  {a.orders?.products?.title && ` — ${a.orders.products.title}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Etoiles({ note }: { note: number }) {
  return (
    <span className="text-base" title={`${note} sur 5`}>
      <span aria-hidden="true" className="text-amber-400">
        {'★'.repeat(note)}
      </span>
      <span aria-hidden="true" className="text-line">
        {'★'.repeat(5 - note)}
      </span>
      <span className="sr-only">{note} étoiles sur 5</span>
    </span>
  )
}
