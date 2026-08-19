/**
 * La langue de l'acheteur, côté serveur.
 *
 * Le tunnel d'achat la détecte depuis l'appareil et l'envoie avec la commande ;
 * elle est ensuite gardée sur `orders.locale`. Tout ce qui part après le
 * paiement — email de livraison, relance, page de téléchargement, messages
 * d'échec — s'y conforme.
 *
 * L'avis de vente envoyé au vendeur, lui, reste en français : c'est sa langue,
 * pas celle de son client.
 */

export type Langue = 'fr' | 'en'

/**
 * Ce qui n'est pas explicitement de l'anglais est traité comme du français :
 * une valeur absente, inconnue ou abîmée ne doit jamais empêcher un envoi.
 */
export function lireLangue(valeur: unknown): Langue {
  return valeur === 'en' ? 'en' : 'fr'
}
