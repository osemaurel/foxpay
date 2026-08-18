import { requireEnv } from './admin.ts'

/**
 * Les deux emails d'une vente : le fichier pour l'acheteur, l'avis pour le
 * vendeur.
 *
 * Celui de l'acheteur est la livraison elle-même — sans lui, quelqu'un qui a
 * payé puis fermé sa page n'a plus rien. Celui du vendeur n'est qu'une
 * nouvelle : il ne doit jamais faire échouer le premier.
 */

const RESEND = 'https://api.resend.com/emails'

type Envoi = {
  to: string
  subject: string
  html: string
  replyTo?: string | null
}

async function envoyer({ to, subject, html, replyTo }: Envoi): Promise<void> {
  const res = await fetch(RESEND, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: requireEnv('RESEND_FROM'),
      to: [to],
      reply_to: replyTo ?? undefined,
      subject,
      html,
    }),
  })

  if (!res.ok) throw new Error(`Resend ${res.status} : ${await res.text()}`)
}

// ============================================================
// L'acheteur : son fichier
// ============================================================

export function sendDownloadEmail(params: {
  to: string
  shopName: string
  productTitle: string
  downloadUrl: string
  contactEmail: string | null
}): Promise<void> {
  return envoyer({
    to: params.to,
    replyTo: params.contactEmail,
    subject: `Ton téléchargement : ${params.productTitle}`,
    html: buildDownloadHtml(params),
  })
}

function buildDownloadHtml({
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
  return page(`
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
<p style="color:#94a3b8;font-size:13px;margin:24px 0 0">${escapeHtml(shopName)}</p>`)
}

// ============================================================
// Le vendeur : sa vente
// ============================================================

export type Vente = {
  to: string
  shopName: string
  productTitle: string
  buyerName: string | null
  buyerEmail: string
  buyerPhone: string | null
  /** Déjà formaté, devise comprise : « 3 605 FCFA ». */
  montant: string
  countryName: string | null
  operateur: string | null
}

/**
 * L'avis de vente. L'email de l'acheteur est mis en adresse de réponse : d'un
 * clic le vendeur lui écrit, sans avoir à ouvrir l'administration.
 */
export function sendSaleEmail(v: Vente): Promise<void> {
  return envoyer({
    to: v.to,
    replyTo: v.buyerEmail,
    subject: `Vente : ${v.productTitle} — ${v.montant}`,
    html: buildSaleHtml(v),
  })
}

function buildSaleHtml(v: Vente): string {
  const lignes = [
    ['Produit', v.productTitle],
    ['Montant', v.montant],
    ['Acheteur', v.buyerName],
    ['Email', v.buyerEmail],
    ['Téléphone', v.buyerPhone ? `+${v.buyerPhone}` : null],
    ['Pays', v.countryName],
    ['Opérateur', v.operateur],
  ].filter(([, valeur]) => valeur) as [string, string][]

  return page(`
<h1 style="margin:0 0 16px;font-size:20px">Nouvelle vente 🎉</h1>
<p style="color:#475569;line-height:1.6;margin:0 0 24px">
Le paiement est confirmé et le fichier vient de partir chez l'acheteur.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${lignes
  .map(
    ([label, valeur]) => `<tr>
<td style="padding:6px 0;color:#64748b;white-space:nowrap">${escapeHtml(label)}</td>
<td style="padding:6px 0;color:#0f172a;text-align:right">${escapeHtml(valeur)}</td>
</tr>`,
  )
  .join('')}
</table>
<p style="color:#64748b;font-size:14px;line-height:1.6;margin:24px 0 0">
Réponds à cet email pour écrire directement à l'acheteur.</p>
<p style="color:#94a3b8;font-size:13px;margin:24px 0 0">${escapeHtml(v.shopName)}</p>`)
}

// ============================================================
// L'acheteur qui n'a pas abouti : la relance
// ============================================================

export type Relance = {
  to: string
  shopName: string
  productTitle: string
  /** La page de paiement du produit, pour reprendre là où il s'est arrêté. */
  retryUrl: string
  /** Ce qui a bloqué, dit à l'acheteur — pas le message technique. */
  raison: string
  contactEmail: string | null
}

/**
 * Relance après un paiement qui n'a pas abouti.
 *
 * Elle est déclenchée à la main par le vendeur, jamais automatiquement : un
 * échec mobile money vient souvent d'un solde insuffisant, et écrire à
 * quelqu'un dès la minute où il manque d'argent se retourne contre la boutique.
 */
export function sendRetryEmail(r: Relance): Promise<void> {
  return envoyer({
    to: r.to,
    replyTo: r.contactEmail,
    subject: `Ton paiement n'a pas abouti : ${r.productTitle}`,
    html: buildRetryHtml(r),
  })
}

function buildRetryHtml(r: Relance): string {
  return page(`
<h1 style="margin:0 0 16px;font-size:20px">Ton paiement n'est pas passé</h1>
<p style="color:#475569;line-height:1.6;margin:0 0 16px">
Tu as essayé d'acheter <strong>${escapeHtml(r.productTitle)}</strong>, mais le paiement
n'a pas abouti. <strong>Rien ne t'a été débité.</strong></p>
<p style="color:#475569;line-height:1.6;margin:0 0 24px">${escapeHtml(r.raison)}</p>
<a href="${r.retryUrl}" style="display:block;background:#0f172a;color:#fff;text-align:center;
padding:14px;border-radius:8px;text-decoration:none;font-weight:600">Reprendre mon achat</a>
${
  r.contactEmail
    ? `<p style="color:#64748b;font-size:14px;line-height:1.6;margin:24px 0 0">Un souci ?
Réponds à cet email ou écris à
<a href="mailto:${escapeHtml(r.contactEmail)}">${escapeHtml(r.contactEmail)}</a>.</p>`
    : `<p style="color:#64748b;font-size:14px;line-height:1.6;margin:24px 0 0">Un souci ?
Réponds simplement à cet email.</p>`
}
<p style="color:#94a3b8;font-size:13px;margin:24px 0 0">${escapeHtml(r.shopName)}</p>`)
}

// ============================================================
// Habillage commun
// ============================================================

function page(contenu: string): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f8fafc;
font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;
border-radius:12px;padding:32px">${contenu}
</div></body></html>`
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}
