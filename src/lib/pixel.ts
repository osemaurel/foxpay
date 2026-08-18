/**
 * Pixel Meta (Facebook).
 *
 * Il ne se charge que si la boutique en a configuré un : sans identifiant,
 * aucun script tiers n'est ajouté à la page et rien n'est envoyé à Meta.
 *
 * Ce qui part chez Meta se limite aux événements standards du commerce —
 * produit consulté, paiement commencé, achat — avec un montant et une devise.
 * Jamais l'email, le nom ni le numéro de l'acheteur : ces données lui
 * appartiennent, et le suivi publicitaire n'en a pas besoin pour fonctionner.
 */

type Fbq = {
  (...args: unknown[]): void
  callMethod?: (...args: unknown[]) => void
  queue: unknown[][]
  loaded?: boolean
  version?: string
}

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
  }
}

/** Un pixel Meta n'est qu'une suite de chiffres. Le reste est refusé. */
const VALIDE = /^[0-9]{8,20}$/

let actif: string | null = null

/**
 * Charge le pixel une seule fois. Rappeler la fonction avec le même
 * identifiant ne fait rien, ce qui permet de l'appeler à chaque rendu.
 */
export function initPixel(id: string | null | undefined): boolean {
  if (!id || !VALIDE.test(id)) return false
  if (actif === id) return true
  // Un second identifiant sur la même page n'arrive pas : une seule boutique
  // est affichée à la fois.
  if (actif) return true

  actif = id

  // L'amorce officielle de Meta, réécrite lisiblement : elle met en file les
  // appels le temps que le script arrive, pour ne perdre aucun événement.
  const fbq = function (...args: unknown[]) {
    fbq.callMethod ? fbq.callMethod(...args) : fbq.queue.push(args)
  } as Fbq
  fbq.queue = []
  fbq.loaded = true
  fbq.version = '2.0'

  window.fbq = window.fbq ?? fbq
  window._fbq = window._fbq ?? window.fbq

  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  document.head.appendChild(script)

  window.fbq('init', id)
  return true
}

export function track(event: string, params?: Record<string, unknown>, eventId?: string) {
  if (!actif) return
  // `eventID` permet à Meta de reconnaître un même achat s'il lui parvient
  // aussi par un autre chemin, et de ne pas le compter deux fois.
  window.fbq?.('track', event, params ?? {}, eventId ? { eventID: eventId } : undefined)
}

/**
 * Un achat ne doit être compté qu'une fois. La page de paiement peut être
 * rechargée, ou rouverte depuis son lien avec la commande déjà payée : sans
 * cette mémoire, chaque passage gonflerait les statistiques de la publicité.
 */
export function trackPurchaseOnce(
  orderId: string,
  params: Record<string, unknown>,
): void {
  if (!actif) return

  const cle = `fbq-achat-${orderId}`
  try {
    if (sessionStorage.getItem(cle)) return
    sessionStorage.setItem(cle, '1')
  } catch {
    // Navigation privée ou stockage refusé : on préfère un doublon possible
    // à un achat non compté.
  }

  track('Purchase', params, orderId)
}
