import { corsHeaders, json } from '../_shared/cors.ts'

/**
 * Sonde de découverte SebPay.
 *
 * Elle renvoie le catalogue tel quel, et l'adresse IP depuis laquelle nos
 * fonctions sortent — SebPay filtre les clés API par IP, il faut donc savoir
 * laquelle autoriser, et surtout si elle est stable d'un appel à l'autre.
 *
 * Aucune clé n'est renvoyée. À supprimer une fois l'intégration terminée.
 */
const BASE = 'https://newapi.sebpay.bj/api/v1'

async function sonde(chemin: string) {
  const pk = Deno.env.get('SEBPAY_PUBLIC_KEY')
  const sk = Deno.env.get('SEBPAY_SECRET_KEY')
  if (!pk || !sk) return { erreur: 'SEBPAY_PUBLIC_KEY ou SEBPAY_SECRET_KEY manquante' }

  try {
    const res = await fetch(`${BASE}${chemin}`, {
      headers: { 'X-Public-Key': pk, 'X-Secret-Key': sk, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    const texte = await res.text()
    try {
      return { statut: res.status, corps: JSON.parse(texte) }
    } catch {
      return { statut: res.status, brut: texte.slice(0, 1000) }
    }
  } catch (e) {
    return { erreur: String(e) }
  }
}

/** Notre adresse de sortie, vue de l'extérieur. */
async function ipSortie(): Promise<string> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(8000),
    })
    return (await res.json()).ip ?? '?'
  } catch (e) {
    return `erreur: ${e}`
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const pk = Deno.env.get('SEBPAY_PUBLIC_KEY') ?? ''
  const environnement = pk.startsWith('pk_live_')
    ? 'production'
    : pk.startsWith('pk_test_')
      ? 'test'
      : 'inconnu'

  // Trois relevés d'affilée : si l'IP change entre eux, la liste blanche de
  // SebPay ne pourra pas suivre.
  const ips = [await ipSortie(), await ipSortie(), await ipSortie()]

  const [pays, operateurs] = await Promise.all([sonde('/countries'), sonde('/operators')])
  return json({ environnement, ips, pays, operateurs })
})
