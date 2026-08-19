import { admin } from '../_shared/admin.ts'
import { htmlMessage } from '../_shared/cors.ts'
import { lireLangue, type Langue } from '../_shared/langue.ts'

/**
 * Lien de téléchargement envoyé par email : GET ?token=<download_token>.
 *
 * Cette fonction est la seule porte vers le bucket privé. Les contrôles
 * (payé / non expiré / quota) et l'incrément du compteur sont faits en base
 * dans consume_download(), sous verrou, pour qu'un double-clic ne compte pas
 * deux fois — ou pire, ne dépasse pas le quota.
 *
 * La langue vient du paramètre `lang` posé dans le lien au moment de l'envoi :
 * ces pages ne s'affichent qu'en cas de refus, et charger une commande pour
 * choisir la langue d'un message d'erreur serait un aller-retour pour rien.
 */
const REFUSALS: Record<string, Record<Langue, { title: string; body: string }>> = {
  not_found: {
    fr: {
      title: 'Lien inconnu',
      body: "Ce lien de téléchargement n'existe pas. Vérifie que tu as copié l'adresse complète depuis l'email.",
    },
    en: {
      title: 'Unknown link',
      body: "This download link doesn't exist. Check that you copied the full address from the email.",
    },
  },
  not_paid: {
    fr: {
      title: 'Paiement non confirmé',
      body: "Nous n'avons pas encore reçu la confirmation de ton paiement. Le lien s'activera dès que l'opérateur nous la transmet.",
    },
    en: {
      title: 'Payment not confirmed',
      body: "We haven't received confirmation of your payment yet. The link will work as soon as your provider sends it.",
    },
  },
  expired: {
    fr: {
      title: 'Lien expiré',
      body: 'Ce lien était valable 7 jours. Contacte le vendeur pour en obtenir un nouveau.',
    },
    en: {
      title: 'Link expired',
      body: 'This link was good for 7 days. Contact the seller to get a new one.',
    },
  },
  exhausted: {
    fr: {
      title: 'Nombre de téléchargements atteint',
      body: 'Ce lien a déjà servi le nombre de fois prévu. Contacte le vendeur si tu as perdu le fichier.',
    },
    en: {
      title: 'Download limit reached',
      body: 'This link has already been used the number of times allowed. Contact the seller if you lost the file.',
    },
  },
}

const ERREURS = {
  incomplet: {
    fr: { title: 'Lien invalide', body: 'Ce lien est incomplet.' },
    en: { title: 'Invalid link', body: 'This link is incomplete.' },
  },
  panne: {
    fr: { title: 'Erreur', body: 'Réessaie dans un instant.' },
    en: { title: 'Something went wrong', body: 'Please try again in a moment.' },
  },
  retire: {
    fr: {
      title: 'Fichier indisponible',
      body: 'Le fichier a été retiré par le vendeur. Contacte-le pour être livré.',
    },
    en: {
      title: 'File unavailable',
      body: 'The seller removed this file. Get in touch with them to receive it.',
    },
  },
  inaccessible: {
    fr: { title: 'Erreur', body: 'Le fichier est momentanément inaccessible.' },
    en: { title: 'Something went wrong', body: 'The file is temporarily unreachable.' },
  },
} as const

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const langue = lireLangue(url.searchParams.get('lang'))

  if (!token) {
    const { title, body } = ERREURS.incomplet[langue]
    return htmlMessage(title, body, 400, langue)
  }

  const { data, error } = await admin.rpc('consume_download', { p_token: token })
  if (error) {
    console.error('consume_download', error)
    const { title, body } = ERREURS.panne[langue]
    return htmlMessage(title, body, 500, langue)
  }

  const row = (data as { file_path: string | null; file_name: string | null; refusal: string | null }[])[0]

  if (!row || row.refusal) {
    const refusal = (REFUSALS[row?.refusal ?? 'not_found'] ?? REFUSALS.not_found)[langue]
    return htmlMessage(
      refusal.title,
      refusal.body,
      row?.refusal === 'not_found' ? 404 : 410,
      langue,
    )
  }

  if (!row.file_path) {
    // Le vendeur a retiré le fichier après la vente : ce n'est pas la faute de
    // l'acheteur, et le compteur a déjà été décrémenté. À traiter à la main.
    console.error('commande payée sans fichier', token)
    const { title, body } = ERREURS.retire[langue]
    return htmlMessage(title, body, 404, langue)
  }

  // URL signée de courte durée : le temps de la redirection, pas plus.
  const { data: signed, error: signError } = await admin.storage
    .from('product-files')
    .createSignedUrl(row.file_path, 60, { download: row.file_name ?? true })

  if (signError || !signed) {
    console.error('createSignedUrl', signError)
    const { title, body } = ERREURS.inaccessible[langue]
    return htmlMessage(title, body, 500, langue)
  }

  return Response.redirect(signed.signedUrl, 302)
})
