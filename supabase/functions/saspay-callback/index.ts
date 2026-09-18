import { admin } from '../_shared/admin.ts'
import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { identifiantsSaspay } from '../_shared/identifiants.ts'
import { lireIdWebhook, verifierSignature } from '../_shared/saspay.ts'
import { settleSaspayWebhook } from '../_shared/settle.ts'

/**
 * Webhook SasPay : signé, donc digne de foi.
 *
 * Il porte une signature HMAC-SHA256 calculée avec le secret du marchand, et un
 * horodatage inclus dans ce qui est signé. Une fois les deux vérifiés, le corps
 * est authentique et frais : on peut appliquer son statut sans redemander.
 *
 * Le corps est lu en texte brut, jamais reparsé puis resérialisé : l'ordre des
 * clés ou le format des nombres changeraient, et la signature ne tomberait
 * plus juste.
 *
 * **Chaque boutique a son propre secret**, et toutes déclarent pourtant la même
 * adresse de webhook chez SasPay. Il faut donc savoir de quelle boutique il
 * s'agit *avant* de pouvoir vérifier la signature — d'où l'ordre inhabituel de
 * ce fichier : on lit l'identifiant de paiement dans le corps, on retrouve la
 * commande, on en déduit la boutique, et c'est seulement là qu'on vérifie.
 *
 * Cette lecture préalable ne fait courir aucun risque : elle ne sert qu'à
 * *choisir la clé à tester*, jamais à croire ce qu'on lit. Un corps forgé
 * désigne soit une commande qui n'existe pas, soit une commande dont le secret
 * fera échouer la signature. Rien n'est appliqué avant la vérification.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  const corps = await req.text()

  // Lecture non fiable, uniquement pour désigner la boutique.
  let payload: { event?: string; data?: { status?: string } }
  try {
    payload = JSON.parse(corps)
  } catch {
    return json({ ok: true })
  }

  const paymentId = lireIdWebhook(payload)
  if (!paymentId) return json({ ok: true })

  const { data: commande } = await admin
    .from('orders')
    .select('shop_id')
    .eq('deposit_id', paymentId)
    .maybeSingle()

  if (!commande) {
    // Aucune commande sous cet identifiant : rien à vérifier, rien à appliquer.
    // On répond 200 pour que SasPay cesse de retenter.
    console.warn('saspay-callback: paiement inconnu')
    return json({ ok: true })
  }

  const identifiants = await identifiantsSaspay(commande.shop_id as string)
  if (!identifiants?.webhookSecret) {
    console.warn('saspay-callback: aucun secret de webhook pour la boutique', commande.shop_id)
    return fail('Signature invalide', 401)
  }

  const valide = await verifierSignature(
    identifiants.webhookSecret,
    corps,
    req.headers.get('X-Webhook-Signature'),
    req.headers.get('X-Webhook-Timestamp'),
  )

  if (!valide) {
    console.warn('saspay-callback: signature refusée')
    return fail('Signature invalide', 401)
  }

  // On ne s'occupe que des encaissements. Les autres events — retraits,
  // transferts entre portefeuilles — passent sans rien changer chez nous.
  if (!payload.event?.startsWith('transaction.')) return json({ ok: true })

  const statut = payload.data?.status
  if (!statut) return json({ ok: true })

  try {
    await settleSaspayWebhook(paymentId, statut)
  } catch (e) {
    // On répond quand même 200 : SasPay retenterait cinq fois, et une panne
    // chez nous ne doit pas se transformer en file de rappels.
    console.error('saspay-callback', e)
  }

  return json({ ok: true })
})
