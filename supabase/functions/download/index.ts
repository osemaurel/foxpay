import { admin } from '../_shared/admin.ts'
import { htmlMessage } from '../_shared/cors.ts'

/**
 * Lien de téléchargement envoyé par email : GET ?token=<download_token>.
 *
 * Cette fonction est la seule porte vers le bucket privé. Les contrôles
 * (payé / non expiré / quota) et l'incrément du compteur sont faits en base
 * dans consume_download(), sous verrou, pour qu'un double-clic ne compte pas
 * deux fois — ou pire, ne dépasse pas le quota.
 */
const REFUSALS: Record<string, { title: string; body: string }> = {
  not_found: {
    title: 'Lien inconnu',
    body: "Ce lien de téléchargement n'existe pas. Vérifie que tu as copié l'adresse complète depuis l'email.",
  },
  not_paid: {
    title: 'Paiement non confirmé',
    body: "Nous n'avons pas encore reçu la confirmation de ton paiement. Le lien s'activera dès que l'opérateur nous la transmet.",
  },
  expired: {
    title: 'Lien expiré',
    body: 'Ce lien était valable 24 heures. Contacte le vendeur pour en obtenir un nouveau.',
  },
  exhausted: {
    title: 'Nombre de téléchargements atteint',
    body: 'Ce lien a déjà servi le nombre de fois prévu. Contacte le vendeur si tu as perdu le fichier.',
  },
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) {
    return htmlMessage('Lien invalide', 'Ce lien est incomplet.', 400)
  }

  const { data, error } = await admin.rpc('consume_download', { p_token: token })
  if (error) {
    console.error('consume_download', error)
    return htmlMessage('Erreur', 'Réessaie dans un instant.', 500)
  }

  const row = (data as { file_path: string | null; file_name: string | null; refusal: string | null }[])[0]

  if (!row || row.refusal) {
    const refusal = REFUSALS[row?.refusal ?? 'not_found'] ?? REFUSALS.not_found
    return htmlMessage(refusal.title, refusal.body, row?.refusal === 'not_found' ? 404 : 410)
  }

  if (!row.file_path) {
    // Le vendeur a retiré le fichier après la vente : ce n'est pas la faute de
    // l'acheteur, et le compteur a déjà été décrémenté. À traiter à la main.
    console.error('commande payée sans fichier', token)
    return htmlMessage(
      'Fichier indisponible',
      'Le fichier a été retiré par le vendeur. Contacte-le pour être livré.',
      404,
    )
  }

  // URL signée de courte durée : le temps de la redirection, pas plus.
  const { data: signed, error: signError } = await admin.storage
    .from('product-files')
    .createSignedUrl(row.file_path, 60, { download: row.file_name ?? true })

  if (signError || !signed) {
    console.error('createSignedUrl', signError)
    return htmlMessage('Erreur', 'Le fichier est momentanément inaccessible.', 500)
  }

  return Response.redirect(signed.signedUrl, 302)
})
