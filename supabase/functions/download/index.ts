import { admin, SITE_URL } from '../_shared/admin.ts'
import { lireLangue, type Langue } from '../_shared/langue.ts'

/**
 * Lien de téléchargement envoyé par email : GET ?token=<download_token>.
 *
 * Cette fonction est la seule porte vers le bucket privé. Les contrôles
 * (payé / non expiré / quota) et l'incrément du compteur sont faits en base
 * dans consume_download(), sous verrou, pour qu'un double-clic ne compte pas
 * deux fois — ou pire, ne dépasse pas le quota.
 *
 * Quand ça se passe bien, la réponse est une redirection vers une URL signée.
 * Quand ça se passe mal, c'est une redirection vers /telechargement sur le
 * site : la passerelle des Edge Functions renvoie désormais tout HTML en
 * `text/plain`, une page servie d'ici s'afficherait donc en code source sur le
 * téléphone de l'acheteur. Le site, lui, est un vrai site.
 *
 * La langue voyage dans le lien (`lang`) posé au moment de l'envoi et suit
 * jusqu'à la page de refus.
 */
const pageDeRefus = (raison: string, langue: Langue) =>
  `${SITE_URL()}/telechargement?raison=${raison}&lang=${langue}`

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const langue = lireLangue(url.searchParams.get('lang'))

  if (!token) return Response.redirect(pageDeRefus('incomplet', langue), 302)

  // Les aperçus de lien — messageries, antivirus de boîte mail — demandent
  // souvent la page en HEAD. Répondre sans passer par consume_download évite
  // qu'un aperçu brûle un téléchargement que l'acheteur n'a pas fait.
  if (req.method === 'HEAD') return new Response(null, { status: 200 })

  const { data, error } = await admin.rpc('consume_download', { p_token: token })
  if (error) {
    console.error('consume_download', error)
    return Response.redirect(pageDeRefus('panne', langue), 302)
  }

  const row = (data as { file_path: string | null; file_name: string | null; refusal: string | null }[])[0]

  if (!row || row.refusal) {
    return Response.redirect(pageDeRefus(row?.refusal ?? 'not_found', langue), 302)
  }

  if (!row.file_path) {
    // Le vendeur a retiré le fichier après la vente : ce n'est pas la faute de
    // l'acheteur, et le compteur a déjà été décrémenté. À traiter à la main.
    console.error('commande payée sans fichier', token)
    return Response.redirect(pageDeRefus('retire', langue), 302)
  }

  // URL signée de courte durée : le temps de la redirection, pas plus.
  const { data: signed, error: signError } = await admin.storage
    .from('product-files')
    .createSignedUrl(row.file_path, 60, { download: row.file_name ?? true })

  if (signError || !signed) {
    console.error('createSignedUrl', signError)
    return Response.redirect(pageDeRefus('inaccessible', langue), 302)
  }

  return Response.redirect(signed.signedUrl, 302)
})
