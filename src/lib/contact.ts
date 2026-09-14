/**
 * Le service après-vente, du côté du site.
 *
 * Un acheteur bloqué a besoin d'une personne, pas d'un formulaire. Sans ce
 * lien, son seul recours est d'ouvrir un litige chez son opérateur de
 * paiement — ce qui coûte infiniment plus cher qu'un message WhatsApp.
 *
 * Le même numéro existe côté serveur dans `supabase/functions/_shared/contact.ts`,
 * pour les emails. Deux copies parce que le navigateur et les Edge Functions ne
 * partagent pas de code ; si tu changes l'une, change l'autre.
 */
const NUMERO = '+1 (825) 897-7760'

/**
 * Le lien wa.me, avec un message déjà écrit quand on sait de quoi il s'agit.
 *
 * wa.me n'accepte que des chiffres : ni « + », ni espaces, ni parenthèses.
 */
export function lienWhatsapp(message?: string): string {
  const chiffres = NUMERO.replace(/\D/g, '')
  const suffixe = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${chiffres}${suffixe}`
}
