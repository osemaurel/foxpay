/**
 * Le numéro WhatsApp du service après-vente.
 *
 * Il figure dans les emails de livraison, les rappels, la demande d'avis et sur
 * la page où l'avis se dépose : ce sont les moments où quelqu'un dont le
 * fichier ne s'ouvre pas cherche une personne à qui parler. Un formulaire ne
 * répond pas ; WhatsApp, si.
 *
 * Le numéro appartient à la boutique et arrive en paramètre. Il l'était
 * autrefois en dur, ce qui convenait tant qu'il n'y avait qu'un vendeur :
 * avec deux, l'acheteur de l'un écrirait à l'autre.
 */

/**
 * Le lien wa.me correspondant, ou null si la boutique n'a pas de numéro.
 *
 * wa.me n'accepte que des chiffres : ni « + », ni espaces, ni parenthèses.
 * Un numéro mal formé ouvrirait une conversation avec personne, on préfère
 * alors ne pas afficher le bouton du tout.
 */
export function lienWhatsapp(numero: string | null, message?: string): string | null {
  const chiffres = (numero ?? '').replace(/\D/g, '')
  if (chiffres.length < 8) return null

  const suffixe = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${chiffres}${suffixe}`
}
