import { admin, SITE_URL } from '../_shared/admin.ts'
import { lienWhatsapp } from '../_shared/contact.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { sendReviewRequestEmail } from '../_shared/email.ts'
import { lireLangue } from '../_shared/langue.ts'

/**
 * Demander son avis à l'acheteur, le lendemain.
 *
 * Deux conditions, et elles disent tout de l'intention. La commande doit avoir
 * été **téléchargée** : demander à quelqu'un ce qu'il a pensé d'un fichier
 * qu'il n'a jamais ouvert, c'est se moquer de lui — ceux-là reçoivent les
 * rappels, qui sont faits pour eux. Et il doit s'être écoulé **un jour** :
 * assez pour qu'il ait lu ce qu'il a acheté, pas assez pour l'avoir oublié.
 *
 * Un seul courrier par commande, jamais deux : `review_requested_at` est écrit
 * dès l'envoi et la sélection l'exige nul. Appelée par le balayage toutes les
 * quinze minutes, elle ne produit donc rien de plus qu'un envoi par acheteur.
 */

/** Le délai après la livraison. Un jour : le temps d'avoir vraiment ouvert. */
const APRES_HEURES = 24

/** Ce qu'on traite par passage — le balayage revient dans un quart d'heure. */
const PAR_PASSAGE = 25

type Commande = {
  id: string
  buyer_email: string
  locale: string
  shops: unknown
  products: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const seuil = new Date(Date.now() - APRES_HEURES * 3600_000).toISOString()

  const { data, error } = await admin
    .from('orders')
    .select('id, buyer_email, locale, shops!inner(name, slug, contact_email), products!inner(title)')
    .eq('status', 'paid')
    .is('review_requested_at', null)
    .gt('download_count', 0)
    .not('delivered_at', 'is', null)
    .lt('delivered_at', seuil)
    .order('delivered_at')
    .limit(PAR_PASSAGE)

  if (error) {
    console.error('demande-avis: lecture', error)
    return json({ error: error.message }, 500)
  }

  let envoyes = 0

  for (const brut of (data ?? []) as Commande[]) {
    const shop = brut.shops as { name: string; slug: string; contact_email: string | null }
    const product = brut.products as { title: string }
    const langue = lireLangue(brut.locale)

    try {
      await sendReviewRequestEmail({
        to: brut.buyer_email,
        shopName: shop.name,
        productTitle: product.title,
        avisUrl: `${SITE_URL()}/boutique/${shop.slug}/avis?order=${brut.id}`,
        // Le message pré-rempli épargne à l'acheteur d'avoir à expliquer d'où
        // il sort, et au vendeur d'avoir à le deviner.
        whatsappUrl: lienWhatsapp(
          langue === 'en'
            ? `Hello, about my order for “${product.title}”:`
            : `Bonjour, au sujet de ma commande « ${product.title} » :`,
        ),
        contactEmail: shop.contact_email,
        langue,
      })
    } catch (e) {
      // Un envoi raté ne marque rien : il repartira au passage suivant.
      console.error('demande-avis: envoi', brut.id, e)
      continue
    }

    await admin
      .from('orders')
      .update({ review_requested_at: new Date().toISOString() })
      .eq('id', brut.id)

    envoyes += 1
  }

  return json({ envoyes })
})
