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
 * Un portefeuille par pays. Le pays n'est pas demandé au vendeur : il est déduit
 * du numéro par pawaPay, qui en donne aussi l'opérateur. Un numéro béninois
 * débite donc le portefeuille béninois, et lui seul. Regrouper les
 * portefeuilles se fait depuis le tableau de bord pawaPay.
 */
type Solde = { country: string; currency: string; balance: number }

/** Les deux francs CFA s'écrivent FCFA ; le reste garde son code ISO. */
const SIGLES: Record<string, string> = { XOF: 'FCFA', XAF: 'FCFA' }

const montantLisible = (valeur: number, devise: string) =>
  `${Math.round(valeur).toLocaleString('fr-FR')} ${SIGLES[devise] ?? devise}`

export default function Retraits() {
  const { shop } = useAdmin()
  const [soldes, setSoldes] = useState<Solde[] | null>(null)
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
      const { soldes } = await callFunctionAuth<{ soldes: Solde[] }>('retraits', {
        action: 'soldes',
      })
      setSoldes(soldes)
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
              Un portefeuille par pays. Un retrait débite celui du pays de ton numéro : pour
              tout sortir d'un seul coup, regroupe d'abord les portefeuilles depuis le tableau
              de bord pawaPay.
            </p>
          </>
        )}
      </Card>

      <Demande soldes={garnis} onFait={async () => {
        await chargerRetraits()
        await chargerSoldes()
      }} />

      <Historique retraits={retraits} />
    </>
  )
}

function Demande({ soldes, onFait }: { soldes: Solde[]; onFait: () => Promise<void> }) {
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

  const disponible = soldes.some((s) => s.balance > 0)

  return (
    <Card title="Faire un retrait">
      <form onSubmit={lancer} className="space-y-5">
        <Field
          label="Ton numéro mobile money"
          hint="Avec l'indicatif, sans le « + ». L'opérateur et le pays en sont déduits."
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

        <Field label="Montant" hint="Dans la devise du portefeuille de ce pays.">
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
            Aucun portefeuille n'a de solde positif.
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
