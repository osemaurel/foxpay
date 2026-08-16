import { requireEnv } from './admin.ts'

/** Envoi de l'email de livraison via Resend. */
export async function sendDownloadEmail(params: {
  to: string
  shopName: string
  productTitle: string
  downloadUrl: string
  contactEmail: string | null
}): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: requireEnv('RESEND_FROM'),
      to: [params.to],
      reply_to: params.contactEmail ?? undefined,
      subject: `Ton téléchargement : ${params.productTitle}`,
      html: buildHtml(params),
    }),
  })

  if (!res.ok) throw new Error(`Resend ${res.status} : ${await res.text()}`)
}

function buildHtml({
  shopName,
  productTitle,
  downloadUrl,
  contactEmail,
}: {
  shopName: string
  productTitle: string
  downloadUrl: string
  contactEmail: string | null
}): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f8fafc;
font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;
border-radius:12px;padding:32px">
<h1 style="margin:0 0 16px;font-size:20px">Merci pour ton achat !</h1>
<p style="color:#475569;line-height:1.6;margin:0 0 24px">
Ton paiement pour <strong>${escapeHtml(productTitle)}</strong> est confirmé.
Voici ton lien de téléchargement :</p>
<a href="${downloadUrl}" style="display:block;background:#0f172a;color:#fff;text-align:center;
padding:14px;border-radius:8px;text-decoration:none;font-weight:600">Télécharger</a>
<p style="color:#64748b;font-size:14px;line-height:1.6;margin:24px 0 0">
Ce lien est valable <strong>24 heures</strong> et utilisable <strong>3 fois</strong>.
Pense à enregistrer le fichier sur ton appareil.</p>
${
  contactEmail
    ? `<p style="color:#64748b;font-size:14px;margin:16px 0 0">Un souci ? Réponds à cet email
ou écris à <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.</p>`
    : ''
}
<p style="color:#94a3b8;font-size:13px;margin:24px 0 0">${escapeHtml(shopName)}</p>
</div></body></html>`
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}
