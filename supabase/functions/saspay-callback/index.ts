import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { lireIdWebhook, verifierSignature } from '../_shared/saspay.ts'
import { settleSaspayWebhook } from '../_shared/settle.ts'

/**
 * Webhook SasPay : signé, donc digne de foi.
 *
 * Contrairement au callback pawaPay, celui-ci porte une signature HMAC-SHA256
 * calculée avec notre secret, **et** un horodatage inclus dans ce qui est
 * signé. Une fois les deux vérifiés, le corps est authentique et frais : on
 * peut appliquer son statut sans redemander.
 *
 * Le corps est lu en texte brut, jamais reparsé puis resérialisé : l'ordre des
 * clés ou le format des nombres changeraient, et la signature ne tomberait
 * plus juste.
 *
 * Un corps non signé est refusé net — c'est la seule porte par laquelle on
 * accepte qu'un tiers nous dise qu'une commande est payée.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  const corps = await req.text()

  const valide = await verifierSignature(
    corps,
    req.headers.get('X-Webhook-Signature'),
    req.headers.get('X-Webhook-Timestamp'),
  )

  if (!valide) {
    console.warn('saspay-callback: signature refusée')
    return fail('Signature invalide', 401)
  }

  let payload: { event?: string; data?: { status?: string } }
  try {
    payload = JSON.parse(corps)
  } catch {
    return json({ ok: true })
  }

  // On ne s'occupe que des encaissements. Les autres events — retraits,
  // transferts entre portefeuilles — passent sans rien changer chez nous.
  if (!payload.event?.startsWith('transaction.')) return json({ ok: true })

  const paymentId = lireIdWebhook(payload)
  const statut = payload.data?.status
  if (!paymentId || !statut) return json({ ok: true })

  try {
    await settleSaspayWebhook(paymentId, statut)
  } catch (e) {
    // On répond quand même 200 : SasPay retenterait cinq fois, et une panne
    // chez nous ne doit pas se transformer en file de rappels.
    console.error('saspay-callback', e)
  }

  return json({ ok: true })
})
