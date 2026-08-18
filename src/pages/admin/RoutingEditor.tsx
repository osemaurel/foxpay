import { useEffect, useMemo, useState } from 'react'
import { callFunctionAuth, supabase } from '../../lib/supabase'
import { Alert, Button, Card, Spinner } from '../../components/ui'
import { useAdmin } from './AdminLayout'

/**
 * Quel processeur encaisse quelle méthode de paiement.
 *
 * pawaPay et SebPay se chevauchent en partie : certaines méthodes n'existent
 * que chez l'un, d'autres chez les deux. Quand les deux la proposent, pawaPay
 * garde la main par défaut — c'est lui qui encaisse aujourd'hui — et cet écran
 * permet de basculer une méthode vers SebPay si ses conditions y sont
 * meilleures, sans toucher au reste.
 *
 * La liste vient du serveur : elle est construite avec les clés API des deux
 * processeurs, et suit donc leur catalogue réel. Un opérateur activé ou retiré
 * apparaît ou disparaît ici tout seul.
 */

type Processeur = 'pawapay' | 'sebpay'

type Methode = {
  country: string
  country_name: string
  method: string
  name: string
  logo: string | null
  currency: string
  pawapay: boolean
  sebpay: boolean
  chosen: Processeur | null
  effective: Processeur | null
  closed: boolean
}

const NOMS: Record<Processeur, string> = { pawapay: 'pawaPay', sebpay: 'SebPay' }

const cle = (m: Methode) => `${m.country}:${m.method}`

export default function RoutingEditor() {
  const { shop } = useAdmin()
  const [methodes, setMethodes] = useState<Methode[] | null>(null)
  const [choix, setChoix] = useState<Record<string, Processeur>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    callFunctionAuth<{ methods: Methode[] }>('payment-methods', {})
      .then((data) => {
        if (cancelled) return
        setMethodes(data.methods)
        setChoix(depart(data.methods))
      })
      .catch((e) => !cancelled && setLoadError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [shop.id])

  // Regroupé par pays : c'est ainsi que le vendeur pense sa couverture, et
  // c'est ainsi que l'acheteur voit la liste au moment de payer.
  const parPays = useMemo(() => {
    const index = new Map<string, Methode[]>()
    for (const m of methodes ?? []) {
      const liste = index.get(m.country_name) ?? []
      liste.push(m)
      index.set(m.country_name, liste)
    }
    return [...index.entries()]
  }, [methodes])

  const modifie = useMemo(() => {
    if (!methodes) return false
    return methodes.some((m) => m.pawapay && m.sebpay && choix[cle(m)] !== m.chosen)
  }, [methodes, choix])

  async function save() {
    if (!methodes) return
    setBusy(true)
    setError(null)

    const doubles = methodes.filter((m) => m.pawapay && m.sebpay)

    // Le choix n'est enregistré que pour les méthodes que les deux processeurs
    // savent traiter. Ailleurs il n'y a rien à décider, et une ligne figée
    // empêcherait la méthode de suivre le catalogue.
    const lignes = doubles
      .filter((m) => choix[cle(m)])
      .map((m) => ({
        shop_id: shop.id,
        country: m.country,
        method: m.method,
        processor: choix[cle(m)],
      }))

    const { error: upsertError } = await supabase
      .from('payment_routes')
      .upsert(lignes, { onConflict: 'shop_id,country,method' })

    if (upsertError) {
      setError(upsertError.message)
      setBusy(false)
      return
    }

    // Les méthodes qu'un seul processeur propose désormais : leur ancienne
    // ligne ne veut plus rien dire.
    const garder = new Set(doubles.map(cle))
    const perimees = methodes.filter((m) => m.chosen && !garder.has(cle(m)))

    for (const m of perimees) {
      await supabase
        .from('payment_routes')
        .delete()
        .eq('shop_id', shop.id)
        .eq('country', m.country)
        .eq('method', m.method)
    }

    setMethodes(methodes.map((m) => appliquer(m, choix[cle(m)] ?? null, garder.has(cle(m)))))
    setSaved(true)
    setBusy(false)
  }

  if (loadError) {
    return (
      <Card title="Processeurs de paiement">
        <Alert kind="error">{loadError}</Alert>
      </Card>
    )
  }

  if (!methodes) {
    return (
      <Card title="Processeurs de paiement">
        <Spinner label="Chargement des méthodes de paiement…" />
      </Card>
    )
  }

  return (
    <Card title="Processeurs de paiement">
      <p className="mb-5 text-sm leading-relaxed text-ink-muted">
        Deux prestataires encaissent pour toi. Quand les deux savent traiter une méthode, tu
        choisis lequel s'en charge&nbsp;; sinon, le seul qui la propose est indiqué. Rien à
        régler pour vendre — cette page ne sert qu'à optimiser.
      </p>

      <div className="space-y-6">
        {parPays.map(([pays, liste]) => (
          <div key={pays}>
            <p className="mb-2 text-sm font-medium text-ink">{pays}</p>
            <div className="space-y-2">
              {liste.map((m) => (
                <Ligne
                  key={cle(m)}
                  methode={m}
                  valeur={choix[cle(m)]}
                  onChange={(p) => {
                    setChoix((c) => ({ ...c, [cle(m)]: p }))
                    setSaved(false)
                  }}
                />
              ))}
            </div>
          </div>
        ))}

        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="ok">Routage enregistré.</Alert>}

        <Button type="button" onClick={save} disabled={busy || !modifie}>
          {busy ? '…' : 'Enregistrer le routage'}
        </Button>
      </div>
    </Card>
  )
}

function Ligne({
  methode,
  valeur,
  onChange,
}: {
  methode: Methode
  valeur: Processeur | undefined
  onChange: (p: Processeur) => void
}) {
  const double = methode.pawapay && methode.sebpay

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raise px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {methode.logo && (
          <img src={methode.logo} alt="" className="h-7 w-7 shrink-0 rounded object-contain" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{methode.name}</p>
          {methode.closed && (
            <p className="text-xs text-stop">Coupé chez pawaPay en ce moment.</p>
          )}
        </div>
      </div>

      {double ? (
        <div className="flex shrink-0 rounded-lg border border-line bg-card p-0.5">
          {(['pawapay', 'sebpay'] as Processeur[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                valeur === p ? 'bg-ink text-canvas' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {NOMS[p]}
            </button>
          ))}
        </div>
      ) : (
        <span className="shrink-0 text-xs text-ink-faint">
          {methode.effective ? NOMS[methode.effective] : 'Indisponible'}
        </span>
      )}
    </div>
  )
}

/** L'état de départ des boutons : ce qui encaisse réellement aujourd'hui. */
function depart(methodes: Methode[]): Record<string, Processeur> {
  const initial: Record<string, Processeur> = {}
  for (const m of methodes) {
    if (m.pawapay && m.sebpay && m.effective) initial[cle(m)] = m.effective
  }
  return initial
}

/** Reflète ce qui vient d'être enregistré, sans recharger tout le catalogue. */
function appliquer(m: Methode, choisi: Processeur | null, garde: boolean): Methode {
  if (!garde) return { ...m, chosen: null }
  return { ...m, chosen: choisi, effective: choisi ?? m.effective }
}
