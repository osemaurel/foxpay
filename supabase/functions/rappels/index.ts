import { admin, downloadUrl } from '../_shared/admin.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { sendReminderEmail } from '../_shared/email.ts'
import { lireLangue } from '../_shared/langue.ts'

/**
 * Relancer les acheteurs qui n'ont pas ouvert leur lien.
 *
 * Une vente payée dont le compteur de téléchargements est resté à zéro, c'est
 * quelqu'un qui a donné son argent et n'a rien reçu — quelle qu'en soit la
 * raison. L'email de livraison est parti, mais il a pu finir en indésirable,
 * être ouvert sur un téléphone qui n'a pas su enregistrer le fichier, ou
 * simplement se perdre. Cette fonction remet le lien sous leurs yeux.
 *
 * Deux passages, et c'est tout : à quelques minutes puis à quelques heures.
 * Au-delà, insister deviendrait du harcèlement — et le vendeur a de toute
 * façon le bouton de renvoi dans le détail de la vente.
 *
 * Appelée par le balayage périodique. Elle ne prend aucun paramètre et ne fait
 * que lire l'état de la base : l'appeler plus souvent n'envoie pas un rappel de
 * plus, les conditions de temps et le compteur s'en chargent.
 */

/** Le premier rappel : assez tard pour ne pas doubler l'email de livraison. */
const PREMIER_APRES_MIN = 15

/**
 * Le second, compté **depuis le premier** et non depuis l'achat.
 *
 * La nuance n'est pas cosmétique : ancré sur l'achat, il partait en même temps
 * que le premier dès qu'une commande était traitée en retard — l'acheteur
 * recevait les deux courriers coup sur coup.
 */
const SECOND_APRES_PREMIER_HEURES = 6

/** Ce qu'on traite par passage. Le balayage revient toutes les 15 minutes. */
const PAR_PASSAGE = 25

type Commande = {
  id: string
  download_token: string
  download_reminders: number
  buyer_email: string
  locale: string
  shops: unknown
  products: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const maintenant = Date.now()
  const premier = new Date(maintenant - PREMIER_APRES_MIN * 60_000).toISOString()
  const second = new Date(maintenant - SECOND_APRES_PREMIER_HEURES * 3600_000).toISOString()

  // Payée, livrée, lien encore ouvert, jamais téléchargée. `delivered_at` est
  // exigé : rappeler un lien dont l'email d'origine n'est jamais parti serait
  // remettre une deuxième fois la charrue avant les bœufs.
  const { data, error } = await admin
    .from('orders')
    .select(
      'id, download_token, download_reminders, buyer_email, locale, ' +
        'shops!inner(name, contact_email), products!inner(title)',
    )
    .eq('status', 'paid')
    .eq('download_count', 0)
    .not('delivered_at', 'is', null)
    .gt('download_expires_at', new Date(maintenant).toISOString())
    .lt('download_reminders', 2)
    .or(`and(download_reminders.eq.0,paid_at.lt.${premier}),` +
        `and(download_reminders.eq.1,last_reminder_at.lt.${second})`)
    .order('paid_at')
    .limit(PAR_PASSAGE)

  if (error) {
    console.error('rappels: lecture', error)
    return json({ error: error.message }, 500)
  }

  let envoyes = 0

  for (const brut of (data ?? []) as Commande[]) {
    const shop = brut.shops as { name: string; contact_email: string | null }
    const product = brut.products as { title: string }
    const langue = lireLangue(brut.locale)

    try {
      await sendReminderEmail({
        to: brut.buyer_email,
        shopName: shop.name,
        productTitle: product.title,
        downloadUrl: downloadUrl(brut.download_token, langue),
        contactEmail: shop.contact_email,
        langue,
        rang: brut.download_reminders === 0 ? 1 : 2,
      })
    } catch (e) {
      // Un envoi raté n'incrémente rien : il repartira au passage suivant.
      console.error('rappels: envoi', brut.id, e)
      continue
    }

    await admin
      .from('orders')
      .update({
        download_reminders: brut.download_reminders + 1,
        last_reminder_at: new Date().toISOString(),
      })
      .eq('id', brut.id)

    envoyes += 1
  }

  return json({ envoyes })
})
