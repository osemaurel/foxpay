import { admin, downloadUrl } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { settleOrder } from '../_shared/settle.ts'

/**
 * Statut d'une commande, interrogé par la page de retour.
 *
 * L'id de commande est un UUID que seul le navigateur de l'acheteur connaît :
 * c'est ce qui autorise à renvoyer le lien de téléchargement ici, sans login.
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

  const orderId = body.order_id
  if (!orderId) return fail('order_id manquant')

  const { data: order } = await admin
    .from('orders')
    .select('id, status, deposit_id, download_token')
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return fail('Commande introuvable', 404)

  let status = order.status

  // Le callback peut être en retard ou perdu : on va chercher la vérité chez
  // pawaPay tant que la commande n'est pas tranchée.
  if (status === 'pending') {
    try {
      const result = await settleOrder(order.deposit_id)
      if (result !== 'unknown') status = result
    } catch (e) {
      // On répond quand même 'pending' : la page réessaiera.
      console.error('order-status', e)
    }
  }

  return json({
    status,
    download_url: status === 'paid' ? downloadUrl(order.download_token) : null,
  })
})
