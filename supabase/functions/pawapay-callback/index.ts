import { fail, json } from '../_shared/cors.ts'
import { extractDepositId } from '../_shared/pawapay.ts'
import { settleOrder } from '../_shared/settle.ts'

/**
 * Callback pawaPay. Du corps de la requête on ne retient que le depositId : le
 * statut réel est redemandé à l'API pawaPay dans settleOrder(). Vérifier la
 * signature du callback devient donc facultatif — un faux callback ne peut pas
 * déclencher une livraison.
 *
 * pawaPay attend un HTTP 200 pour considérer le callback délivré, et réessaie
 * pendant 15 minutes sinon. 500 = « réessaie », 200 = « c'est traité ».
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  const depositId = extractDepositId(payload)
  if (!depositId) return fail('depositId absent du callback')

  try {
    const { result } = await settleOrder(depositId)
    if (result === 'unknown') {
      // Rien à réconcilier chez nous : inutile que pawaPay rejoue.
      console.warn('callback pour un depositId inconnu', depositId)
    }
    return json({ ok: true, status: result })
  } catch (e) {
    // Vérification ou email en échec : on demande un rejeu.
    console.error('pawapay-callback', e)
    return fail('Traitement impossible', 500)
  }
})
