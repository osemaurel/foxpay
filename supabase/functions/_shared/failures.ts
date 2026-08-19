import type { Langue } from './langue.ts'

/**
 * Traduction des codes d'échec des processeurs en messages destinés à
 * l'acheteur.
 *
 * La documentation est explicite : les `failureMessage` de l'API sont écrits
 * pour les équipes techniques, pas pour les clients. Ils sont en anglais et
 * citent des noms d'opérateurs internes. On garde donc le message d'origine
 * dans la commande, pour le vendeur, et on montre celui-ci à l'acheteur.
 *
 * Chaque message dit ce qui s'est passé et ce qu'il y a à faire — un échec de
 * paiement mobile money est presque toujours rattrapable. Les deux langues sont
 * côte à côte : c'est ce qui les empêche de diverger quand un code s'ajoute.
 */
const MESSAGES: Record<string, Record<Langue, string>> = {
  // Échecs de transaction : ce sont les seuls qu'un acheteur verra souvent.
  PAYMENT_NOT_APPROVED: {
    fr: "Le paiement n'a pas été validé à temps. Relance-le et compose ton code PIN dès que l'invite s'affiche.",
    en: "The payment wasn't approved in time. Start it again and enter your PIN as soon as the prompt appears.",
  },
  INSUFFICIENT_BALANCE: {
    fr: 'Ton solde mobile money est insuffisant. Recharge ton compte, puis réessaie.',
    en: 'Your mobile money balance is too low. Top up your account, then try again.',
  },
  PAYMENT_IN_PROGRESS: {
    fr: 'Une autre transaction est encore en cours sur ton compte. Attends une dizaine de minutes avant de réessayer.',
    en: 'Another transaction is still running on your account. Wait about ten minutes before trying again.',
  },
  PAYER_NOT_FOUND: {
    fr: "Ce numéro n'est pas rattaché à cet opérateur. Vérifie le numéro, ou choisis l'opérateur correspondant.",
    en: "This number isn't registered with that provider. Check the number, or pick the provider it belongs to.",
  },
  WALLET_LIMIT_REACHED: {
    fr: 'Ton portefeuille mobile money a atteint sa limite. Ton opérateur peut la relever, ou tu peux payer depuis un autre numéro.',
    en: 'Your mobile money wallet has hit its limit. Your provider can raise it, or you can pay from another number.',
  },
  UNSPECIFIED_FAILURE: {
    fr: "L'opérateur a refusé le paiement sans en donner la raison. Tu peux réessayer.",
    en: 'The provider declined the payment without giving a reason. You can try again.',
  },

  // Rejets à l'initiation : la plupart sont évités en amont, mais un opérateur
  // peut tomber entre le moment où on affiche la liste et celui où on paie.
  PROVIDER_TEMPORARILY_UNAVAILABLE: {
    fr: 'Cet opérateur est momentanément indisponible. Essaie avec un autre, ou reviens un peu plus tard.',
    en: 'This provider is temporarily unavailable. Try another one, or come back a little later.',
  },
  INVALID_PHONE_NUMBER: {
    fr: 'Ce numéro est invalide pour cet opérateur. Vérifie-le.',
    en: 'This number is invalid for that provider. Please check it.',
  },
  AMOUNT_OUT_OF_BOUNDS: {
    fr: "Le montant dépasse les limites de transaction de cet opérateur. Essaie avec un autre opérateur.",
    en: "The amount is outside this provider's transaction limits. Try another provider.",
  },
  INVALID_CURRENCY: {
    fr: "Cet opérateur n'accepte pas la devise de ce paiement.",
    en: "This provider doesn't accept the currency of this payment.",
  },
  DEPOSITS_NOT_ALLOWED: {
    fr: "Cet opérateur n'est pas activé sur cette boutique.",
    en: "This provider isn't enabled for this shop.",
  },

  // SebPay ne détaille pas ses refus : un seul code, et un message qui reste
  // vrai quelle qu'en soit la cause.
  PAYMENT_REJECTED: {
    fr: "L'opérateur a refusé le paiement. Vérifie ton numéro et ton solde, puis réessaie.",
    en: 'The provider declined the payment. Check your number and your balance, then try again.',
  },
  NOT_FOUND: {
    fr: "La demande de paiement n'est jamais partie. Rien n'a été débité — tu peux recommencer.",
    en: 'The payment request never went out. Nothing was charged — you can start over.',
  },
}

const DEFAUT: Record<Langue, string> = {
  fr: "Le paiement n'a pas abouti. Tu peux réessayer.",
  en: "The payment didn't go through. You can try again.",
}

export function describeFailure(code: string | null | undefined, langue: Langue = 'fr'): string {
  return (code && MESSAGES[code]?.[langue]) || DEFAUT[langue]
}
