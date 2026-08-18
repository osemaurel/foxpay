import { admin } from './admin.ts'
import { getActiveConf, type CountryConf } from './pawapay.ts'
import { listCountries, listOperators, type SebPayCountry, type SebPayOperator } from './sebpay.ts'

/**
 * Le catalogue unifié des méthodes de paiement.
 *
 * pawaPay et SebPay décrivent le même monde avec deux vocabulaires : pays en
 * alpha-3 contre alpha-2, opérateur en `MTN_MOMO_CIV` contre `mtn`. Ce module
 * les ramène à une seule liste, où chaque méthode sait lequel des deux — ou les
 * deux — peut la traiter.
 *
 * C'est cette liste que voit l'administration pour router, et la page de
 * paiement pour proposer.
 */

// ============================================================
// Vocabulaire commun
// ============================================================

const ALPHA2_VERS_ALPHA3: Record<string, string> = {
  BJ: 'BEN', BF: 'BFA', CD: 'COD', CG: 'COG', CI: 'CIV', CM: 'CMR',
  GH: 'GHA', GM: 'GMB', GN: 'GIN', GW: 'GNB', KE: 'KEN', ML: 'MLI',
  NE: 'NER', NG: 'NGA', SN: 'SEN', TG: 'TGO', TZ: 'TZA', UG: 'UGA',
}

/** Noms français, quand aucun processeur n'en fournit un présentable. */
const NOMS_PAYS: Record<string, string> = {
  BEN: 'Bénin', BFA: 'Burkina Faso', CIV: "Côte d'Ivoire", CMR: 'Cameroun',
  COD: 'République démocratique du Congo', COG: 'Congo', GAB: 'Gabon',
  GHA: 'Ghana', GIN: 'Guinée', GMB: 'Gambie', GNB: 'Guinée-Bissau',
  KEN: 'Kenya', MLI: 'Mali', NER: 'Niger', NGA: 'Nigéria', SEN: 'Sénégal',
  TGO: 'Togo', TZA: 'Tanzanie', UGA: 'Ouganda',
}

/**
 * Ramène l'identifiant d'un opérateur à un slug commun aux deux processeurs.
 *
 * pawaPay suffixe ses codes par le pays (`MTN_MOMO_CIV`) et SebPay non
 * (`mtn`) ; sans cette normalisation, le même opérateur apparaîtrait deux fois
 * dans la liste et ne serait jamais routable.
 */
export function methodeCanonique(code: string): string {
  const sansPays = code.replace(/_[A-Z]{3}$/, '')
  const nu = sansPays.toLowerCase().replace(/[\s_-]+/g, '')

  // Les noms composés se ramènent à la marque : c'est elle que l'acheteur
  // reconnaît, et c'est elle qui identifie le portefeuille.
  //
  // `mpesa` en fait partie : en RDC, M-Pesa est le porte-monnaie de Vodacom.
  // pawaPay le nomme VODACOM_MPESA_COD, SebPay le liste deux fois — « mpesa »
  // et « vodacom ». Sans cette ligne, l'acheteur congolais verrait deux entrées
  // pour un seul compte.
  const marques: Record<string, string> = {
    mtnmomo: 'mtn', vodacom: 'vodacom', vodacommpesa: 'vodacom', mpesa: 'vodacom',
    ezypesa: 'ezypesa', halopesa: 'halopesa', tigopesa: 'tigopesa',
  }
  return marques[nu] ?? nu
}

// ============================================================
// Forme unifiée
// ============================================================

export type OptionPawapay = {
  provider: string
  authType: 'PROVIDER_AUTH' | 'PREAUTH' | 'REDIRECT_AUTH'
  pinPrompt: 'AUTOMATIC' | 'MANUAL' | null
  pinPromptRevivable: boolean
  instructions: unknown
  merchantName: string | null
  minAmount: number | null
  maxAmount: number | null
  decimals: 'NONE' | 'TWO_PLACES'
  /** OPERATIONAL, DELAYED ou CLOSED : un opérateur coupé ne doit rien encaisser. */
  status: 'OPERATIONAL' | 'DELAYED' | 'CLOSED'
}

export type OptionSebpay = {
  /** Le `code`, seul identifiant accepté par POST /collections. */
  code: string
  /** SebPay parle en alpha-2 ; on le garde tel quel pour le lui renvoyer. */
  alpha2: string
  otpRequired: boolean
  ussdCode: string | null
}

export type Methode = {
  /** ISO alpha-3, comme partout ailleurs. */
  country: string
  countryName: string
  /** Indicatif, sans le « + ». */
  prefix: string
  flag: string | null
  currency: string
  /** Slug canonique : mtn, orange, wave… */
  method: string
  name: string
  logo: string | null
  pawapay: OptionPawapay | null
  sebpay: OptionSebpay | null
}

export type Processeur = 'pawapay' | 'sebpay'

/**
 * Le processeur qui traite une méthode, à défaut de choix du vendeur.
 *
 * pawaPay garde la main quand les deux la proposent : c'est lui qui encaisse
 * aujourd'hui, et une intégration ne doit pas changer de main toute seule.
 */
export function processeurParDefaut(m: Methode): Processeur | null {
  if (m.pawapay) return 'pawapay'
  if (m.sebpay) return 'sebpay'
  return null
}

// ============================================================
// Catalogue SebPay, mis en cache
// ============================================================

type CatalogueSebpay = { pays: SebPayCountry[]; operateurs: SebPayOperator[] }

/**
 * Les appels vers SebPay sortent par un relais facturé à la requête. Ce
 * catalogue bouge une fois par mois : le relire à chaque visite serait le
 * meilleur moyen d'épuiser le quota sans rien apprendre.
 */
const FRAICHEUR_MS = 12 * 60 * 60 * 1000

async function catalogueSebpay(): Promise<CatalogueSebpay | null> {
  const { data: cache } = await admin
    .from('processor_catalogue')
    .select('payload, fetched_at')
    .eq('processor', 'sebpay')
    .maybeSingle()

  const frais = cache && Date.now() - new Date(cache.fetched_at).getTime() < FRAICHEUR_MS
  if (frais) return cache.payload as CatalogueSebpay

  try {
    const [pays, operateurs] = await Promise.all([listCountries(), listOperators()])
    const payload: CatalogueSebpay = { pays, operateurs }

    await admin
      .from('processor_catalogue')
      .upsert({ processor: 'sebpay', payload, fetched_at: new Date().toISOString() })

    return payload
  } catch (e) {
    console.error('catalogue sebpay', e)
    // Un catalogue périmé vaut mieux qu'une boutique qui n'encaisse plus :
    // les opérateurs ne disparaissent pas du jour au lendemain.
    return (cache?.payload as CatalogueSebpay) ?? null
  }
}

// ============================================================
// Fusion
// ============================================================

function ajouterPawapay(index: Map<string, Methode>, conf: CountryConf[]) {
  for (const pays of conf) {
    for (const p of pays.providers) {
      const method = methodeCanonique(p.provider)
      const cle = `${pays.country}:${method}`

      const existante = index.get(cle)
      const methode: Methode = existante ?? {
        country: pays.country,
        countryName: NOMS_PAYS[pays.country] ?? pays.name,
        prefix: pays.prefix.replace(/^\+/, ''),
        flag: pays.flag,
        currency: p.currency,
        method,
        name: p.displayName,
        logo: p.logo,
        pawapay: null,
        sebpay: null,
      }

      // Un opérateur peut exposer plusieurs devises ; on garde la première
      // configuration rencontrée, les suivantes ne changent rien au routage.
      methode.pawapay ??= {
        provider: p.provider,
        authType: p.deposit.authType,
        pinPrompt: p.deposit.pinPrompt,
        pinPromptRevivable: p.deposit.pinPromptRevivable,
        instructions: p.deposit.instructions,
        merchantName: p.nameDisplayedToCustomer || null,
        minAmount: p.deposit.minAmount,
        maxAmount: p.deposit.maxAmount,
        decimals: p.deposit.decimalsInAmount,
        status: p.deposit.status,
      }

      index.set(cle, methode)
    }
  }
}

function ajouterSebpay(index: Map<string, Methode>, catalogue: CatalogueSebpay) {
  const parAlpha2 = new Map(catalogue.pays.map((p) => [p.country_code, p]))

  for (const o of catalogue.operateurs) {
    const alpha2 = (o.country as { country_code?: string })?.country_code
    if (!alpha2) continue

    const pays = parAlpha2.get(alpha2)
    const country = ALPHA2_VERS_ALPHA3[alpha2]
    if (!pays || !country) continue

    const devise = (pays.currency as { code?: string })?.code
    if (!devise) continue

    const method = methodeCanonique(o.code)
    const cle = `${country}:${method}`

    const methode: Methode = index.get(cle) ?? {
      country,
      countryName: NOMS_PAYS[country] ?? pays.country_name,
      prefix: String(pays.prefix).replace(/^\+/, ''),
      flag: null,
      currency: devise,
      method,
      name: o.name,
      logo: null,
      pawapay: null,
      sebpay: null,
    }

    // Quand deux codes SebPay se ramènent à la même méthode (« mpesa » et
    // « vodacom »), on garde celui qui porte le nom de la marque : c'est le
    // moins susceptible d'être un alias hérité.
    const exact = o.code.toLowerCase() === method
    if (!methode.sebpay || (exact && methode.sebpay.code.toLowerCase() !== method)) {
      methode.sebpay = {
        code: o.code,
        alpha2,
        otpRequired: Boolean(o.otp_required),
        ussdCode: o.ussd_code ?? null,
      }
    }

    index.set(cle, methode)
  }
}

/**
 * Toutes les méthodes connues des deux processeurs, fusionnées.
 *
 * L'échec d'un processeur ne fait pas tomber l'autre : mieux vaut une boutique
 * qui encaisse à moitié qu'une boutique qui n'encaisse plus.
 */
export async function catalogueUnifie(): Promise<Methode[]> {
  const [conf, seb] = await Promise.all([
    getActiveConf().catch((e) => {
      console.error('catalogue pawapay', e)
      return [] as CountryConf[]
    }),
    catalogueSebpay(),
  ])

  const index = new Map<string, Methode>()
  ajouterPawapay(index, conf)
  if (seb) ajouterSebpay(index, seb)

  return [...index.values()].sort(
    (a, b) => a.countryName.localeCompare(b.countryName, 'fr') || a.name.localeCompare(b.name, 'fr'),
  )
}

/**
 * Le routage choisi par le vendeur, méthode par méthode.
 * Renvoie une fonction de résolution qui applique le défaut quand rien n'a été
 * choisi — pawaPay d'abord.
 */
export async function resolveurDeRoutage(shopId: string) {
  const { data } = await admin
    .from('payment_routes')
    .select('country, method, processor')
    .eq('shop_id', shopId)

  const choix = new Map((data ?? []).map((r) => [`${r.country}:${r.method}`, r.processor as Processeur]))

  return (m: Methode): Processeur | null => {
    const voulu = choix.get(`${m.country}:${m.method}`)
    // Un choix qui ne correspond plus à rien — opérateur retiré du compte —
    // ne doit pas rendre la méthode impayable : on retombe sur le défaut.
    if (voulu === 'pawapay' && m.pawapay) return 'pawapay'
    if (voulu === 'sebpay' && m.sebpay) return 'sebpay'
    return processeurParDefaut(m)
  }
}
