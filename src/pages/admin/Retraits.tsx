import { useCallback, useEffect, useState } from 'react'
import { callFunctionAuth } from '../../lib/supabase'
import { supabase } from '../../lib/supabase'
import type { Payout } from '../../lib/types'
import { nomPays } from '../../lib/analytique'
import { Button, Card, Field, inputClass } from '../../components/ui'
import { useAdmin } from './AdminLayout'

/**
 * Retirer l'argent encaissé, vers un numéro mobile money.
 *
 * Les soldes viennent de pawaPay en direct — jamais d'un cumul calculé chez
 * nous : entre les commissions retenues et les versements déjà partis, notre
 * total et le leur ne peuvent pas coïncider, et c'est le leur qui fait foi.
 *
 * Un portefeuille par pays, et c'est la méthode choisie qui désigne lequel sera
 * débité. La liste des méthodes vient de pawaPay, filtrée sur celles qui savent
 * **recevoir** un virement — savoir encaisser ne suffit pas — et sur les pays
 * où il reste quelque chose. Regrouper les portefeuilles se fait depuis le
 * tableau de bord pawaPay.
 */
type Solde = { country: string; currency: string; balance: number }

type Methode = {
  country: string
  /** Identifiant pawaPay : MTN_MOMO_BEN, MOOV_BEN… */
  provider: string
  name: string
  currency: string
  minAmount: number | null
  maxAmount: number | null
  status: 'OPERATIONAL' | 'DELAYED' | 'CLOSED'
}

/** Les deux francs CFA s'écrivent FCFA ; le reste garde son code ISO. */
const SIGLES: Record<string, string> = { XOF: 'FCFA', XAF: 'FCFA' }

const montantLisible = (valeur: number, devise: string) =>
  `${Math.round(valeur).toLocaleString('fr-FR')} ${SIGLES[devise] ?? devise}`

export default function Retraits() {
  const { shop } = useAdmin()
  const [soldes, setSoldes] = useState<Solde[] | null>(null)
  const [methodes, setMethodes] = useState<Methode[]>([])
  const [erreurSoldes, setErreurSoldes] = useState<string | null>(null)
  const [retraits, setRetraits] = useState<Payout[]>([])

  const chargerRetraits = useCallback(async () => {
    const { data } = await supabase
      .from('payouts')
      .select('*')
      .eq('shop_id', shop.id)
      .order('created_at', { ascending: false })
    setRetraits(data ?? [])
  }, [shop.id])

  const chargerSoldes = useCallback(async () => {
    setErreurSoldes(null)
    try {
      const reponse = await callFunctionAuth<{ soldes: Solde[]; methodes: Methode[] }>(
        'retraits',
        { action: 'soldes' },
      )
      setSoldes(reponse.soldes)
      setMethodes(reponse.methodes)
    } catch (e) {
      setErreurSoldes((e as Error).message)
      setSoldes([])
    }
  }, [])

  useEffect(() => {
    chargerSoldes()
    chargerRetraits()
  }, [chargerSoldes, chargerRetraits])

  // Un retrait accepté met quelques secondes à aboutir : tant qu'il en reste un
  // en attente, on redemande son statut plutôt que de laisser le vendeur devant
  // une ligne figée.
  const enAttente = retraits.find((r) => r.status === 'pending')
  useEffect(() => {
    if (!enAttente) return

    const timer = setInterval(async () => {
      try {
        await callFunctionAuth('retraits', { action: 'statut', payout_id: enAttente.id })
      } catch {
        // Une vérification ratée n'est pas un échec du retrait : on retentera.
      }
      await chargerRetraits()
      await chargerSoldes()
    }, 5000)

    return () => clearInterval(timer)
  }, [enAttente, chargerRetraits, chargerSoldes])

  const garnis = (soldes ?? []).filter((s) => s.balance !== 0)

  return (
    <>
      <Card title="Ce qui est disponible" eyebrow="pawaPay">
        {soldes === null ? (
          <p className="text-sm text-ink-faint">Lecture des portefeuilles…</p>
        ) : erreurSoldes ? (
          <p className="text-sm text-stop">{erreurSoldes}</p>
        ) : garnis.length === 0 ? (
          <p className="text-sm text-ink-faint">Tous les portefeuilles sont à zéro.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {garnis.map((s) => (
                <div
                  key={`${s.country}-${s.currency}`}
                  className="flex items-baseline justify-between gap-3 rounded-xl bg-tint px-4 py-3"
                >
                  <span className="min-w-0 truncate text-sm text-ink-muted">
                    {nomPays(s.country)}
                  </span>
                  <span
                    className={
                      'shrink-0 tabular-nums ' + (s.balance < 0 ? 'text-stop' : 'text-ink')
                    }
                  >
                    {montantLisible(s.balance, s.currency)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Un portefeuille par pays. Un retrait débite celui de la méthode choisie : pour
              tout sortir d'un seul coup, regroupe d'abord les portefeuilles depuis le tableau
              de bord pawaPay.
            </p>
          </>
        )}
      </Card>

      <Demande soldes={garnis} methodes={methodes} onFait={async () => {
        await chargerRetraits()
        await chargerSoldes()
      }} />

      <Historique retraits={retraits} />
    </>
  )
}

function Demande({
  soldes,
  methodes,
  onFait,
}: {
  soldes: Solde[]
  methodes: Methode[]
  onFait: () => Promise<void>
}) {
  const [methode, setMethode] = useState('')
  const [phone, setPhone] = useState('')
  const [montant, setMontant] = useState('')
  const [etat, setEtat] = useState<'idle' | 'busy'>('idle')
  const [erreur, setErreur] = useState<string | null>(null)

  async function lancer(e: React.FormEvent) {
    e.preventDefault()
    setEtat('busy')
    setErreur(null)
    try {
      await callFunctionAuth('retraits', {
        action: 'creer',
        methode,
        phone,
        amount: Number(montant),
      })
      setMontant('')
      await onFait()
    } catch (e) {
      setErreur((e as Error).message)
    } finally {
      setEtat('idle')
    }
  }

  // On ne propose que ce qui peut réellement partir : un opérateur dont le
  // portefeuille est vide n'est pas une méthode de retrait, c'est une déception.
  const proposables = methodes.filter(
    (m) =>
      m.status !== 'CLOSED' &&
      soldes.some(
        (s) => s.country === m.country && s.currency === m.currency && s.balance > 0,
      ),
  )

  const choisie = proposables.find((m) => m.provider === methode)
  const portefeuille = choisie
    ? soldes.find((s) => s.country === choisie.country && s.currency === choisie.currency)
    : undefined

  const disponible = proposables.length > 0

  return (
    <Card title="Faire un retrait">
      <form onSubmit={lancer} className="space-y-5">
        <Field
          label="Méthode de retrait"
          hint={
            choisie
              ? `Débite le portefeuille ${nomPays(choisie.country)}${
                  portefeuille ? ` — ${montantLisible(portefeuille.balance, portefeuille.currency)}` : ''
                }.`
              : 'Là où pawaPay enverra l\'argent.'
          }
        >
          <select
            className={inputClass}
            value={methode}
            onChange={(e) => setMethode(e.target.value)}
            required
          >
            <option value="">Choisis ta méthode</option>
            {proposables.map((m) => (
              <option key={`${m.country}-${m.provider}`} value={m.provider}>
                {m.name} · {nomPays(m.country)}
                {m.status === 'DELAYED' ? ' (retards en cours)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Ton numéro mobile money"
          hint="Avec l'indicatif, sans le « + ». Il doit être du pays de la méthode choisie."
        >
          <input
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="22997000000"
            required
          />
        </Field>

        <Field
          label="Montant"
          hint={
            choisie && choisie.minAmount !== null && choisie.maxAmount !== null
              ? `Entre ${choisie.minAmount.toLocaleString('fr-FR')} et ${montantLisible(
                  choisie.maxAmount,
                  choisie.currency,
                )} par virement.`
              : 'Dans la devise du portefeuille de la méthode choisie.'
          }
        >
          <input
            className={inputClass}
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
            inputMode="numeric"
            placeholder="50000"
            required
          />
        </Field>

        {erreur && <p className="text-sm leading-relaxed text-stop">{erreur}</p>}

        <Button type="submit" disabled={etat === 'busy' || !disponible}>
          {etat === 'busy' ? 'Envoi…' : 'Lancer le retrait'}
        </Button>

        {!disponible && (
          <p className="text-xs text-ink-faint">
            Aucune méthode disponible : tous les portefeuilles sont à zéro.
          </p>
        )}
      </form>
    </Card>
  )
}

const ETATS: Record<Payout['status'], { texte: string; classe: string }> = {
  pending: { texte: 'En cours', classe: 'text-wait' },
  completed: { texte: 'Versé', classe: 'text-go' },
  failed: { texte: 'Échoué', classe: 'text-stop' },
}

function Historique({ retraits }: { retraits: Payout[] }) {
  if (retraits.length === 0) return null

  return (
    <Card title="Tes retraits">
      <ul className="divide-y divide-line-soft">
        {retraits.map((r) => {
          const etat = ETATS[r.status]
          return (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
              <span className="tabular-nums text-ink">
                {montantLisible(Number(r.amount), r.currency)}
              </span>
              <span className="text-sm text-ink-faint">
                {nomPays(r.country)} · +{r.phone}
              </span>
              <span className={'ml-auto text-sm ' + etat.classe}>{etat.texte}</span>
              <span className="w-full text-xs text-ink-faint">
                {new Date(r.created_at).toLocaleString('fr-FR')}
                {r.failure_reason && ` · ${r.failure_reason}`}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
