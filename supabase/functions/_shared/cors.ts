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

/** Page HTML minimale pour les erreurs vues directement par l'acheteur. */
export function htmlMessage(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1rem}
div{max-width:28rem;text-align:center;background:#fff;border:1px solid #e2e8f0;
border-radius:.75rem;padding:2rem}p{color:#475569;line-height:1.6}</style></head>
<body><div><h1>${title}</h1><p>${body}</p></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
