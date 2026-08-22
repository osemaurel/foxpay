import { useMemo, useState } from 'react'
import type { Order } from '../../lib/types'
import { formatPrice } from '../../lib/format'
import {
  parMethode,
  parPays,
  resume,
  serieQuotidienne,
  surLaPeriode,
  type Jour,
  type LigneMethode,
  type LignePays,
} from '../../lib/analytique'
import { Card } from '../../components/ui'

/**
 * La section analytique de l'accueil.
 *
 * Elle répond à quatre questions, dans l'ordre où un vendeur se les pose :
 * combien j'ai vendu, quand, par quel moyen de paiement, et depuis quels pays.
 *
 * Les graphiques sont du HTML ordinaire — des div en flex — et non du SVG :
 * à cette échelle c'est plus court à lire, ça se redimensionne sans déformer le
 * texte, et les infobulles restent du DOM normal.
 *
 * Deux couleurs seulement, et toujours les mêmes : bleu pour ce qui a abouti,
 * orange pour ce qui a échoué. Elles ne suivent jamais le classement — une
 * méthode qui monte ou descend garde sa couleur.
 */

const PERIODES = [
  { jours: 7, label: '7 jours' },
  { jours: 30, label: '30 jours' },
  { jours: 90, label: '90 jours' },
  { jours: null, label: 'Tout' },
] as const

type Mesure = 'ventes' | 'encaisse'

export default function Analytique({ orders }: { orders: Order[] }) {
  const [jours, setJours] = useState<number | null>(30)
  const [mesure, setMesure] = useState<Mesure>('ventes')
  const [tableau, setTableau] = useState(false)

  // La devise de référence de la boutique : tous les montants additionnés ici
  // sont des prix de référence, jamais les montants locaux débités.
  const devise = orders[0]?.currency ?? 'XOF'

  const vue = useMemo(() => {
    const periode = surLaPeriode(orders, jours)
    return {
      serie: serieQuotidienne(periode, jours),
      methodes: parMethode(periode),
      pays: parPays(periode),
      chiffres: resume(periode),
    }
  }, [orders, jours])

  const { serie, methodes, pays, chiffres } = vue

  if (orders.length === 0) {
    return (
      <Card title="Analytique">
        <p className="text-sm text-ink-muted">
          Les graphiques apparaîtront dès ta première commande.
        </p>
      </Card>
    )
  }

  return (
    <Card title="Analytique">
      {/* Les filtres commandent tout ce qui suit : les chiffres s'accordent toujours. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {PERIODES.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setJours(p.jours)}
            aria-pressed={jours === p.jours}
            className={
              'rounded-lg border px-3 py-1.5 text-sm transition ' +
              (jours === p.jours
                ? 'border-transparent bg-tint-strong font-medium text-ink'
                : 'border-line text-ink-faint hover:text-ink')
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Deux colonnes jusqu'au grand écran : « 356 000 FCFA » ne tient pas dans
          un quart de carte, et une valeur tronquée vaut mieux pas de valeur. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
        <Tuile valeur={String(chiffres.ventes)} label={chiffres.ventes > 1 ? 'ventes' : 'vente'} />
        <Tuile valeur={formatPrice(chiffres.encaisse, devise)} label="encaissé" />
        <Tuile
          valeur={chiffres.tauxReussite === null ? '—' : pourcent(chiffres.tauxReussite)}
          label="paiements aboutis"
          note={chiffres.attente > 0 ? `${chiffres.attente} encore en attente` : undefined}
        />
        <Tuile valeur={formatPrice(Math.round(chiffres.panierMoyen), devise)} label="panier moyen" />
      </div>

      <Section
        titre={mesure === 'ventes' ? 'Ventes par jour' : 'Encaissé par jour'}
        action={
          <div className="flex items-center gap-1">
            <Bascule actif={mesure === 'ventes'} onClick={() => setMesure('ventes')}>
              Ventes
            </Bascule>
            <Bascule actif={mesure === 'encaisse'} onClick={() => setMesure('encaisse')}>
              Encaissé
            </Bascule>
          </div>
        }
      >
        <ColonnesJour serie={serie} mesure={mesure} devise={devise} />

        <button
          type="button"
          onClick={() => setTableau((v) => !v)}
          className="mt-4 text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          {tableau ? 'Masquer le tableau' : 'Voir le tableau'}
        </button>

        {tableau && <TableauJours serie={serie} devise={devise} />}
      </Section>

      <Section titre="Moyens de paiement">
        {methodes.length === 0 ? (
          <Vide />
        ) : (
          <>
            <Legende />
            <BarresMethodes lignes={methodes} devise={devise} />
          </>
        )}
      </Section>

      <Section titre="Pays">
        {pays.length === 0 ? <Vide /> : <BarresPays lignes={pays} devise={devise} />}
      </Section>
    </Card>
  )
}

// ============================================================
// Habillage
// ============================================================

function Section({
  titre,
  action,
  children,
}: {
  titre: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mt-8 border-t border-line-soft pt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-ink">{titre}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Tuile({ valeur, label, note }: { valeur: string; label: string; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xl font-semibold tabular-nums text-ink" title={valeur}>
        {valeur}
      </p>
      <p className="text-sm text-ink-faint">{label}</p>
      {note && <p className="mt-0.5 text-xs text-ink-faint">{note}</p>}
    </div>
  )
}

function Bascule({
  actif,
  onClick,
  children,
}: {
  actif: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={
        'rounded-lg px-2.5 py-1 text-xs transition ' +
        (actif ? 'bg-tint-strong font-medium text-ink' : 'text-ink-faint hover:text-ink')
      }
    >
      {children}
    </button>
  )
}

function Vide() {
  return <p className="text-sm text-ink-faint">Rien à montrer sur cette période.</p>
}

/** Deux séries à l'écran : la légende est obligatoire, la couleur ne suffit pas. */
function Legende() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
      {[
        { couleur: 'var(--serie-1)', nom: 'Réussies' },
        { couleur: 'var(--serie-2)', nom: 'Échouées' },
      ].map((s) => (
        <span key={s.nom} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ backgroundColor: s.couleur }}
          />
          {s.nom}
        </span>
      ))}
    </div>
  )
}

// ============================================================
// Ventes par jour
// ============================================================

/**
 * Une colonne par jour, y compris les jours à zéro : sauter les jours creux
 * comprimerait l'axe du temps et ferait passer une semaine morte pour une
 * progression régulière.
 *
 * Une seule série, donc pas de légende — le titre dit déjà ce qui est tracé.
 * Seul le sommet est étiqueté : une valeur sur chaque colonne ne se lit pas.
 */
function ColonnesJour({
  serie,
  mesure,
  devise,
}: {
  serie: Jour[]
  mesure: Mesure
  devise: string
}) {
  const valeurs = serie.map((j) => (mesure === 'ventes' ? j.ventes : j.encaisse))
  const max = Math.max(...valeurs, 0)


  const lire = (v: number) =>
    mesure === 'ventes' ? String(v) : formatPrice(Math.round(v), devise)

  const total = valeurs.reduce((s, v) => s + v, 0)

  if (max === 0) {
    return <Vide />
  }

  return (
    <figure
      className="m-0"
      role="img"
      aria-label={`${mesure === 'ventes' ? 'Ventes' : 'Montant encaissé'} par jour sur ${serie.length} jours, total ${lire(total)}. Le détail chiffré est dans le tableau ci-dessous.`}
    >
      <div className="mb-1 flex items-baseline justify-between text-xs text-ink-faint">
        <span className="tabular-nums">{lire(max)}</span>
        <span>maximum</span>
      </div>

      <div className="relative border-y border-line-soft">
        <div className="flex h-40 items-end gap-[2px]">
          {serie.map((j, i) => {
            const v = valeurs[i]
            return (
              <div key={j.jour} className="group relative flex flex-1 justify-center">
                {/* La colonne est fine et centrée : la place qui reste est de l'air. */}
                <div
                  className="w-full max-w-[24px] rounded-t-[4px] transition-opacity group-hover:opacity-80"
                  style={{
                    height: `${Math.max((v / max) * 160, v > 0 ? 2 : 0)}px`,
                    backgroundColor: 'var(--serie-1)',
                  }}
                />
                {/* Toute la colonne est la cible : on vise un jour, pas 4 pixels. */}
                <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-1 hidden justify-center group-hover:flex">
                  <span className="whitespace-nowrap rounded-lg border border-line bg-raise px-2 py-1 text-xs shadow-[var(--shadow)]">
                    <span className="font-medium tabular-nums text-ink">{lire(v)}</span>{' '}
                    <span className="text-ink-faint">{jourCourt(j.jour)}</span>
                  </span>
                </div>
              </div>
            )
          })}
        </div>

      </div>

      <figcaption className="mt-1 flex justify-between text-xs text-ink-faint">
        <span>{jourCourt(serie[0].jour)}</span>
        <span>{jourCourt(serie[serie.length - 1].jour)}</span>
      </figcaption>
    </figure>
  )
}

function TableauJours({ serie, devise }: { serie: Jour[]; devise: string }) {
  // Du plus récent au plus ancien : c'est l'ordre dans lequel on relit ses jours.
  const lignes = [...serie].reverse().filter((j) => j.ventes > 0)

  if (lignes.length === 0) {
    return <p className="mt-3 text-sm text-ink-faint">Aucune vente sur cette période.</p>
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-faint">
            <th className="py-2 font-normal">Jour</th>
            <th className="py-2 text-right font-normal">Ventes</th>
            <th className="py-2 text-right font-normal">Encaissé</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((j) => (
            <tr key={j.jour} className="border-b border-line-soft last:border-0">
              <td className="py-2 text-ink-muted">{jourLong(j.jour)}</td>
              <td className="py-2 text-right tabular-nums text-ink">{j.ventes}</td>
              <td className="py-2 text-right tabular-nums text-ink">
                {formatPrice(Math.round(j.encaisse), devise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================
// Moyens de paiement
// ============================================================

/**
 * Une barre par méthode, coupée en réussi / échoué.
 *
 * Les barres partagent la même échelle — la plus sollicitée occupe toute la
 * largeur — pour que la longueur se compare d'une ligne à l'autre. Les nombres
 * sont écrits à côté, jamais dans la barre : un segment étroit couperait son
 * étiquette.
 */
function BarresMethodes({ lignes, devise }: { lignes: LigneMethode[]; devise: string }) {
  const max = Math.max(...lignes.map((l) => l.tranchees))

  return (
    <ul className="space-y-3">
      {lignes.map((l) => (
        <li key={l.methode}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-sm text-ink">{l.nom}</span>
            <span className="text-xs tabular-nums text-ink-faint">
              <span className="text-ink-muted">{accord(l.reussies, 'réussie')}</span>
              {l.echouees > 0 && <> · {accord(l.echouees, 'échouée')}</>}
              {l.tauxReussite !== null && <> · {pourcent(l.tauxReussite)}</>}
              {l.encaisse > 0 && <> · {formatPrice(Math.round(l.encaisse), devise)}</>}
            </span>
          </div>

          <div
            className="flex h-2.5 gap-[2px]"
            style={{ width: `${(l.tranchees / max) * 100}%` }}
            title={`${l.nom} : ${accord(l.reussies, 'réussie')}, ${accord(l.echouees, 'échouée')}`}
          >
            {l.reussies > 0 && (
              <span
                className="rounded-l-[4px] last:rounded-r-[4px]"
                style={{
                  width: `${(l.reussies / l.tranchees) * 100}%`,
                  backgroundColor: 'var(--serie-1)',
                }}
              />
            )}
            {l.echouees > 0 && (
              <span
                className="rounded-r-[4px] first:rounded-l-[4px]"
                style={{
                  width: `${(l.echouees / l.tranchees) * 100}%`,
                  backgroundColor: 'var(--serie-2)',
                }}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

// ============================================================
// Pays
// ============================================================

/** Une seule série : pas de légende, le titre suffit. Classé par montant. */
function BarresPays({ lignes, devise }: { lignes: LignePays[]; devise: string }) {
  const max = Math.max(...lignes.map((l) => l.encaisse), 1)

  return (
    <ul className="space-y-3">
      {lignes.map((l) => (
        <li key={l.pays}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-sm text-ink">{l.nom}</span>
            <span className="text-xs tabular-nums text-ink-faint">
              <span className="text-ink-muted">
                {formatPrice(Math.round(l.encaisse), devise)}
              </span>{' '}
              · {l.ventes} {l.ventes > 1 ? 'ventes' : 'vente'}
              {l.tauxReussite !== null && <> · {pourcent(l.tauxReussite)} aboutis</>}
            </span>
          </div>

          <div className="h-2.5 w-full">
            <div
              className="h-full rounded-[4px]"
              style={{
                width: `${Math.max((l.encaisse / max) * 100, l.encaisse > 0 ? 1 : 0)}%`,
                backgroundColor: 'var(--serie-1)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ============================================================
// Formatage
// ============================================================

const pourcent = (v: number) => `${Math.round(v * 100)} %`

/** « 1 réussie », « 3 réussies » — le pluriel se voit tout de suite quand il manque. */
const accord = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

/** « 22 août » — assez pour se repérer, assez court pour tenir sous une colonne. */
const jourCourt = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

const jourLong = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })
