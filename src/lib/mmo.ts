/**
 * Noms lisibles des pays et des opérateurs mobile money.
 *
 * pawaPay renvoie des codes — `CIV`, `MTN_MOMO_CIV` — qui ne disent rien à un
 * vendeur qui consulte ses ventes. La page de paiement, elle, reçoit déjà les
 * libellés depuis l'API ; l'administration lit la base directement, sans passer
 * par pawaPay, d'où cette petite table.
 */

const PAYS: Record<string, string> = {
  BEN: 'Bénin',
  BFA: 'Burkina Faso',
  CIV: "Côte d'Ivoire",
  CMR: 'Cameroun',
  COD: 'République démocratique du Congo',
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

/**
 * Les codes opérateurs de pawaPay se terminent par le pays : `MTN_MOMO_CIV`.
 * Ce qui précède identifie l'opérateur, et peut lui-même contenir des
 * soulignés. Ceux de SebPay sont plus courts et en minuscules : `mtn`.
 */
const OPERATEURS: Record<string, string> = {
  MTN_MOMO: 'MTN MoMo',
  MTN: 'MTN MoMo',
  VODACOM_MPESA: 'Vodacom M-Pesa',
  VODACOM: 'Vodacom M-Pesa',
  MPESA: 'Vodacom M-Pesa',
  ORANGE: 'Orange Money',
  AIRTEL: 'Airtel Money',
  MOOV: 'Moov Money',
  FREE: 'Free Money',
  WAVE: 'Wave',
  CELTIIS: 'Celtiis Money',
  CORIS: 'Coris Money',
  TMONEY: 'T-Money',
  WLIGDICASH: 'Wallet LigdiCash',
  AFRIMONEY: 'Afri Money',
}

export function countryName(code: string | null): string | null {
  if (!code) return null
  return PAYS[code] ?? code
}

/**
 * Renvoie le nom de l'opérateur, ou une version présentable du code si pawaPay
 * en active un nouveau — mieux vaut afficher « Yas » que rien du tout.
 */
export function providerName(code: string | null): string | null {
  if (!code) return null

  const cle = code.replace(/_[A-Za-z]{3}$/, '').toUpperCase()
  if (OPERATEURS[cle]) return OPERATEURS[cle]

  return cle
    .split('_')
    .map((mot) => mot.charAt(0) + mot.slice(1).toLowerCase())
    .join(' ')
}
