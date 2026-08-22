import type { Order } from './types'

/**
 * Les calculs derrière la section analytique de l'accueil.
 *
 * Tout est fait dans le navigateur à partir des commandes déjà chargées : le
 * vendeur en a quelques centaines, pas quelques millions, et une vue SQL
 * dédiée coûterait une migration et un aller-retour de plus pour un gain nul.
 * Le jour où le volume l'exigera, ces fonctions restent le contrat à
 * reproduire côté base.
 *
 * Deux règles tiennent tout le fichier :
 *
 *   - **Une vente est datée du jour où l'argent est arrivé** (`paid_at`), pas
 *     du jour où l'acheteur a ouvert la page. Une commande confirmée le
 *     lendemain compte pour le lendemain, sinon les journées ne totalisent pas
 *     ce que le vendeur a réellement encaissé ce jour-là.
 *   - **Les taux de réussite ignorent les commandes en attente.** Elles ne sont
 *     ni réussies ni échouées : les compter en échec ferait passer une méthode
 *     pour mauvaise alors qu'on ne sait simplement pas encore.
 */

/** Ce qu'on additionne : `amount` est le prix de référence, comparable partout. */
export type Agregat = {
  /** Commandes payées. */
  ventes: number
  /** Somme des prix de référence, dans la devise de la boutique. */
  encaisse: number
}

export type Jour = Agregat & {
  /** Date ISO courte, `2026-08-22`. */
  jour: string
}

export type LigneMethode = {
  /** Slug canonique : mtn, orange, wave… */
  methode: string
  nom: string
  reussies: number
  echouees: number
  /** Réussies + échouées. Les commandes en attente n'y sont pas. */
  tranchees: number
  /** Entre 0 et 1, ou null quand rien n'a encore été tranché. */
  tauxReussite: number | null
  encaisse: number
}

export type LignePays = {
  pays: string
  nom: string
  ventes: number
  encaisse: number
  tauxReussite: number | null
}

// ============================================================
// Vocabulaire
// ============================================================

/**
 * Ramène l'identifiant d'opérateur à un slug commun.
 *
 * Le même MTN arrive écrit `MTN_MOMO_CIV` par pawaPay et `mtn` par SebPay :
 * sans cette normalisation, le classement des méthodes montrerait deux lignes
 * pour un seul opérateur. C'est la copie navigateur de `methodeCanonique` des
 * Edge Functions — les deux doivent bouger ensemble.
 */
export function methodeCanonique(code: string): string {
  const nu = code
    .replace(/_[A-Z]{3}$/, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')

  const marques: Record<string, string> = {
    mtnmomo: 'mtn',
    vodacom: 'vodacom',
    vodacommpesa: 'vodacom',
    mpesa: 'vodacom',
    ezypesa: 'ezypesa',
    halopesa: 'halopesa',
    tigopesa: 'tigopesa',
  }
  return marques[nu] ?? nu
}

/** Noms d'opérateurs tels que l'acheteur les reconnaît. */
const NOMS_METHODES: Record<string, string> = {
  mtn: 'MTN MoMo',
  orange: 'Orange Money',
  moov: 'Moov Money',
  wave: 'Wave',
  free: 'Free Money',
  airtel: 'Airtel Money',
  vodacom: 'Vodacom M-Pesa',
  celtiis: 'Celtiis Cash',
  coris: 'Coris Money',
  telecel: 'Telecel Cash',
  afrimoney: 'Afrimoney',
  tmoney: 'T-Money',
  nita: 'Nita',
  amanata: 'Amanata',
  zamani: 'Zamani',
  wligdicash: 'Ligdicash',
}

export const nomMethode = (slug: string) =>
  NOMS_METHODES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1)

/** ISO alpha-3 → nom français. Reprend la table des Edge Functions. */
const NOMS_PAYS: Record<string, string> = {
  BEN: 'Bénin',
  BFA: 'Burkina Faso',
  CIV: "Côte d'Ivoire",
  CMR: 'Cameroun',
  COD: 'RD Congo',
  COG: 'Congo',
  GAB: 'Gabon',
  GHA: 'Ghana',
  GIN: 'Guinée',
  GMB: 'Gambie',
  GNB: 'Guinée-Bissau',
  KEN: 'Kenya',
  MLI: 'Mali',
  NER: 'Niger',
  NGA: 'Nigéria',
  SEN: 'Sénégal',
  TGO: 'Togo',
  TZA: 'Tanzanie',
  UGA: 'Ouganda',
}

export const nomPays = (code: string) => NOMS_PAYS[code] ?? code

// ============================================================
// Découpage
// ============================================================

/** Le jour d'une commande, au sens commercial : celui de l'encaissement. */
function jourDe(order: Order): string {
  return (order.paid_at ?? order.created_at).slice(0, 10)
}

/**
 * Ne garde que les commandes de la fenêtre choisie, bornée au jour.
 *
 * `jours = null` veut dire « depuis le début » : la boutique est jeune, et
 * l'historique complet tient largement à l'écran.
 */
export function surLaPeriode(orders: Order[], jours: number | null): Order[] {
  if (jours === null) return orders

  const debut = new Date()
  debut.setHours(0, 0, 0, 0)
  debut.setDate(debut.getDate() - (jours - 1))

  return orders.filter((o) => new Date(o.paid_at ?? o.created_at) >= debut)
}

/**
 * Une ligne par jour, **trous compris**.
 *
 * Un jour sans vente vaut zéro, il ne disparaît pas : sauter les jours creux
 * comprimerait l'axe du temps et ferait passer une semaine morte pour une
 * progression continue.
 */
export function serieQuotidienne(orders: Order[], jours: number | null): Jour[] {
  const payees = orders.filter((o) => o.status === 'paid')

  const parJour = new Map<string, Agregat>()
  for (const o of payees) {
    const cle = jourDe(o)
    const cumul = parJour.get(cle) ?? { ventes: 0, encaisse: 0 }
    cumul.ventes += 1
    cumul.encaisse += o.amount
    parJour.set(cle, cumul)
  }

  // Le premier jour affiché : le début de la fenêtre, ou la première vente
  // connue quand on regarde tout l'historique.
  const cles = [...parJour.keys()].sort()
  const fin = new Date()
  fin.setHours(0, 0, 0, 0)

  const debut = new Date(fin)
  if (jours === null) {
    if (cles.length === 0) return []
    debut.setTime(new Date(cles[0]).getTime())
  } else {
    debut.setDate(debut.getDate() - (jours - 1))
  }

  const serie: Jour[] = []
  for (const d = new Date(debut); d <= fin; d.setDate(d.getDate() + 1)) {
    const cle = d.toISOString().slice(0, 10)
    serie.push({ jour: cle, ...(parJour.get(cle) ?? { ventes: 0, encaisse: 0 }) })
  }
  return serie
}

/** Le classement des moyens de paiement : usage réel et échecs, côte à côte. */
export function parMethode(orders: Order[]): LigneMethode[] {
  const index = new Map<string, LigneMethode>()

  for (const o of orders) {
    if (o.status !== 'paid' && o.status !== 'failed') continue
    if (!o.mmo_provider) continue

    const methode = methodeCanonique(o.mmo_provider)
    const ligne =
      index.get(methode) ??
      {
        methode,
        nom: nomMethode(methode),
        reussies: 0,
        echouees: 0,
        tranchees: 0,
        tauxReussite: null,
        encaisse: 0,
      }

    if (o.status === 'paid') {
      ligne.reussies += 1
      ligne.encaisse += o.amount
    } else {
      ligne.echouees += 1
    }
    ligne.tranchees += 1
    index.set(methode, ligne)
  }

  return [...index.values()]
    .map((l) => ({ ...l, tauxReussite: l.tranchees ? l.reussies / l.tranchees : null }))
    .sort((a, b) => b.tranchees - a.tranchees)
}

/** Le classement des pays, par montant encaissé. */
export function parPays(orders: Order[]): LignePays[] {
  const index = new Map<string, LignePays & { tranchees: number }>()

  for (const o of orders) {
    if (o.status !== 'paid' && o.status !== 'failed') continue
    if (!o.country) continue

    const ligne =
      index.get(o.country) ??
      {
        pays: o.country,
        nom: nomPays(o.country),
        ventes: 0,
        encaisse: 0,
        tauxReussite: null,
        tranchees: 0,
      }

    if (o.status === 'paid') {
      ligne.ventes += 1
      ligne.encaisse += o.amount
    }
    ligne.tranchees += 1
    index.set(o.country, ligne)
  }

  return [...index.values()]
    .map(({ tranchees, ...l }) => ({
      ...l,
      tauxReussite: tranchees ? l.ventes / tranchees : null,
    }))
    .sort((a, b) => b.encaisse - a.encaisse || b.ventes - a.ventes)
}

/** Les quatre chiffres de tête, sur la période choisie. */
export function resume(orders: Order[]) {
  const payees = orders.filter((o) => o.status === 'paid')
  const echouees = orders.filter((o) => o.status === 'failed').length
  const attente = orders.filter((o) => o.status === 'pending').length
  const encaisse = payees.reduce((somme, o) => somme + o.amount, 0)
  const tranchees = payees.length + echouees

  return {
    ventes: payees.length,
    encaisse,
    attente,
    /** Panier moyen : sur les ventes seules, sinon il ne veut rien dire. */
    panierMoyen: payees.length ? encaisse / payees.length : 0,
    tauxReussite: tranchees ? payees.length / tranchees : null,
  }
}
