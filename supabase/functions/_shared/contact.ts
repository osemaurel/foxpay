/**
 * Le numéro WhatsApp du service après-vente.
 *
 * Il figure dans la demande d'avis et sur la page où l'avis se dépose : ce sont
 * les deux moments où quelqu'un dont le fichier ne s'ouvre pas cherche une
 * personne à qui parler. Un formulaire ne répond pas ; WhatsApp, si.
 *
 * Défini ici et nulle part ailleurs — l'email et la page le lisent tous les
 * deux au même endroit, pour qu'un changement de numéro n'en laisse jamais un
 * périmé quelque part. Le secret `WHATSAPP_NUMERO` permet d'en changer sans
 * redéployer.
 */
const DEFAUT = '+1 (825) 897-7760'

/**
 * Le lien wa.me correspondant, ou null si le numéro a été vidé.
 *
 * wa.me n'accepte que des chiffres : ni « + », ni espaces, ni parenthèses.
 * Un numéro mal formé ouvrirait une conversation avec personne, on préfère
 * alors ne pas afficher le bouton du tout.
 */
export function lienWhatsapp(message?: string): string | null {
  const chiffres = (Deno.env.get('WHATSAPP_NUMERO') ?? DEFAUT).replace(/\D/g, '')
  if (chiffres.length < 8) return null

  const suffixe = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${chiffres}${suffixe}`
}
