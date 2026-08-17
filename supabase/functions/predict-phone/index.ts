import { corsHeaders, fail, json } from '../_shared/cors.ts'
import { predictProvider } from '../_shared/pawapay.ts'

/**
 * Valide un numéro et devine l'opérateur, pendant que l'acheteur remplit le
 * formulaire. Cela lui évite de découvrir une faute de frappe seulement après
 * avoir appuyé sur « Payer ».
 *
 * C'est un proxy : le jeton pawaPay ne doit jamais atteindre le navigateur.
 * L'opérateur deviné n'est qu'une présélection — la documentation rappelle que
 * la prédiction se trompe (6 % au Bénin, où la portabilité est courante), donc
 * l'acheteur garde toujours la main.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Méthode non autorisée', 405)

  let body: { phone?: string }
  try {
    body = await req.json()
  } catch {
    return fail('Corps JSON invalide')
  }

  const phone = body.phone?.trim()
  if (!phone) return fail('Numéro manquant')

  try {
    const prediction = await predictProvider(phone)
    return json(
      prediction
        ? { valid: true, ...prediction }
        : { valid: false },
    )
  } catch (e) {
    // Une panne de la prédiction ne doit pas bloquer le paiement : le
    // formulaire laissera passer, et create-payment revalidera de toute façon.
    console.error('predict-phone', e)
    return json({ valid: null })
  }
})
