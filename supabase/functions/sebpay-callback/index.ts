import { fail, json } from '../_shared/cors.ts'
import { verifySignature } from '../_shared/sebpay.ts'
import { settleSebpayWebhook } from '../_shared/settle.ts'

/**
 * Callback SebPay.
 *
 * À l'inverse de celui de pawaPay, ce corps est signé en HMAC-SHA256 avec notre
 * clé secrète : une signature valide prouve qu'il vient bien de SebPay, et on
 * peut donc lui faire confiance sans redemander le statut. C'est ce qui évite de
 * dépenser un appel du relais à IP fixe à chaque notification.
 *
 * Sans signature valide, rien n'est traité : un faux callback ne doit pas
 * pouvoir déclencher une livraison.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  // Le corps brut, tel quel : la signature porte sur les octets reçus, et
  // re-sérialiser le JSON changerait l'ordre des clés ou les espaces.
  const brut = await req.text()

  const signature =
    req.headers.get('X-SebPay-Signature') ??
    req.headers.get('x-sebpay-signature') ??
    req.headers.get('X-Signature')

  if (!(await verifySignature(brut, signature))) {
    console.warn('sebpay-callback : signature invalide')
    return fail('Signature invalide', 401)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(brut)
  } catch {
    return fail('Corps JSON invalide')
  }

  // SebPay enveloppe parfois la charge utile dans `data`, comme ses réponses.
  const data = (payload.data as Record<string, unknown>) ?? payload
  const reference = lire(data.external_reference) ?? lire(payload.external_reference)
  const statut = lire(data.status) ?? lire(payload.status)
  const transaction = lire(data.transaction_id) ?? lire(payload.transaction_id)

  if (!reference || !statut) return fail('Callback incomplet')

  try {
    const { result } = await settleSebpayWebhook(reference, statut, transaction)
    if (result === 'unknown') {
      console.warn('callback pour une référence inconnue', reference)
    }
    return json({ ok: true, status: result })
  } catch (e) {
    // Vérification ou email en échec : on demande un rejeu.
    console.error('sebpay-callback', e)
    return fail('Traitement impossible', 500)
  }
})

function lire(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.trim() ? valeur.trim() : null
}
