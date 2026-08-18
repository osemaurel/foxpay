import { admin, downloadUrl } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { describeFailure } from '../_shared/failures.ts'
import { settleOrder } from '../_shared/settle.ts'

/**
 * Statut d'une commande, interrogé par la page de paiement pendant que
 * l'acheteur compose son code PIN.
 *
 * L'identifiant de commande est un UUID imprévisible, connu du seul acheteur :
 * c'est ce qui autorise à renvoyer ici le lien de téléchargement, sans login.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  let body: { order_id?: string }
  try {
    body = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  if (!body.order_id) return fail('Commande manquante')

  const { data: order } = await admin
    .from('orders')
    .select('id, status, download_token, failure_code, authorization_url')
    .eq('id', body.order_id)
    .maybeSingle()

  if (!order) return fail('Commande introuvable', 404)

  let status = order.status
  let failureCode: string | null = order.failure_code
  let authorizationUrl: string | null = order.authorization_url

  // Le callback peut être en retard ou perdu : on va chercher la vérité chez
  // le processeur tant que la commande n'est pas tranchée.
  if (status === 'pending') {
    try {
      const outcome = await settleOrder(order.id)
      if (outcome.result !== 'unknown') status = outcome.result
      failureCode = outcome.failureCode ?? failureCode
      authorizationUrl = outcome.authorizationUrl ?? authorizationUrl
    } catch (e) {
      // On répond quand même 'pending' : la page réessaiera.
      console.error('order-status', e)
    }
  }

  return json({
    status,
    download_url: status === 'paid' ? downloadUrl(order.download_token) : null,
    // Les opérateurs à autorisation par redirection (Wave) fournissent cette
    // URL quelques secondes après l'initiation. C'est le seul cas où l'acheteur
    // doit quitter la page — c'est le fonctionnement imposé par l'opérateur.
    authorization_url: status === 'pending' ? authorizationUrl : null,
    message: status === 'failed' ? describeFailure(failureCode) : null,
  })
})
