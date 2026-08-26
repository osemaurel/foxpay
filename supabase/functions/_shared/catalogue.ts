import { admin } from './admin.ts'
import type { Langue } from './langue.ts'
import { getActiveConf, type CountryConf } from './pawapay.ts'
import { listCountries, listOperators, type SebPayCountry, type SebPayOperator } from './sebpay.ts'
import {
  listCountries as listSasCountries,
  listNetworks as listSasNetworks,
  type SasPayCountry,
  type SasPayNetwork,
} from './saspay.ts'

/**
 * Le catalogue unifié des méthodes de paiement.
 *
 * Les trois processeurs décrivent le même monde avec trois vocabulaires : pays
 * en alpha-3 contre alpha-2, opérateur en `MTN_MOMO_CIV`, `mtn` ou `mtn_ci`.
 * Ce module les ramène à une seule liste, où chaque méthode sait lequel des
 * trois — ou lesquels — peut la traiter.
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
  MW: 'MWI', RW: 'RWA', ZM: 'ZMB',
}

/**
 * Indicatifs téléphoniques, sans le « + ».
 *
 * pawaPay et SebPay les fournissent, SasPay non. Sans cette table, un pays
 * servi par lui seul — le Togo, le Mali, le Niger — s'afficherait sur la page
 * de paiement avec un champ téléphone sans préfixe.
 */
const INDICATIFS: Record<string, string> = {
  BEN: '229', BFA: '226', CIV: '225', CMR: '237', COD: '243', COG: '242',
  GAB: '241', GHA: '233', GIN: '224', GMB: '220', GNB: '245', KEN: '254',
  MLI: '223', MWI: '265', NER: '227', NGA: '234', RWA: '250', SEN: '221',
  TGO: '228', TZA: '255', UGA: '256', ZMB: '260',
}

/** Noms français, quand aucun processeur n'en fournit un présentable. */
export const NOMS_PAYS: Record<string, string> = {
  BEN: 'Bénin', BFA: 'Burkina Faso', CIV: "Côte d'Ivoire", CMR: 'Cameroun',
  COD: 'République démocratique du Congo', COG: 'Congo', GAB: 'Gabon',
  GHA: 'Ghana', GIN: 'Guinée', GMB: 'Gambie', GNB: 'Guinée-Bissau',
  KEN: 'Kenya', MLI: 'Mali', NER: 'Niger', NGA: 'Nigéria', SEN: 'Sénégal',
  TGO: 'Togo', TZA: 'Tanzanie', UGA: 'Ouganda',
  MWI: 'Malawi', RWA: 'Rwanda', ZMB: 'Zambie',
}

/**
 * Les mêmes en anglais. Un acheteur nigérian choisit son pays dans une liste :
 * la lui présenter en français serait le premier accroc d'un tunnel qu'on a
 * traduit partout ailleurs.
 */
const NOMS_PAYS_EN: Record<string, string> = {
  BEN: 'Benin', BFA: 'Burkina Faso', CIV: 'Ivory Coast', CMR: 'Cameroon',
  COD: 'Democratic Republic of the Congo', COG: 'Congo', GAB: 'Gabon',
  GHA: 'Ghana', GIN: 'Guinea', GMB: 'Gambia', GNB: 'Guinea-Bissau',
  KEN: 'Kenya', MLI: 'Mali', NER: 'Niger', NGA: 'Nigeria', SEN: 'Senegal',
  TGO: 'Togo', TZA: 'Tanzania', UGA: 'Uganda',
  MWI: 'Malawi', RWA: 'Rwanda', ZMB: 'Zambia',
}

/** Le nom d'un pays dans la langue de l'acheteur, à défaut celui du processeur. */
export function nomPays(code: string, langue: Langue, defaut: string): string {
  const table = langue === 'en' ? NOMS_PAYS_EN : NOMS_PAYS
  return table[code] ?? NOMS_PAYS[code] ?? defaut
}

/**
 * Ramène l'identifiant d'un opérateur à un slug commun aux trois processeurs.
 *
 * Chacun nomme le même MTN à sa façon : `MTN_MOMO_CIV` chez pawaPay, `mtn`
 * chez SebPay, `mtn_ci` chez SasPay. Sans cette normalisation, le même
 * opérateur apparaîtrait trois fois dans la liste et ne serait jamais routable.
 *
 * Le suffixe de pays est retiré dans les deux écritures rencontrées : trois
 * lettres majuscules (pawaPay) ou deux minuscules (SasPay).
 */
export function methodeCanonique(code: string): string {
  const sansPays = code.replace(/_[a-z]{2,3}$/i, '')
  const nu = sansPays.toLowerCase().replace(/[\s_-]+/g, '')

  // Les noms composés se ramènent à la marque : c'est elle que l'acheteur
  // reconnaît, et c'est elle qui identifie le portefeuille.
  //
  // `mpesa` en fait partie : en RDC, M-Pesa est le porte-monnaie de Vodacom.
  // pawaPay le nomme VODACOM_MPESA_COD, SebPay le liste deux fois — « mpesa »
  // et « vodacom ». Sans cette ligne, l'acheteur congolais verrait deux entrées
  // pour un seul compte.
  //
  // `freemoney` vient de SasPay, qui écrit en toutes lettres ce que pawaPay
  // abrège en `FREE_SEN` : le même Free Money sénégalais.
  const marques: Record<string, string> = {
    mtnmomo: 'mtn', vodacom: 'vodacom', vodacommpesa: 'vodacom', mpesa: 'vodacom',
    ezypesa: 'ezypesa', halopesa: 'halopesa', tigopesa: 'tigopesa',
    freemoney: 'free',
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

export type OptionSaspay = {
  /** Le `code` réseau, seul identifiant accepté par POST /payments/softpay/. */
  code: string
  /** SasPay parle en alpha-2 ; on le garde tel quel pour le lui renvoyer. */
  alpha2: string
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
  saspay: OptionSaspay | null
}

export type Processeur = 'pawapay' | 'sebpay' | 'saspay'

/**
 * Le processeur qui traite une méthode, à défaut de choix du vendeur.
 *
 * pawaPay garde la main quand plusieurs la proposent : c'est lui qui encaisse
 * aujourd'hui, et une intégration ne doit pas changer de main toute seule.
 * SasPay ferme la marche — il vient d'arriver, et c'est au vendeur de lui
 * confier une méthode depuis l'administration, pas à ce fichier.
 */
export function processeurParDefaut(m: Methode): Processeur | null {
  if (m.pawapay) return 'pawapay'
  if (m.sebpay) return 'sebpay'
  if (m.saspay) return 'saspay'
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
// Catalogue SasPay, mis en cache
// ============================================================

type CatalogueSaspay = { pays: SasPayCountry[]; reseaux: SasPayNetwork[] }

/**
 * Même mise en cache que SebPay, pour une autre raison : SasPay ne facture pas
 * ses appels, mais il limite à 300 requêtes par minute et sa documentation
 * demande explicitement de garder en cache les réponses peu volatiles. Deux
 * appels par visite de la page de paiement épuiseraient ce budget un jour de
 * forte affluence, sans rien apprendre de nouveau.
 */
async function catalogueSaspay(): Promise<CatalogueSaspay | null> {
  const { data: cache } = await admin
    .from('processor_catalogue')
    .select('payload, fetched_at')
    .eq('processor', 'saspay')
    .maybeSingle()

  const frais = cache && Date.now() - new Date(cache.fetched_at).getTime() < FRAICHEUR_MS
  if (frais) return cache.payload as CatalogueSaspay

  try {
    const [pays, reseaux] = await Promise.all([listSasCountries(), listSasNetworks()])
    const payload: CatalogueSaspay = { pays, reseaux }

    await admin
      .from('processor_catalogue')
      .upsert({ processor: 'saspay', payload, fetched_at: new Date().toISOString() })

    return payload
  } catch (e) {
    console.error('catalogue saspay', e)
    return (cache?.payload as CatalogueSaspay) ?? null
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
        saspay: null,
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
      saspay: null,
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

function ajouterSaspay(index: Map<string, Methode>, catalogue: CatalogueSaspay) {
  // Le réseau ne porte que l'identifiant de son pays : la jointure est à faire
  // ici, le référentiel ne l'imbrique pas.
  const parId = new Map(catalogue.pays.map((p) => [p.id, p]))

  for (const r of catalogue.reseaux) {
    // Un réseau au catalogue mais routé vers aucun gateway ferait échouer le
    // paiement au dernier moment, avec un « invalid_method ».
    if (!r.is_active) continue

    // Le référentiel liste aussi des pays réservés à un usage futur, sans
    // aucun réseau actif — l'Autriche y figure.
    const pays = parId.get(r.country)
    if (!pays || !pays.is_active || !pays.default_currency) continue

    const country = ALPHA2_VERS_ALPHA3[pays.iso_code]
    if (!country) continue

    const method = methodeCanonique(r.code)
    const cle = `${country}:${method}`

    const methode: Methode = index.get(cle) ?? {
      country,
      countryName: NOMS_PAYS[country] ?? pays.name,
      // SasPay ne publie pas d'indicatif : il vient de notre table, sans quoi
      // la page de paiement afficherait un champ téléphone sans préfixe.
      prefix: INDICATIFS[country] ?? '',
      flag: null,
      currency: pays.default_currency,
      method,
      name: r.name,
      logo: null,
      pawapay: null,
      sebpay: null,
      saspay: null,
    }

    methode.saspay ??= { code: r.code, alpha2: pays.iso_code }
    index.set(cle, methode)
  }
}

/**
 * Toutes les méthodes connues des trois processeurs, fusionnées.
 *
 * L'échec d'un processeur ne fait pas tomber l'autre : mieux vaut une boutique
 * qui encaisse à moitié qu'une boutique qui n'encaisse plus.
 */
export async function catalogueUnifie(): Promise<Methode[]> {
  const [conf, seb, sas] = await Promise.all([
    getActiveConf().catch((e) => {
      console.error('catalogue pawapay', e)
      return [] as CountryConf[]
    }),
    catalogueSebpay(),
    catalogueSaspay(),
  ])

  const index = new Map<string, Methode>()
  ajouterPawapay(index, conf)
  if (seb) ajouterSebpay(index, seb)
  if (sas) ajouterSaspay(index, sas)

  return [...index.values()].sort(
    (a, b) => a.countryName.localeCompare(b.countryName, 'fr') || a.name.localeCompare(b.name, 'fr'),
  )
}

/** Une ligne de payment_routes, réduite à ce qui sert à décider. */
type LigneReglage = { processor: string | null; enabled: boolean }

export type Verdict = {
  /** Le processeur qui encaissera, ou null si aucun ne le peut. */
  processeur: Processeur | null
  /** Faux quand le vendeur a retiré cette méthode de sa boutique. */
  active: boolean
}

/**
 * Les réglages du vendeur, méthode par méthode : proposée ou non, et par quel
 * processeur.
 *
 * Une méthode sans ligne enregistrée est proposée, chez le processeur par
 * défaut — une boutique neuve encaisse partout sans rien régler.
 */
export async function resolveurDeMethodes(shopId: string) {
  const { data } = await admin
    .from('payment_routes')
    .select('country, method, processor, enabled')
    .eq('shop_id', shopId)

  const reglages = new Map<string, LigneReglage>(
    (data ?? []).map((r) => [
      `${r.country}:${r.method}`,
      { processor: r.processor, enabled: r.enabled },
    ]),
  )

  return (m: Methode): Verdict => {
    const reglage = reglages.get(`${m.country}:${m.method}`)
    const voulu = reglage?.processor as Processeur | null | undefined

    // Un choix qui ne correspond plus à rien — opérateur retiré du compte —
    // ne doit pas rendre la méthode impayable : on retombe sur le défaut.
    const processeur =
      voulu === 'pawapay' && m.pawapay
        ? 'pawapay'
        : voulu === 'sebpay' && m.sebpay
          ? 'sebpay'
          : voulu === 'saspay' && m.saspay
            ? 'saspay'
            : processeurParDefaut(m)

    return { processeur, active: reglage?.enabled ?? true }
  }
}
