import { useSearchParams } from 'react-router-dom'
import { useLangue, type Langue } from '../lib/i18n'

/**
 * Ce qu'un acheteur voit quand son lien de téléchargement est refusé.
 *
 * La page vit ici plutôt que dans la fonction `download` : la passerelle des
 * Edge Functions renvoie tout HTML en `text/plain`, une page servie de là-bas
 * s'affiche donc en code source sur le téléphone de l'acheteur. Le site, lui,
 * est un vrai site — et il a déjà le thème et les deux langues.
 *
 * La raison arrive en clair dans l'adresse. Ce n'est pas une information
 * sensible — l'acheteur vient de la vivre — et une valeur inventée retombe sur
 * le message générique.
 */
const MESSAGES: Record<string, Record<Langue, { titre: string; corps: string }>> = {
  not_found: {
    fr: {
      titre: 'Lien inconnu',
      corps: "Ce lien de téléchargement n'existe pas. Vérifie que tu as copié l'adresse complète depuis l'email.",
    },
    en: {
      titre: 'Unknown link',
      corps: "This download link doesn't exist. Check that you copied the full address from the email.",
    },
  },
  not_paid: {
    fr: {
      titre: 'Paiement non confirmé',
      corps: "Nous n'avons pas encore reçu la confirmation de ton paiement. Le lien s'activera dès que l'opérateur nous la transmet.",
    },
    en: {
      titre: 'Payment not confirmed',
      corps: "We haven't received confirmation of your payment yet. The link will work as soon as your provider sends it.",
    },
  },
  expired: {
    fr: {
      titre: 'Lien expiré',
      corps: 'Ce lien était valable 7 jours. Contacte le vendeur pour en obtenir un nouveau.',
    },
    en: {
      titre: 'Link expired',
      corps: 'This link was good for 7 days. Contact the seller to get a new one.',
    },
  },
  exhausted: {
    fr: {
      titre: 'Nombre de téléchargements atteint',
      corps: 'Ce lien a déjà servi le nombre de fois prévu. Contacte le vendeur si tu as perdu le fichier.',
    },
    en: {
      titre: 'Download limit reached',
      corps: 'This link has already been used the number of times allowed. Contact the seller if you lost the file.',
    },
  },
  incomplet: {
    fr: { titre: 'Lien incomplet', corps: "Reprends l'adresse entière depuis l'email." },
    en: { titre: 'Incomplete link', corps: 'Copy the whole address from the email again.' },
  },
  retire: {
    fr: {
      titre: 'Fichier indisponible',
      corps: 'Le fichier a été retiré par le vendeur. Contacte-le pour être livré.',
    },
    en: {
      titre: 'File unavailable',
      corps: 'The seller removed this file. Get in touch with them to receive it.',
    },
  },
  panne: {
    fr: { titre: 'Erreur', corps: 'Réessaie dans un instant.' },
    en: { titre: 'Something went wrong', corps: 'Please try again in a moment.' },
  },
  inaccessible: {
    fr: { titre: 'Erreur', corps: 'Le fichier est momentanément inaccessible. Réessaie dans un instant.' },
    en: { titre: 'Something went wrong', corps: 'The file is temporarily unreachable. Try again in a moment.' },
  },
}

export default function Telechargement() {
  const [params] = useSearchParams()
  const { langue } = useLangue()

  // La langue du lien gagne : l'email a été écrit dans celle-là, et il peut
  // très bien être ouvert sur un autre appareil que celui de l'achat.
  const dulien = params.get('lang')
  const affichee: Langue = dulien === 'fr' || dulien === 'en' ? dulien : langue

  const message = (MESSAGES[params.get('raison') ?? ''] ?? MESSAGES.panne)[affichee]

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <section className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center">
        <h1 className="text-xl font-medium text-ink">{message.titre}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{message.corps}</p>
      </section>
    </main>
  )
}
