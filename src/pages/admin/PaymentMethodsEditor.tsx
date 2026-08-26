import { useEffect, useMemo, useState } from 'react'
import { callFunctionAuth, supabase } from '../../lib/supabase'
import { Alert, Button, Card, Spinner } from '../../components/ui'
import { useAdmin } from './AdminLayout'

/**
 * Les moyens de paiement de la boutique : lesquels sont proposés, et par quel
 * prestataire ils sont encaissés.
 *
 * Deux réglages par méthode, pour deux besoins distincts :
 *
 *   - la proposer ou non. Un pays expose parfois six opérateurs quand deux
 *     servent vraiment ; les afficher tous allonge la page de paiement et fait
 *     hésiter l'acheteur au pire moment ;
 *   - qui encaisse, quand pawaPay et SebPay savent tous deux la traiter.
 *     pawaPay garde la main par défaut — c'est lui qui encaisse aujourd'hui, et
 *     une intégration ne doit pas changer de main toute seule.
 *
 * La liste vient du serveur : elle est construite avec les clés API des deux
 * prestataires, et suit donc leur catalogue réel. Un opérateur activé ou retiré
 * apparaît ou disparaît ici tout seul.
 */

type Processeur = 'pawapay' | 'sebpay' | 'saspay'

type Methode = {
  country: string
  country_name: string
  method: string
  name: string
  logo: string | null
  currency: string
  pawapay: boolean
  sebpay: boolean
  saspay: boolean
  enabled: boolean
  chosen: Processeur | null
  stored: boolean
  effective: Processeur | null
  closed: boolean
}

/** Ce que le vendeur a réglé pour une méthode, avant enregistrement. */
type Reglage = { active: boolean; processeur: Processeur | null }

const NOMS: Record<Processeur, string> = {
  pawapay: 'pawaPay',
  sebpay: 'SebPay',
  saspay: 'SasPay',
}

/**
 * Les prestataires capables de traiter cette méthode.
 *
 * Le choix n'est offert qu'à partir de deux : en dessous, il n'y a rien à
 * trancher et un sélecteur à une seule case ne ferait qu'encombrer la ligne.
 */
function choix(m: Methode): Processeur[] {
  const tous: Processeur[] = []
  if (m.pawapay) tous.push('pawapay')
  if (m.sebpay) tous.push('sebpay')
  if (m.saspay) tous.push('saspay')
  return tous
}

const cle = (m: Methode) => `${m.country}:${m.method}`

export default function PaymentMethodsEditor() {
  const { shop } = useAdmin()
  const [methodes, setMethodes] = useState<Methode[] | null>(null)
  const [reglages, setReglages] = useState<Record<string, Reglage>>({})
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
        setReglages(depart(data.methods))
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
    return methodes.some((m) => {
      const r = reglages[cle(m)]
      if (!r) return false
      return r.active !== m.enabled || (choix(m).length > 1 && r.processeur !== m.chosen)
    })
  }, [methodes, reglages])

  function regler(m: Methode, patch: Partial<Reglage>) {
    setReglages((r) => ({ ...r, [cle(m)]: { ...r[cle(m)], ...patch } }))
    setSaved(false)
  }

  async function save() {
    if (!methodes) return
    setBusy(true)
    setError(null)

    // Une ligne n'est écrite que si elle dit quelque chose : la méthode est
    // retirée, ou plusieurs prestataires savent la traiter et il faut trancher.
    // Ailleurs, l'absence de ligne laisse la méthode suivre le catalogue.
    const aGarder = methodes.filter((m) => {
      const r = reglages[cle(m)]
      return r && (!r.active || choix(m).length > 1)
    })

    const lignes = aGarder.map((m) => ({
      shop_id: shop.id,
      country: m.country,
      method: m.method,
      processor: choix(m).length > 1 ? reglages[cle(m)].processeur : null,
      enabled: reglages[cle(m)].active,
    }))

    if (lignes.length > 0) {
      const { error: upsertError } = await supabase
        .from('payment_routes')
        .upsert(lignes, { onConflict: 'shop_id,country,method' })

      if (upsertError) {
        setError(upsertError.message)
        setBusy(false)
        return
      }
    }

    const garder = new Set(aGarder.map(cle))
    const perimees = methodes.filter((m) => m.stored && !garder.has(cle(m)))

    for (const m of perimees) {
      await supabase
        .from('payment_routes')
        .delete()
        .eq('shop_id', shop.id)
        .eq('country', m.country)
        .eq('method', m.method)
    }

    // L'état affiché reflète ce qui vient d'être écrit, sans recharger tout le
    // catalogue des deux prestataires.
    setMethodes(
      methodes.map((m) => {
        const r = reglages[cle(m)]
        const stored = garder.has(cle(m))
        return {
          ...m,
          enabled: r?.active ?? true,
          chosen: stored ? (r?.processeur ?? null) : null,
          effective: r?.processeur ?? m.effective,
          stored,
        }
      }),
    )
    setSaved(true)
    setBusy(false)
  }

  if (loadError) {
    return (
      <Card title="Moyens de paiement">
        <Alert kind="error">{loadError}</Alert>
      </Card>
    )
  }

  if (!methodes) {
    return (
      <Card title="Moyens de paiement">
        <Spinner label="Chargement des moyens de paiement…" />
      </Card>
    )
  }

  return (
    <Card title="Moyens de paiement">
      <p className="mb-5 text-sm leading-relaxed text-ink-muted">
        Décoche ce que tes acheteurs n'utilisent pas&nbsp;: la page de paiement ne montre que ce
        qui reste. Quand deux prestataires savent traiter une méthode, tu choisis lequel
        s'en charge. Rien à régler pour vendre — tout est proposé par défaut.
      </p>

      <div className="space-y-6">
        {parPays.map(([pays, liste]) => {
          const actives = liste.filter((m) => reglages[cle(m)]?.active).length

          return (
            <div key={pays}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-ink">{pays}</p>
                <p className="text-xs text-ink-faint">
                  {actives === 0
                    ? "Ce pays n'apparaîtra plus"
                    : `${actives} sur ${liste.length}`}
                </p>
              </div>

              <div className="space-y-2">
                {liste.map((m) => (
                  <Ligne
                    key={cle(m)}
                    methode={m}
                    reglage={reglages[cle(m)]}
                    onChange={(patch) => regler(m, patch)}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="ok">Moyens de paiement enregistrés.</Alert>}

        <Button type="button" onClick={save} disabled={busy || !modifie}>
          {busy ? '…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  )
}

function Ligne({
  methode,
  reglage,
  onChange,
}: {
  methode: Methode
  reglage: Reglage | undefined
  onChange: (patch: Partial<Reglage>) => void
}) {
  const possibles = choix(methode)
  const active = reglage?.active ?? true

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 transition ${
        active ? 'bg-raise' : 'bg-transparent'
      }`}
    >
      <label className="flex min-w-0 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => onChange({ active: e.target.checked })}
          className="h-4 w-4 shrink-0 accent-[var(--accent)]"
        />
        {methode.logo && (
          <img
            src={methode.logo}
            alt=""
            className={`h-7 w-7 shrink-0 rounded object-contain ${active ? '' : 'opacity-40'}`}
          />
        )}
        <span className="min-w-0">
          <span
            className={`block truncate text-sm font-medium ${
              active ? 'text-ink' : 'text-ink-faint'
            }`}
          >
            {methode.name}
          </span>
          {active && methode.closed && (
            <span className="block text-xs text-stop">Coupé chez pawaPay en ce moment.</span>
          )}
        </span>
      </label>

      {/* Le choix du prestataire n'a de sens que sur une méthode proposée, et
          seulement quand plusieurs savent la traiter. */}
      {active &&
        (possibles.length > 1 ? (
          <div className="flex shrink-0 rounded-lg border border-line bg-card p-0.5">
            {possibles.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onChange({ processeur: p })}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  reglage?.processeur === p ? 'bg-ink text-canvas' : 'text-ink-muted hover:text-ink'
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
        ))}
    </div>
  )
}

/** L'état de départ : ce que la boutique propose et encaisse aujourd'hui. */
function depart(methodes: Methode[]): Record<string, Reglage> {
  const initial: Record<string, Reglage> = {}
  for (const m of methodes) {
    initial[cle(m)] = {
      active: m.enabled,
      processeur: choix(m).length > 1 ? m.effective : null,
    }
  }
  return initial
}
