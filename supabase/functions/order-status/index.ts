import { admin, downloadUrl } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { settleOrder } from '../_shared/settle.ts'

/**
 * Statut d'une commande, interrogé par la page de retour.
 *
 * Deux façons de la désigner : le code de checkout que pawaPay ajoute à l'URL
 * de retour, ou l'identifiant de commande gardé par le navigateur. Le premier
 * marche même si l'acheteur revient depuis un autre appareil, ce qui arrive
 * quand il paie sur son téléphone après avoir commandé sur un ordinateur.
 *
 * Les deux sont des identifiants imprévisibles connus du seul acheteur : c'est
 * ce qui autorise à renvoyer le lien de téléchargement ici, sans login.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  let body: { order_id?: string; checkout_code?: string }
  try {
    body = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  const query = admin.from('orders').select('id, status, checkout_id, download_token')
  const { data: order } = body.checkout_code
    ? await query.eq('checkout_code', body.checkout_code).maybeSingle()
    : body.order_id
      ? await query.eq('id', body.order_id).maybeSingle()
      : { data: null }

  if (!order) return fail('Commande introuvable', 404)

  let status = order.status

  // Le callback peut être en retard ou perdu : on va chercher la vérité chez
  // pawaPay tant que la commande n'est pas tranchée.
  if (status === 'pending') {
    try {
      const result = await settleOrder(order.checkout_id)
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
