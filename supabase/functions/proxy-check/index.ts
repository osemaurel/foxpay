import { fetchViaIpFixe, ipFixeConfiguree } from '../_shared/fixie.ts'

/**
 * Diagnostic du relais à IP fixe : renvoie l'adresse par laquelle nos appels
 * sortent réellement. Deux adresses alternent, il faut les autoriser toutes
 * les deux chez SebPay. À supprimer une fois l'intégration terminée.
 */
Deno.serve(async () => {
  let ip: string
  try {
    const res = await fetchViaIpFixe('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(10000),
    })
    ip = (await res.json()).ip ?? '?'
  } catch (e) {
    ip = `erreur: ${e}`
  }

  return new Response(JSON.stringify({ relais: ipFixeConfiguree(), ip }, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})
