import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPrice } from '../../lib/format'
import { Alert, Button, Card, Field, Spinner, inputClass } from '../../components/ui'
import { useAdmin } from './AdminLayout'

/**
 * Les pays hors zone franc CFA, qu'il faut ouvrir un par un.
 *
 * Ceux de la zone partagent le prix affiché tel quel — XOF et XAF valent la même
 * chose. Ailleurs, chaque pays a sa monnaie : sans taux enregistré, on ne sait
 * pas quel montant demander et le pays reste invisible sur la page de paiement.
 *
 * `defaultRate` n'est qu'un point de départ relevé le jour où ce pays a été
 * ajouté. Le naira surtout bouge vite : c'est au vendeur de vérifier avant
 * d'ouvrir la vente.
 */
const PAYS = [
  {
    code: 'CDF',
    pays: 'République démocratique du Congo',
    label: 'Franc congolais (CDF)',
    decimals: 0,
    roundTo: 100,
    defaultRate: 4.04,
    hint: 'Combien de francs congolais pour 1 FCFA.',
  },
  {
    code: 'NGN',
    pays: 'Nigéria',
    label: 'Naira (NGN)',
    decimals: 0,
    roundTo: 100,
    defaultRate: 2.39,
    hint: 'Combien de nairas pour 1 FCFA.',
  },
  {
    code: 'GHS',
    pays: 'Ghana',
    label: 'Cedi (GHS)',
    decimals: 0,
    roundTo: 1,
    defaultRate: 0.0195,
    hint: 'Combien de cedis pour 1 FCFA.',
  },
] as const

type Code = (typeof PAYS)[number]['code']

/** Ce qu'on garde à l'écran pour chaque pays. */
type Ligne = { actif: boolean; rate: string; updatedAt: string | null }

/** Reproduit exactement le calcul fait côté serveur au moment du paiement. */
function convert(price: number, rate: number, decimals: number, roundTo: number): string {
  const raw = price * rate
  if (decimals > 0) return raw.toFixed(decimals)
  const step = Math.max(1, Math.round(roundTo))
  return String(Math.max(step, Math.round(raw / step) * step))
}

const JOURS_AVANT_ALERTE = 30

const VIDE: Ligne = { actif: false, rate: '', updatedAt: null }

export default function CurrenciesEditor() {
  const { shop, products } = useAdmin()
  const [lignes, setLignes] = useState<Record<Code, Ligne>>(
    () => Object.fromEntries(PAYS.map((p) => [p.code, VIDE])) as Record<Code, Ligne>,
  )
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    supabase
      .from('shop_currencies')
      .select('currency, rate, updated_at')
      .eq('shop_id', shop.id)
      .eq('is_active', true)
      .then(({ data }) => {
        setLignes((avant) => {
          const apres = { ...avant }
          for (const row of data ?? []) {
            if (!(row.currency in apres)) continue
            apres[row.currency as Code] = {
              actif: true,
              rate: String(row.rate),
              updatedAt: row.updated_at,
            }
          }
          return apres
        })
        setLoading(false)
      })
  }, [shop.id])

  function modifier(code: Code, champs: Partial<Ligne>) {
    setLignes((avant) => ({ ...avant, [code]: { ...avant[code], ...champs } }))
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    setError(null)

    const ouverts = PAYS.filter((p) => lignes[p.code].actif)

    for (const p of ouverts) {
      const valeur = Number(lignes[p.code].rate)
      if (!Number.isFinite(valeur) || valeur <= 0) {
        setError(`Le taux pour ${p.pays} doit être un nombre supérieur à zéro.`)
        setBusy(false)
        return
      }
    }

    // Fermer un pays, c'est retirer sa ligne : la page de paiement se règle sur
    // ce qui existe en base. On ne touche qu'aux devises de cet écran, pour ne
    // pas effacer un réglage posé ailleurs.
    const fermes = PAYS.filter((p) => !lignes[p.code].actif).map((p) => p.code)

    const { error: retraitError } = await supabase
      .from('shop_currencies')
      .delete()
      .eq('shop_id', shop.id)
      .in('currency', fermes)

    if (retraitError) {
      setError(retraitError.message)
      setBusy(false)
      return
    }

    if (ouverts.length > 0) {
      const { error: ecritureError } = await supabase.from('shop_currencies').upsert(
        ouverts.map((p) => ({
          shop_id: shop.id,
          currency: p.code,
          rate: Number(lignes[p.code].rate),
          decimals: p.decimals,
          round_to: p.roundTo,
          is_active: true,
        })),
        { onConflict: 'shop_id,currency' },
      )

      if (ecritureError) {
        setError(ecritureError.message)
        setBusy(false)
        return
      }
    }

    const maintenant = new Date().toISOString()
    setLignes((avant) => {
      const apres = { ...avant }
      for (const p of PAYS) {
        apres[p.code] = apres[p.code].actif
          ? { ...apres[p.code], updatedAt: maintenant }
          : { ...apres[p.code], updatedAt: null }
      }
      return apres
    })

    setSaved(true)
    setBusy(false)
  }

  if (loading) {
    return (
      <Card title="Vendre hors zone franc CFA">
        <Spinner label="Chargement des taux de conversion…" />
      </Card>
    )
  }

  const exemple = products.find((p) => p.price > 0)

  return (
    <Card title="Vendre hors zone franc CFA">
      <p className="mb-5 text-sm leading-relaxed text-ink-muted">
        Les pays de la zone franc CFA partagent ton prix tel quel. Ailleurs, chaque pays a sa
        monnaie : ouvre-le en donnant son taux de conversion, et il apparaîtra sur ta page de
        paiement avec les opérateurs qu'on y sait joindre.
      </p>

      <div className="space-y-5">
        {PAYS.map((p) => {
          const ligne = lignes[p.code]
          const taux = Number(ligne.rate)
          const apercu =
            exemple && Number.isFinite(taux) && taux > 0
              ? convert(exemple.price, taux, p.decimals, p.roundTo)
              : null

          const ancien =
            ligne.actif &&
            ligne.updatedAt &&
            Date.now() - new Date(ligne.updatedAt).getTime() > JOURS_AVANT_ALERTE * 86400000

          return (
            <div key={p.code} className="rounded-xl border border-line p-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={ligne.actif}
                  onChange={(e) => {
                    const actif = e.target.checked
                    modifier(p.code, {
                      actif,
                      rate: actif && !ligne.rate ? String(p.defaultRate) : ligne.rate,
                    })
                  }}
                  className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="text-sm font-medium text-ink">Vendre au {p.pays}</span>
              </label>

              {ligne.actif && (
                <div className="mt-4 space-y-3">
                  <Field label={`Taux — ${p.label}`} hint={p.hint}>
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={ligne.rate}
                      onChange={(e) => modifier(p.code, { rate: e.target.value })}
                      className={inputClass}
                    />
                  </Field>

                  {exemple && (
                    <div className="rounded-lg border border-line bg-raise p-3">
                      <p className="text-xs text-ink-faint">
                        Ce que paiera un acheteur au {p.pays}
                      </p>
                      <p className="mt-1 text-ink">
                        <span className="text-ink-faint">
                          {formatPrice(exemple.price, exemple.currency)}
                        </span>{' '}
                        →{' '}
                        <span className="font-medium tabular-nums">
                          {apercu ?? '—'} {p.code}
                        </span>
                      </p>
                      <p className="mt-1 truncate text-xs text-ink-faint">
                        d'après « {exemple.title} »
                      </p>
                    </div>
                  )}

                  {ancien && (
                    <Alert kind="error">
                      Ce taux n'a pas été mis à jour depuis plus de {JOURS_AVANT_ALERTE} jours.
                      Vérifie qu'il correspond toujours au marché.
                    </Alert>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <p className="text-xs leading-relaxed text-ink-faint">
          Les taux sont enregistrés, pas récupérés en direct : une API de change indisponible
          empêcherait tes clients de payer. En contrepartie, c'est à toi de les remettre à jour
          quand une monnaie bouge — le naira en particulier.
        </p>

        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="ok">Enregistré.</Alert>}

        <Button type="button" onClick={save} disabled={busy}>
          {busy ? '…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  )
}
