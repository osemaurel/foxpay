/** Le XOF n'a pas de décimales : on formate des entiers. */
export function formatPrice(amount: number, currency = 'XOF'): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Montant déjà arrondi par le serveur pour un opérateur donné. On respecte le
 * nombre de décimales tel qu'il a été calculé : « 12.5 USD » doit rester
 * 12,50 $, et 15 000 XOF ne doit pas gagner de décimales au passage.
 */
export function formatCharged(amount: string, currency: string): string {
  const decimals = amount.includes('.') ? Math.max(2, amount.split('.')[1].length) : 0
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
