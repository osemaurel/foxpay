import { useSyncExternalStore } from 'react'

/**
 * Le tunnel d'achat en deux langues.
 *
 * La langue vient de l'appareil de l'acheteur — un téléphone réglé en anglais
 * ouvre la boutique en anglais — et un sélecteur en pied de page permet d'en
 * changer. Le choix explicite gagne toujours sur la détection, et il est gardé
 * d'une visite à l'autre.
 *
 * Seul le tunnel est traduit : ce que le vendeur écrit lui-même — titres,
 * descriptions, avis, libellé du bouton d'achat — reste tel qu'il l'a saisi.
 * L'administration aussi reste en français, c'est l'écran du vendeur.
 *
 * Pas de bibliothèque : deux langues et un dictionnaire plat suffisent, et
 * garder les deux versions côte à côte est ce qui les empêche de diverger.
 */

export type Langue = 'fr' | 'en'

const CLE = 'foxpay:langue'

function estLangue(valeur: unknown): valeur is Langue {
  return valeur === 'fr' || valeur === 'en'
}

/**
 * La langue de départ : celle choisie la dernière fois, sinon celle de
 * l'appareil. Tout ce qui n'est pas du français passe en anglais — c'est la
 * seule autre langue que nous parlons, et un acheteur qui lit l'espagnol s'en
 * sortira mieux en anglais qu'en français.
 */
function detecter(): Langue {
  if (typeof window === 'undefined') return 'fr'

  const garde = window.localStorage?.getItem(CLE)
  if (estLangue(garde)) return garde

  const langues = window.navigator.languages ?? [window.navigator.language]
  return langues.some((l) => l?.toLowerCase().startsWith('fr')) ? 'fr' : 'en'
}

let courante: Langue = detecter()
const abonnes = new Set<() => void>()

function sAbonner(rafraichir: () => void): () => void {
  abonnes.add(rafraichir)
  return () => abonnes.delete(rafraichir)
}

export function setLangue(langue: Langue): void {
  if (langue === courante) return
  courante = langue
  window.localStorage?.setItem(CLE, langue)
  document.documentElement.lang = langue
  for (const rafraichir of abonnes) rafraichir()
}

/** L'étiquette `lang` du document suit la langue : lecteurs d'écran, correcteurs. */
if (typeof document !== 'undefined') document.documentElement.lang = courante

/**
 * Le code d'internationalisation pour `Intl` : séparateurs de milliers, format
 * des devises. « 15 000 FCFA » en français, « 15,000 FCFA » en anglais.
 */
export const INTL: Record<Langue, string> = { fr: 'fr-FR', en: 'en-US' }

// ============================================================
// Le dictionnaire
// ============================================================

const TEXTES = {
  // --- Boutique ---
  boutiqueIntrouvable: { fr: "Cette boutique n'existe pas.", en: "This shop doesn't exist." },
  catalogue: { fr: 'Le catalogue', en: 'The catalogue' },
  voirCatalogue: { fr: 'Voir le catalogue', en: 'See the catalogue' },
  retourCatalogue: { fr: '← Catalogue', en: '← Catalogue' },
  aucunProduit: {
    fr: 'Aucun produit en vente pour le moment.',
    en: 'Nothing on sale at the moment.',
  },
  nombreProduits: {
    fr: (n: number) => `${n} produit${n > 1 ? 's' : ''}`,
    en: (n: number) => `${n} product${n > 1 ? 's' : ''}`,
  },
  sansVisuel: { fr: 'Sans visuel', en: 'No image' },

  // --- Fiche produit ---
  produitIndisponible: {
    fr: "Ce produit n'est pas disponible.",
    en: "This product isn't available.",
  },
  acheter: { fr: 'Acheter', en: 'Buy' },
  avisClients: { fr: 'Avis clients', en: 'Customer reviews' },
  avisTitre: {
    fr: "Ce qu'en disent celles et ceux qui l'ont acheté",
    en: 'What the people who bought it have to say',
  },
  noteSur5: {
    fr: (n: number) => `${n} sur 5`,
    en: (n: number) => `${n} out of 5`,
  },

  // --- Page de paiement ---
  produitPlusDisponible: {
    fr: "Ce produit n'est plus disponible.",
    en: "This product is no longer available.",
  },
  retourProduit: { fr: '← Retour au produit', en: '← Back to the product' },
  paiementConfirme: { fr: 'Paiement confirmé', en: 'Payment confirmed' },
  finaliser: { fr: 'Finaliser la commande', en: 'Complete your order' },
  paiementInterrompu: { fr: 'Paiement interrompu', en: 'Payment interrupted' },
  paiementEchoue: {
    fr: "Le paiement n'a pas abouti.",
    en: "The payment didn't go through.",
  },
  reessayer: { fr: 'Réessayer', en: 'Try again' },

  tesCoordonnees: { fr: 'Tes coordonnées', en: 'Your details' },
  tonNom: { fr: 'Ton nom', en: 'Your name' },
  tonEmail: { fr: 'Ton email', en: 'Your email' },
  emailAstuce: {
    fr: "C'est là que le lien de téléchargement sera envoyé. Vérifie-le bien.",
    en: 'This is where your download link will be sent. Double-check it.',
  },

  tonPaiement: { fr: 'Ton paiement mobile money', en: 'Your mobile money payment' },
  chargementMoyens: {
    fr: 'Chargement des moyens de paiement…',
    en: 'Loading payment methods…',
  },
  aucunMoyen: {
    fr: "Aucun moyen de paiement n'est disponible pour le moment.",
    en: 'No payment method is available at the moment.',
  },

  tonPays: { fr: 'Ton pays', en: 'Your country' },
  paysDetecte: {
    fr: "Détecté automatiquement. Change-le si ce n'est pas le bon.",
    en: "Detected automatically. Change it if it's not right.",
  },
  choisisPays: { fr: 'Choisis ton pays', en: 'Choose your country' },

  tonNumero: { fr: 'Ton numéro mobile money', en: 'Your mobile money number' },
  numeroAstuce: {
    fr: "Sans l'indicatif, il est déjà devant.",
    en: "Without the country code — it's already there.",
  },
  numeroInvalide: {
    fr: (pays: string) => `Ce numéro ne semble pas valide pour ${pays}.`,
    en: (pays: string) => `This number doesn't look valid for ${pays}.`,
  },

  tonOperateur: { fr: 'Ton opérateur', en: 'Your provider' },
  codeAutorisation: { fr: "Code d'autorisation", en: 'Authorisation code' },
  codeAutorisationAstuce: {
    fr: (nom: string) =>
      `${nom} demande un code à générer depuis ton téléphone avant de payer.`,
    en: (nom: string) =>
      `${nom} requires a code generated from your phone before you can pay.`,
  },
  composerIci: { fr: 'Composer depuis ce téléphone', en: 'Dial from this phone' },

  envoiDemande: { fr: 'Envoi de la demande…', en: 'Sending the request…' },
  payer: {
    fr: (montant: string) => `Payer ${montant}`,
    en: (montant: string) => `Pay ${montant}`,
  },
  rassurance: {
    fr: "Une demande de paiement arrivera sur ton téléphone. Rien n'est débité avant que tu ne composes ton code PIN.",
    en: 'A payment request will arrive on your phone. Nothing is charged until you enter your PIN.',
  },

  // --- Attente ---
  attenteTitre: { fr: 'En attente de ta confirmation', en: 'Waiting for your confirmation' },
  suisLesEtapes: {
    fr: 'Suis les étapes ci-dessous sur ton téléphone.',
    en: 'Follow the steps below on your phone.',
  },
  demandePin: {
    fr: 'Une demande de code PIN arrive sur ton téléphone.',
    en: 'A PIN request is on its way to your phone.',
  },
  auNomDe: {
    fr: (marchand: string) =>
      `Elle s'affiche au nom de « ${marchand} ». Compose ton code PIN pour valider.`,
    en: (marchand: string) =>
      `It shows up as “${marchand}”. Enter your PIN to confirm.`,
  },
  composePin: {
    fr: 'Compose ton code PIN pour valider le paiement.',
    en: 'Enter your PIN to confirm the payment.',
  },
  neFermePas: {
    fr: 'Cette page se met à jour toute seule, ne la ferme pas.',
    en: "This page updates on its own — don't close it.",
  },
  expire: {
    fr: "Toujours rien après cinq minutes. L'invite de code PIN a probablement expiré. Si tu as bien payé, l'email de téléchargement arrivera quand même — vérifie ta boîte de réception.",
    en: 'Still nothing after five minutes. The PIN prompt has probably expired. If you did pay, the download email will arrive anyway — check your inbox.',
  },
  recommencer: { fr: 'Recommencer le paiement', en: 'Start the payment over' },

  // --- Payé ---
  cestRegle: { fr: "C'est réglé", en: 'All set' },
  merciAchat: {
    fr: (titre: string, email: string) =>
      `Merci ! Ton paiement est confirmé et « ${titre} » t'attend. Le lien a aussi été envoyé${
        email ? ` à ${email}` : ' par email'
      }, tu peux y revenir pendant 7 jours.`,
    en: (titre: string, email: string) =>
      `Thank you! Your payment is confirmed and “${titre}” is waiting for you. The link was also sent${
        email ? ` to ${email}` : ' by email'
      }, and stays good for 7 days.`,
  },
  telechargerMaintenant: { fr: 'Télécharger maintenant', en: 'Download now' },

  // --- Page de confirmation ---
  merciTitre: { fr: 'Paiement réussi', en: 'Payment successful' },
  merciSousTitre: {
    fr: (titre: string) => `« ${titre} » est à toi. Télécharge-le maintenant.`,
    en: (titre: string) => `“${titre}” is yours. Download it now.`,
  },
  merciEnvoye: {
    fr: (email: string) =>
      `Le lien a aussi été envoyé à ${email}. Il reste valable 7 jours.`,
    en: (email: string) =>
      `The link was also sent to ${email}. It stays valid for 7 days.`,
  },
  merciEnvoyeSansEmail: {
    fr: 'Le lien a aussi été envoyé par email. Il reste valable 7 jours.',
    en: 'The link was also sent by email. It stays valid for 7 days.',
  },
  merciEnregistre: {
    fr: 'Enregistre le fichier sur ton appareil dès qu’il s’ouvre.',
    en: 'Save the file to your device as soon as it opens.',
  },
  merciPasRecu: { fr: "Tu n'as pas reçu l'email ?", en: "Didn't get the email?" },
  merciSpamIntro: {
    fr: 'Neuf fois sur dix, il est arrivé mais il est rangé ailleurs. Cherche-le :',
    en: 'Nine times out of ten it arrived but got filed elsewhere. Look for it:',
  },
  merciSpamGmail: {
    fr: 'Gmail : ouvre le menu à gauche, descends jusqu’à « Spam », puis regarde aussi dans l’onglet « Promotions ».',
    en: 'Gmail: open the left menu, scroll down to “Spam”, then also check the “Promotions” tab.',
  },
  merciSpamAutres: {
    fr: 'Yahoo, Outlook, Hotmail : le dossier s’appelle « Courrier indésirable ».',
    en: 'Yahoo, Outlook, Hotmail: the folder is called “Junk”.',
  },
  merciSpamRecherche: {
    fr: (nom: string) => `Ou cherche « ${nom} » dans la barre de recherche de ta boîte mail.`,
    en: (nom: string) => `Or search for “${nom}” in your mailbox search bar.`,
  },
  merciAide: {
    fr: (email: string) => `Toujours rien ? Écris à ${email}, on te renvoie le fichier.`,
    en: (email: string) => `Still nothing? Write to ${email} and we'll resend the file.`,
  },
  merciVerification: { fr: 'Vérification du paiement…', en: 'Checking your payment…' },
  merciIntrouvable: {
    fr: "Cette commande n'existe pas.",
    en: "This order doesn't exist.",
  },

  // --- Récapitulatif ---
  taCommande: { fr: 'Ta commande', en: 'Your order' },
  leProduit: { fr: 'Le produit', en: 'The product' },
  prixHabituel: { fr: 'Prix habituel', en: 'Usual price' },
  remise: { fr: 'Remise', en: 'Discount' },
  fraisPaiement: { fr: 'Frais de paiement', en: 'Payment fee' },
  total: { fr: 'Total', en: 'Total' },

  // --- Pied de page ---
  choixLangue: { fr: 'Langue', en: 'Language' },
} as const

/**
 * Le texte dans la langue courante.
 *
 * Le type de retour est celui de la version française : les deux versions ayant
 * la même forme, une entrée à paramètres reste une fonction typée, et oublier
 * un paramètre est une erreur de compilation.
 */
export function useLangue() {
  const langue = useSyncExternalStore(sAbonner, () => courante, () => 'fr' as Langue)

  function t<K extends keyof typeof TEXTES>(cle: K): (typeof TEXTES)[K]['fr'] {
    return TEXTES[cle][langue] as (typeof TEXTES)[K]['fr']
  }

  return { langue, setLangue, t }
}
