/**
 * Le sigle affiché à la place du code ISO. « FCFA » est ce que les gens lisent
 * sur leurs billets et dans leurs SMS mobile money ; « XOF » ne parle qu'aux
 * banques. Les deux francs CFA s'écrivent pareil, leur valeur étant la même.
 */
const SIGLES: Record<string, string> = {
  XOF: 'FCFA',
  XAF: 'FCFA',
  CDF: 'CDF',
}

/** Espace insécable : le montant et son sigle ne doivent pas se séparer. */
function avecSigle(value: number, sigle: string, decimals: number): string {
  const nombre = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
  return `${nombre}\u00a0${sigle}`
}

/** Le franc CFA n'a pas de décimales : on formate des entiers. */
export function formatPrice(amount: number, currency = 'XOF'): string {
  const sigle = SIGLES[currency]
  if (sigle) return avecSigle(amount, sigle, 0)

  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Montant déjà arrondi par le serveur pour un opérateur donné. On respecte le
 * nombre de décimales tel qu'il a été calculé : 15 000 FCFA ne doit pas gagner
 * de décimales au passage, et une devise qui en a garde les siennes.
 */
export function formatCharged(amount: string, currency: string): string {
  const decimals = amount.includes('.') ? Math.max(2, amount.split('.')[1].length) : 0
  const sigle = SIGLES[currency]
  if (sigle) return avecSigle(Number(amount), sigle, decimals)

  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(amount))
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} Mo` : `${Math.round(bytes / 1024)} Ko`
}
