export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, status)
}

/*
  Pas de page HTML ici : la passerelle des Edge Functions réécrit tout
  `text/html` en `text/plain` et interdit son rendu. Ce qu'un acheteur doit
  lire s'affiche sur le site — voir /telechargement.
*/
