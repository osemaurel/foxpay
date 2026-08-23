import { corsHeaders, json } from '../_shared/cors.ts'
import { extractPayoutId } from '../_shared/pawapay.ts'
import { reglerRetrait } from '../_shared/retrait.ts'

/**
 * Callback pawaPay pour les retraits.
 *
 * Comme celui des encaissements, il n'est pas signé : **le corps ne fait pas
 * foi**. On n'en garde que l'identifiant, et le statut est redemandé à pawaPay.
 * N'importe qui peut donc appeler cette adresse sans rien pouvoir falsifier —
 * au pire, il déclenche une vérification qui aurait eu lieu de toute façon.
 *
 * C'est aussi par là que passe le balayage périodique pour rattraper les
 * retraits dont le callback ne serait jamais venu.
 *
 * On répond toujours 200 : pawaPay retenterait sinon, et une erreur chez nous
 * ne doit pas se transformer en file de rappels.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json({ ok: true })
  }

  const payoutId = extractPayoutId(payload)
  if (!payoutId) return json({ ok: true })

  try {
    await reglerRetrait(payoutId)
  } catch (e) {
    console.error('pawapay-payout-callback', e)
  }

  return json({ ok: true })
})
