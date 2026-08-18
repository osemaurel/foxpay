import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPrice } from '../../lib/format'
import { Alert, Button, Card, Field, Spinner, inputClass } from '../../components/ui'
import { useAdmin } from './AdminLayout'

/**
 * La RDC est le seul pays hors zone franc CFA atteignable par pawaPay, et on y
 * vend en franc congolais. La plateforme y accepterait aussi le dollar, mais
 * c'est une décision commerciale : un seul prix, dans la monnaie du pays.
 */
const OPTIONS = {
  CDF: {
    label: 'Franc congolais (CDF)',
    decimals: 0,
    roundTo: 100,
    defaultRate: 4.04,
    hint: 'Combien de francs congolais pour 1 FCFA.',
  },
} as const

type Code = keyof typeof OPTIONS

/** Reproduit exactement le calcul fait côté serveur au moment du paiement. */
function convert(price: number, rate: number, decimals: number, roundTo: number): string {
  const raw = price * rate
  if (decimals > 0) return raw.toFixed(decimals)
  const step = Math.max(1, Math.round(roundTo))
  return String(Math.max(step, Math.round(raw / step) * step))
}

const JOURS_AVANT_ALERTE = 30

export default function CurrenciesEditor() {
  const { shop, products } = useAdmin()
  const [choix, setChoix] = useState<'' | Code>('')
  const [rate, setRate] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
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
        const actif = data?.[0]
        if (actif) {
          setChoix(actif.currency as Code)
          setRate(String(actif.rate))
          setUpdatedAt(actif.updated_at)
        }
        setLoading(false)
      })
  }, [shop.id])

  async function save() {
    setBusy(true)
    setError(null)

    // Une seule devise active à la fois : deux montants pour le même pays
    // laisseraient pawaPay arbitrer, ce que la documentation ne précise pas.
    const { error: cleanupError } = await supabase
      .from('shop_currencies')
      .delete()
      .eq('shop_id', shop.id)

    if (cleanupError) {
      setError(cleanupError.message)
      setBusy(false)
      return
    }

    if (choix) {
      const config = OPTIONS[choix]
      const valeur = Number(rate)
      if (!Number.isFinite(valeur) || valeur <= 0) {
        setError('Le taux doit être un nombre supérieur à zéro.')
        setBusy(false)
        return
      }

      const { error } = await supabase.from('shop_currencies').insert({
        shop_id: shop.id,
        currency: choix,
        rate: valeur,
        decimals: config.decimals,
        round_to: config.roundTo,
      })

      if (error) {
        setError(error.message)
        setBusy(false)
        return
      }
      setUpdatedAt(new Date().toISOString())
    } else {
      setUpdatedAt(null)
    }

    setSaved(true)
    setBusy(false)
  }

  if (loading) {
    return (
      <Card title="Vendre en RDC">
        <Spinner label="Chargement du taux de conversion…" />
      </Card>
    )
  }

  const config = choix ? OPTIONS[choix] : null
  const exemple = products.find((p) => p.price > 0)
  const taux = Number(rate)
  const apercu =
    config && exemple && Number.isFinite(taux) && taux > 0
      ? convert(exemple.price, taux, config.decimals, config.roundTo)
      : null

  const ancien =
    updatedAt &&
    Date.now() - new Date(updatedAt).getTime() > JOURS_AVANT_ALERTE * 86400000

  return (
    <Card title="Vendre en RDC">
      <p className="mb-5 text-sm leading-relaxed text-ink-muted">
        Les pays de la zone franc CFA partagent ton prix tel quel. La République démocratique
        du Congo a sa propre monnaie : il faut donc un taux de conversion pour y vendre.
      </p>

      <div className="space-y-4">
        <Field label="Vendre en République démocratique du Congo">
          <select
            value={choix}
            onChange={(e) => {
              const code = e.target.value as '' | Code
              setChoix(code)
              if (code && !rate) setRate(String(OPTIONS[code].defaultRate))
              setSaved(false)
            }}
            className={inputClass}
          >
            <option value="">Ne pas vendre en RDC</option>
            {(Object.keys(OPTIONS) as Code[]).map((code) => (
              <option key={code} value={code}>
                {OPTIONS[code].label}
              </option>
            ))}
          </select>
        </Field>

        {config && (
          <>
            <Field label="Taux de conversion" hint={config.hint}>
              <input
                type="number"
                step="any"
                min={0}
                value={rate}
                onChange={(e) => {
                  setRate(e.target.value)
                  setSaved(false)
                }}
                className={inputClass}
              />
            </Field>

            {exemple && (
              <div className="rounded-xl border border-line bg-raise p-4">
                <p className="text-xs text-ink-faint">Ce que paiera un acheteur en RDC</p>
                <p className="mt-1 text-ink">
                  <span className="text-ink-faint">
                    {formatPrice(exemple.price, exemple.currency)}
                  </span>{' '}
                  →{' '}
                  <span className="font-medium tabular-nums">
                    {apercu ?? '—'} {choix}
                  </span>
                </p>
                <p className="mt-1 truncate text-xs text-ink-faint">
                  d'après « {exemple.title} »
                </p>
              </div>
            )}

            <p className="text-xs leading-relaxed text-ink-faint">
              Le taux est enregistré, pas récupéré en direct : une API de change indisponible
              empêcherait tes clients de payer. En contrepartie, c'est à toi de le remettre à
              jour quand la monnaie bouge.
            </p>

            {ancien && (
              <Alert kind="error">
                Ce taux n'a pas été mis à jour depuis plus de {JOURS_AVANT_ALERTE} jours.
                Vérifie qu'il correspond toujours au marché.
              </Alert>
            )}
          </>
        )}

        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="ok">Enregistré.</Alert>}

        <Button type="button" onClick={save} disabled={busy}>
          {busy ? '…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  )
}
