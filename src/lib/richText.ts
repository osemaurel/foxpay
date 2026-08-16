import DOMPurify from 'dompurify'

/**
 * Les descriptions de produit sont désormais du HTML écrit dans l'éditeur.
 *
 * Ce HTML est rendu tel quel sur la page publique, donc il DOIT être nettoyé :
 * n'importe qui peut créer un compte, donc n'importe qui peut écrire dans ce
 * champ, et la page boutique est servie sur le même domaine que l'admin. Un
 * script injecté ici pourrait lire la session d'un vendeur connecté qui la
 * consulte. La liste blanche ci-dessous est donc volontairement courte.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'code', 'a',
]

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    // Ni javascript:, ni data: — seulement des liens qu'on assume.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
  })
}

/** Un lien sortant ne doit pas donner la main sur l'onglet d'origine. */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/**
 * Les descriptions écrites avant l'éditeur sont du texte brut. On les
 * reconnaît à l'absence de balise, et on les convertit plutôt que de forcer
 * une migration de données qui pourrait abîmer un texte existant.
 */
export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(value)
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/** Ligne vide = nouveau paragraphe, simple retour = saut de ligne. */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Normalise une valeur stockée vers du HTML sûr, quelle que soit son origine. */
export function toSafeHtml(value: string): string {
  return sanitizeHtml(looksLikeHtml(value) ? value : plainTextToHtml(value))
}

/** TipTap laisse un paragraphe vide quand on efface tout : ça ne vaut rien. */
export function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === ''
}
