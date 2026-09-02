import { admin } from '../_shared/admin.ts'
import { lienWhatsapp } from '../_shared/contact.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { lireLangue } from '../_shared/langue.ts'

/**
 * Le dépôt d'un avis par l'acheteur.
 *
 * Comme pour le suivi de paiement, ce qui autorise l'accès est l'identifiant de
 * commande : un UUID imprévisible, envoyé par courrier à une seule personne. Il
 * n'y a donc ni compte à créer ni mot de passe — quelqu'un qui vient de payer
 * n'ouvrira pas un compte pour dire ce qu'il a pensé.
 *
 * Deux actions. `etat` prépare la page : ce qui a été acheté, si l'avis est
 * déjà donné, et le numéro WhatsApp. `envoyer` dépose la note.
 *
 * Une commande n'accepte qu'un avis, et la contrainte est en base — pas ici :
 * deux onglets ouverts en même temps passeraient à travers n'importe quelle
 * vérification faite en amont de l'insertion.
 */

type Corps = {
  action?: 'etat' | 'envoyer'
  order_id?: string
  rating?: number
  body?: string
}

/** Ce qu'on accepte d'un commentaire libre, comme en base. */
const MAX_COMMENTAIRE = 2000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  let corps: Corps
  try {
    corps = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  if (!corps.order_id) return fail('Commande manquante')

  const { data: order } = await admin
    .from('orders')
    .select('id, status, locale, products!inner(title)')
    .eq('id', corps.order_id)
    .maybeSingle()

  if (!order) return fail('Commande introuvable', 404)

  // Payée seulement. Sans ça, n'importe quelle commande abandonnée — et il y en
  // a beaucoup — deviendrait une porte ouverte pour écrire dans la base.
  if (order.status !== 'paid') return fail('Commande introuvable', 404)

  const product = order.products as { title: string }
  const langue = lireLangue(order.locale)

  const { data: existant } = await admin
    .from('order_feedback')
    .select('rating')
    .eq('order_id', order.id)
    .maybeSingle()

  if (corps.action !== 'envoyer') {
    return json({
      product_title: product.title,
      deja_donne: existant !== null,
      whatsapp_url: lienWhatsapp(
        langue === 'en'
          ? `Hello, about my order for “${product.title}”:`
          : `Bonjour, au sujet de ma commande « ${product.title} » :`,
      ),
    })
  }

  const note = Number(corps.rating)
  if (!Number.isInteger(note) || note < 1 || note > 5) return fail('Note invalide')

  const commentaire = (corps.body ?? '').trim()
  if (commentaire.length > MAX_COMMENTAIRE) return fail('Commentaire trop long')

  const { error } = await admin.from('order_feedback').insert({
    order_id: order.id,
    rating: note,
    body: commentaire || null,
  })

  if (error) {
    // 23505 : l'avis existait déjà. Ce n'est pas une erreur pour l'acheteur —
    // il a cliqué deux fois, ou rouvert son lien. On lui répond que c'est fait.
    if (error.code === '23505') return json({ ok: true, deja_donne: true })

    console.error('avis: insertion', error)
    return fail("L'avis n'a pas pu être enregistré", 500)
  }

  return json({ ok: true, deja_donne: false })
})
