import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { Alert, Card, Spinner } from '../components/ui'

type Status = { status: 'pending' | 'paid' | 'failed' | 'cancelled'; download_url: string | null }

/**
 * pawaPay renvoie l'acheteur ici dès qu'il quitte la page de paiement, ce qui
 * arrive souvent AVANT le callback serveur. On interroge donc le statut jusqu'à
 * ce qu'il soit définitif.
 *
 * Chaque interrogation peut déclencher un appel à l'API pawaPay côté serveur,
 * d'où l'espacement progressif : les confirmations rapides restent rapides,
 * mais une attente longue ne se paie pas en dizaines de requêtes.
 */
const FIRST_DELAY_MS = 2000
const MAX_DELAY_MS = 10000
const DEADLINE_MS = 3 * 60 * 1000

export default function Return() {
  const [params] = useSearchParams()
  const orderId = params.get('order')
  const [state, setState] = useState<Status | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!orderId) return
    const deadline = Date.now() + DEADLINE_MS
    let delay = FIRST_DELAY_MS
    let stopped = false

    async function poll() {
      if (stopped) return
      try {
        const result = await callFunction<Status>('order-status', { order_id: orderId })
        if (stopped) return
        setState(result)
        if (result.status !== 'pending') return
      } catch {
        // Erreur réseau passagère : on retentera au prochain tour.
      }
      if (Date.now() >= deadline) {
        setTimedOut(true)
        return
      }
      setTimeout(poll, delay)
      delay = Math.min(Math.round(delay * 1.5), MAX_DELAY_MS)
    }

    void poll()
    return () => {
      stopped = true
    }
  }, [orderId])

  if (!orderId) {
    return <Wrapper><p className="text-slate-500">Commande introuvable.</p></Wrapper>
  }

  if (state?.status === 'paid') {
    return (
      <Wrapper>
        <Alert kind="ok">Paiement confirmé. Merci !</Alert>
        <p className="mt-4 text-slate-600">
          Le lien de téléchargement vient de partir par email. Il est valable 24 h.
        </p>
        {state.download_url && (
          <a
            href={state.download_url}
            className="mt-4 block rounded-lg bg-slate-900 px-4 py-3 text-center font-medium text-white hover:bg-slate-700"
          >
            Télécharger maintenant
          </a>
        )}
      </Wrapper>
    )
  }

  if (state?.status === 'failed' || state?.status === 'cancelled') {
    return (
      <Wrapper>
        <Alert kind="error">
          Le paiement n'a pas abouti. Aucun montant n'a été débité.
        </Alert>
        <BackLink />
      </Wrapper>
    )
  }

  if (timedOut) {
    return (
      <Wrapper>
        <p className="text-slate-600">
          La confirmation prend plus de temps que prévu. Si le paiement est passé, tu recevras
          le lien par email dès que l'opérateur nous le confirme — inutile de payer à nouveau.
        </p>
        <BackLink />
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <Spinner label="Confirmation du paiement en cours…" />
      <p className="text-center text-sm text-slate-400">Ne ferme pas cette page.</p>
    </Wrapper>
  )
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <Card>{children}</Card>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link to=".." relative="path" className="mt-4 block text-center text-sm text-slate-500 underline">
      Retour à la boutique
    </Link>
  )
}
