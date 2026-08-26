import { requireEnv } from './admin.ts'
import type { Langue } from './langue.ts'

/**
 * Les emails d'une vente : le fichier pour l'acheteur, l'avis pour le vendeur.
 *
 * Celui de l'acheteur est la livraison elle-même — sans lui, quelqu'un qui a
 * payé puis fermé sa page n'a plus rien. Celui du vendeur n'est qu'une
 * nouvelle : il ne doit jamais faire échouer le premier.
 *
 * Les deux courriers destinés à l'acheteur suivent la langue notée sur sa
 * commande. L'avis de vente reste en français : il s'adresse au vendeur.
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

const LIVRAISON = {
  sujet: {
    fr: (titre: string) => `Ton téléchargement : ${titre}`,
    en: (titre: string) => `Your download: ${titre}`,
  },
  titre: { fr: 'Merci pour ton achat !', en: 'Thank you for your purchase!' },
  intro: {
    fr: (titre: string) =>
      `Ton paiement pour <strong>${titre}</strong> est confirmé. Voici ton lien de téléchargement :`,
    en: (titre: string) =>
      `Your payment for <strong>${titre}</strong> is confirmed. Here is your download link:`,
  },
  bouton: { fr: 'Télécharger', en: 'Download' },
  validite: {
    fr: 'Ce lien est valable <strong>7 jours</strong> et utilisable <strong>3 fois</strong>. Pense à enregistrer le fichier sur ton appareil.',
    en: 'This link is good for <strong>7 days</strong> and can be used <strong>3 times</strong>. Remember to save the file to your device.',
  },
  souci: {
    fr: (email: string) =>
      `Un souci ? Réponds à cet email ou écris à <a href="mailto:${email}">${email}</a>.`,
    en: (email: string) =>
      `Something wrong? Reply to this email or write to <a href="mailto:${email}">${email}</a>.`,
  },
} as const

export function sendDownloadEmail(params: {
  to: string
  shopName: string
  productTitle: string
  downloadUrl: string
  contactEmail: string | null
  langue: Langue
}): Promise<void> {
  return envoyer({
    to: params.to,
    replyTo: params.contactEmail,
    subject: LIVRAISON.sujet[params.langue](params.productTitle),
    html: buildDownloadHtml(params),
  })
}

function buildDownloadHtml({
  shopName,
  productTitle,
  downloadUrl,
  contactEmail,
  langue,
}: {
  shopName: string
  productTitle: string
  downloadUrl: string
  contactEmail: string | null
  langue: Langue
}): string {
  return page(`
<h1 style="margin:0 0 16px;font-size:20px">${LIVRAISON.titre[langue]}</h1>
<p style="color:#475569;line-height:1.6;margin:0 0 24px">
${LIVRAISON.intro[langue](escapeHtml(productTitle))}</p>
<a href="${downloadUrl}" style="display:block;background:#0f172a;color:#fff;text-align:center;
padding:14px;border-radius:8px;text-decoration:none;font-weight:600">${LIVRAISON.bouton[langue]}</a>
<p style="color:#64748b;font-size:14px;line-height:1.6;margin:24px 0 0">
${LIVRAISON.validite[langue]}</p>
${
  contactEmail
    ? `<p style="color:#64748b;font-size:14px;margin:16px 0 0">${LIVRAISON.souci[langue](
        escapeHtml(contactEmail),
      )}</p>`
    : ''
}
<p style="color:#94a3b8;font-size:13px;margin:24px 0 0">${escapeHtml(shopName)}</p>`, langue)
}

// ============================================================
// L'acheteur qui n'a pas ouvert son lien : le rappel
// ============================================================

/**
 * Deux rappels, et pas un de plus.
 *
 * Le premier part quelques minutes après l'achat : à ce moment-là, si le lien
 * n'a pas été ouvert, c'est presque toujours que l'email de livraison n'est
 * jamais arrivé sous les yeux de l'acheteur — classé en indésirable, ou noyé.
 * Le second part quelques heures plus tard, pour celui qui a acheté depuis son
 * téléphone en chemin et comptait s'en occuper plus tard.
 *
 * Ils ne sont pas écrits comme des relances commerciales mais comme un service :
 * quelqu'un a payé et n'a pas son fichier, il faut le lui remettre en main.
 * Chacun porte donc le lien lui-même, pas une invitation à revenir sur le site.
 */
const RAPPEL = {
  premier: {
    sujet: {
      fr: (titre: string) => `Ton fichier t'attend : ${titre}`,
      en: (titre: string) => `Your file is waiting: ${titre}`,
    },
    titre: {
      fr: "Tu n'as pas encore récupéré ton fichier",
      en: "You haven't picked up your file yet",
    },
    intro: {
      fr: (titre: string) =>
        `Ton paiement pour <strong>${titre}</strong> est bien confirmé, mais le lien de téléchargement n'a pas encore été ouvert. Le voici à nouveau :`,
      en: (titre: string) =>
        `Your payment for <strong>${titre}</strong> is confirmed, but your download link hasn't been opened yet. Here it is again:`,
    },
    astuce: {
      fr: "Si notre premier email n'est pas arrivé, regarde dans tes courriers indésirables — c'est souvent là qu'il se cache.",
      en: "If our first email never showed up, check your spam folder — that's usually where it ends up.",
    },
  },
  second: {
    sujet: {
      fr: (titre: string) => `Ton fichier est toujours disponible : ${titre}`,
      en: (titre: string) => `Your file is still available: ${titre}`,
    },
    titre: { fr: 'Ton fichier est toujours là', en: 'Your file is still here' },
    intro: {
      fr: (titre: string) =>
        `Tu as payé <strong>${titre}</strong> il y a quelques heures et le fichier n'a toujours pas été téléchargé. Rien n'est perdu — ton lien fonctionne toujours :`,
      en: (titre: string) =>
        `You paid for <strong>${titre}</strong> a few hours ago and the file still hasn't been downloaded. Nothing is lost — your link still works:`,
    },
    astuce: {
      fr: 'Ce lien reste valable 7 jours après ton achat. Pense à enregistrer le fichier sur ton appareil une fois ouvert.',
      en: 'This link stays good for 7 days after your purchase. Remember to save the file to your device once it opens.',
    },
  },
} as const

const RAPPEL_BOUTON = { fr: 'Télécharger mon fichier', en: 'Download my file' }

const RAPPEL_CONTACT = {
  fr: (email: string) =>
    `Le lien ne fonctionne pas ? Réponds à cet email ou écris à <a href="mailto:${email}">${email}</a>.`,
  en: (email: string) =>
    `Link not working? Reply to this email or write to <a href="mailto:${email}">${email}</a>.`,
} as const

export type Rappel = {
  to: string
  shopName: string
  productTitle: string
  downloadUrl: string
  contactEmail: string | null
  langue: Langue
  /** 1 = celui de quelques minutes, 2 = celui de quelques heures. */
  rang: 1 | 2
}

export function sendReminderEmail(r: Rappel): Promise<void> {
  const texte = r.rang === 1 ? RAPPEL.premier : RAPPEL.second

  return envoyer({
    to: r.to,
    replyTo: r.contactEmail,
    subject: texte.sujet[r.langue](r.productTitle),
    html: page(
      `
<h1 style="margin:0 0 16px;font-size:20px">${texte.titre[r.langue]}</h1>
<p style="color:#475569;line-height:1.6;margin:0 0 24px">
${texte.intro[r.langue](escapeHtml(r.productTitle))}</p>
<a href="${r.downloadUrl}" style="display:block;background:#0f172a;color:#fff;text-align:center;
padding:14px;border-radius:8px;text-decoration:none;font-weight:600">${RAPPEL_BOUTON[r.langue]}</a>
<p style="color:#64748b;font-size:14px;line-height:1.6;margin:24px 0 0">
${texte.astuce[r.langue]}</p>
${
  r.contactEmail
    ? `<p style="color:#64748b;font-size:14px;margin:16px 0 0">${RAPPEL_CONTACT[r.langue](
        escapeHtml(r.contactEmail),
      )}</p>`
    : ''
}
<p style="color:#94a3b8;font-size:13px;margin:24px 0 0">${escapeHtml(r.shopName)}</p>`,
      r.langue,
    ),
  })
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

const RELANCE = {
  sujet: {
    fr: (titre: string) => `Ton paiement n'a pas abouti : ${titre}`,
    en: (titre: string) => `Your payment didn't go through: ${titre}`,
  },
  titre: { fr: "Ton paiement n'est pas passé", en: "Your payment didn't go through" },
  intro: {
    fr: (titre: string) =>
      `Tu as essayé d'acheter <strong>${titre}</strong>, mais le paiement n'a pas abouti. <strong>Rien ne t'a été débité.</strong>`,
    en: (titre: string) =>
      `You tried to buy <strong>${titre}</strong>, but the payment didn't go through. <strong>Nothing was charged to you.</strong>`,
  },
  bouton: { fr: 'Reprendre mon achat', en: 'Pick up where I left off' },
  souci: {
    fr: (email: string) =>
      `Un souci ? Réponds à cet email ou écris à <a href="mailto:${email}">${email}</a>.`,
    en: (email: string) =>
      `Something wrong? Reply to this email or write to <a href="mailto:${email}">${email}</a>.`,
  },
  souciSansContact: {
    fr: 'Un souci ? Réponds simplement à cet email.',
    en: 'Something wrong? Just reply to this email.',
  },
} as const

export type Relance = {
  to: string
  shopName: string
  productTitle: string
  /** La page de paiement du produit, pour reprendre là où il s'est arrêté. */
  retryUrl: string
  /** Ce qui a bloqué, dit à l'acheteur — pas le message technique. */
  raison: string
  contactEmail: string | null
  langue: Langue
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
    subject: RELANCE.sujet[r.langue](r.productTitle),
    html: buildRetryHtml(r),
  })
}

function buildRetryHtml(r: Relance): string {
  return page(`
<h1 style="margin:0 0 16px;font-size:20px">${RELANCE.titre[r.langue]}</h1>
<p style="color:#475569;line-height:1.6;margin:0 0 16px">
${RELANCE.intro[r.langue](escapeHtml(r.productTitle))}</p>
<p style="color:#475569;line-height:1.6;margin:0 0 24px">${escapeHtml(r.raison)}</p>
<a href="${r.retryUrl}" style="display:block;background:#0f172a;color:#fff;text-align:center;
padding:14px;border-radius:8px;text-decoration:none;font-weight:600">${RELANCE.bouton[r.langue]}</a>
<p style="color:#64748b;font-size:14px;line-height:1.6;margin:24px 0 0">${
    r.contactEmail
      ? RELANCE.souci[r.langue](escapeHtml(r.contactEmail))
      : RELANCE.souciSansContact[r.langue]
  }</p>
<p style="color:#94a3b8;font-size:13px;margin:24px 0 0">${escapeHtml(r.shopName)}</p>`, r.langue)
}

// ============================================================
// Habillage commun
// ============================================================

function page(contenu: string, langue: Langue = 'fr'): string {
  return `<!doctype html><html lang="${langue}"><body style="margin:0;padding:24px;background:#f8fafc;
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
