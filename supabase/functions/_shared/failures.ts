/**
 * Traduction des codes d'échec pawaPay en messages destinés à l'acheteur.
 *
 * La documentation est explicite : les `failureMessage` de l'API sont écrits
 * pour les équipes techniques, pas pour les clients. Ils sont en anglais et
 * citent des noms d'opérateurs internes. On garde donc le message d'origine
 * dans la commande, pour le vendeur, et on montre celui-ci à l'acheteur.
 *
 * Chaque message dit ce qui s'est passé et ce qu'il y a à faire — un échec de
 * paiement mobile money est presque toujours rattrapable.
 */
const MESSAGES: Record<string, string> = {
  // Échecs de transaction : ce sont les seuls qu'un acheteur verra souvent.
  PAYMENT_NOT_APPROVED:
    "Le paiement n'a pas été validé à temps. Relance-le et compose ton code PIN dès que l'invite s'affiche.",
  INSUFFICIENT_BALANCE:
    'Ton solde mobile money est insuffisant. Recharge ton compte, puis réessaie.',
  PAYMENT_IN_PROGRESS:
    'Une autre transaction est encore en cours sur ton compte. Attends une dizaine de minutes avant de réessayer.',
  PAYER_NOT_FOUND:
    "Ce numéro n'est pas rattaché à cet opérateur. Vérifie le numéro, ou choisis l'opérateur correspondant.",
  WALLET_LIMIT_REACHED:
    'Ton portefeuille mobile money a atteint sa limite. Ton opérateur peut la relever, ou tu peux payer depuis un autre numéro.',
  UNSPECIFIED_FAILURE:
    "L'opérateur a refusé le paiement sans en donner la raison. Tu peux réessayer.",

  // Rejets à l'initiation : la plupart sont évités en amont, mais un opérateur
  // peut tomber entre le moment où on affiche la liste et celui où on paie.
  PROVIDER_TEMPORARILY_UNAVAILABLE:
    'Cet opérateur est momentanément indisponible. Essaie avec un autre, ou reviens un peu plus tard.',
  INVALID_PHONE_NUMBER: 'Ce numéro est invalide pour cet opérateur. Vérifie-le.',
  AMOUNT_OUT_OF_BOUNDS:
    "Le montant dépasse les limites de transaction de cet opérateur. Essaie avec un autre opérateur.",
  INVALID_CURRENCY: "Cet opérateur n'accepte pas la devise de ce paiement.",
  DEPOSITS_NOT_ALLOWED: "Cet opérateur n'est pas activé sur cette boutique.",
}

const DEFAUT = "Le paiement n'a pas abouti. Tu peux réessayer."

export function describeFailure(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || DEFAUT
}
