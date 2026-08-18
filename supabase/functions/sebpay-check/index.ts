import { corsHeaders, json } from '../_shared/cors.ts'
import { fetchViaIpFixe, ipFixeConfiguree } from '../_shared/fixie.ts'

/**
 * Sonde de découverte SebPay, sortant par l'adresse IP fixe.
 *
 * Elle renvoie le catalogue tel quel : les champs `currency` et `country` sont
 * décrits comme des « objets » dans la documentation, sans plus de précision,
 * et le code qui les lira doit être écrit sur la réalité, pas sur une
 * supposition. À supprimer une fois l'intégration terminée.
 */
const BASE = 'https://newapi.sebpay.bj/api/v1'

async function sonde(chemin: string) {
  const pk = Deno.env.get('SEBPAY_PUBLIC_KEY')
  const sk = Deno.env.get('SEBPAY_SECRET_KEY')
  if (!pk || !sk) return { erreur: 'SEBPAY_PUBLIC_KEY ou SEBPAY_SECRET_KEY manquante' }

  try {
    const res = await fetchViaIpFixe(`${BASE}${chemin}`, {
      headers: { 'X-Public-Key': pk, 'X-Secret-Key': sk, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
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

async function ipSortie(): Promise<string> {
  try {
    const res = await fetchViaIpFixe('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(10000),
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

  const ip = await ipSortie()
  const [pays, operateurs] = await Promise.all([sonde('/countries'), sonde('/operators')])

  return json({ environnement, ip_fixe: ipFixeConfiguree(), ip, pays, operateurs })
})
