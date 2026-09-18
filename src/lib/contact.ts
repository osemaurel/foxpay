/**
 * Le service après-vente, du côté du site.
 *
 * Un acheteur bloqué a besoin d'une personne, pas d'un formulaire. Sans ce
 * lien, son seul recours est d'ouvrir un litige chez son opérateur de
 * paiement — ce qui coûte infiniment plus cher qu'un message WhatsApp.
 *
 * Le numéro appartient à la boutique et arrive en paramètre : chaque vendeur a
 * le sien, et l'acheteur de l'un ne doit jamais écrire à l'autre. Le même
 * calcul existe côté serveur dans `supabase/functions/_shared/contact.ts`, pour
 * les emails — deux copies parce que le navigateur et les Edge Functions ne
 * partagent pas de code.
 */
export function lienWhatsapp(numero: string | null, message?: string): string | null {
  // wa.me n'accepte que des chiffres : ni « + », ni espaces, ni parenthèses.
  // Un numéro absent ou mal formé ouvrirait une conversation avec personne ;
  // on préfère alors ne pas afficher le bouton du tout.
  const chiffres = (numero ?? '').replace(/\D/g, '')
  if (chiffres.length < 8) return null

  const suffixe = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${chiffres}${suffixe}`
}
