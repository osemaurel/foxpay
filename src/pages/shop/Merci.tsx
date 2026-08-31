import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { callFunction } from '../../lib/supabase'
import { useLangue } from '../../lib/i18n'
import { Alert, Eyebrow, Spinner } from '../../components/ui'
import { useShop } from './ShopLayout'

/**
 * La page où atterrit un acheteur dont le paiement vient d'aboutir.
 *
 * Avant, la page de paiement se transformait sur place : le compte à rebours
 * s'arrêtait, une carte remplaçait le formulaire, et c'était tout. Trop de gens
 * ne voyaient pas que quelque chose avait changé — ils avaient regardé leur
 * téléphone pour composer leur code, et en revenant ils ne comprenaient pas où
 * ils en étaient. D'où une adresse à eux, une vraie page, et un bouton qui est
 * la seule chose à faire.
 *
 * L'identifiant de commande dans l'adresse est un UUID imprévisible : c'est lui
 * qui autorise à afficher le lien de téléchargement sans demander de compte.
 * C'est déjà le mécanisme du suivi de paiement, rien de nouveau ici.
 *
 * La page se recharge sans rien perdre — elle redemande l'état au serveur — et
 * peut donc être mise en favori, rouverte le lendemain, ou partagée sur le même
 * téléphone entre le navigateur intégré d'une application et le vrai navigateur.
 */
type Reponse = {
  status: 'pending' | 'paid' | 'failed' | 'cancelled'
  download_url: string | null
  buyer_email: string | null
  product_title: string | null
  message: string | null
}

export default function Merci() {
  const { shop } = useShop()
  const { slug } = useParams<{ slug: string }>()
  const [params] = useSearchParams()
  const { t } = useLangue()

  const orderId = params.get('order')
  const [reponse, setReponse] = useState<Reponse | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    if (!orderId) {
      setErreur(t('merciIntrouvable'))
      return
    }

    let annule = false
    callFunction<Reponse>('order-status', { order_id: orderId })
      .then((r) => !annule && setReponse(r))
      .catch(() => !annule && setErreur(t('merciIntrouvable')))

    return () => {
      annule = true
    }
  }, [orderId])

  if (erreur) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Alert kind="error">{erreur}</Alert>
        <Link
          to={`/boutique/${slug}`}
          className="mt-4 inline-block text-sm text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          {t('retourCatalogue')}
        </Link>
      </div>
    )
  }

  if (!reponse) {
    return (
      <div className="py-16">
        <Spinner />
        <p className="mt-4 text-center text-sm text-ink-faint">{t('merciVerification')}</p>
      </div>
    )
  }

  const contact = shop.contact_email

  return (
    <div className="mx-auto max-w-lg space-y-6 py-10">
      <section className="space-y-5 rounded-2xl border border-line bg-card p-6 text-center sm:p-8">
        {/* Une coche, pas une illustration : elle se lit en un dixième de
            seconde, y compris sur un écran de téléphone en plein soleil. */}
        <span
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-go/15 text-2xl text-go"
          aria-hidden="true"
        >
          ✓
        </span>

        <div className="space-y-2">
          <Eyebrow>{t('merciTitre')}</Eyebrow>
          {reponse.product_title && (
            <h1 className="text-xl font-medium text-ink">
              {t('merciSousTitre')(reponse.product_title)}
            </h1>
          )}
        </div>

        {reponse.download_url && (
          <a
            href={reponse.download_url}
            className="inline-flex w-full items-center justify-center rounded-xl bg-ink px-6 py-4 text-base font-medium text-canvas transition hover:opacity-90"
          >
            {t('telechargerMaintenant')}
          </a>
        )}

        <p className="text-sm leading-relaxed text-ink-muted">
          {reponse.buyer_email
            ? t('merciEnvoye')(reponse.buyer_email)
            : t('merciEnvoyeSansEmail')}
        </p>
        <p className="text-xs leading-relaxed text-ink-faint">{t('merciEnregistre')}</p>
      </section>

      {/* Le mode d'emploi des indésirables : c'est là que finit le courrier de
          la plupart de ceux qui écrivent « je n'ai rien reçu ». */}
      <section className="space-y-3 rounded-2xl border border-line bg-raise p-6">
        <h2 className="text-sm font-medium text-ink">{t('merciPasRecu')}</h2>
        <p className="text-sm leading-relaxed text-ink-muted">{t('merciSpamIntro')}</p>
        <ul className="space-y-2 text-sm leading-relaxed text-ink-muted">
          <li className="flex gap-2">
            <span className="text-ink-faint">•</span>
            {t('merciSpamGmail')}
          </li>
          <li className="flex gap-2">
            <span className="text-ink-faint">•</span>
            {t('merciSpamAutres')}
          </li>
          <li className="flex gap-2">
            <span className="text-ink-faint">•</span>
            {t('merciSpamRecherche')(shop.name)}
          </li>
        </ul>
        {contact && (
          <p className="pt-1 text-sm leading-relaxed text-ink-muted">
            {t('merciAide')(contact)}
          </p>
        )}
      </section>

      <Link
        to={`/boutique/${slug}`}
        className="block text-center text-sm text-ink-faint underline underline-offset-2 hover:text-ink"
      >
        {t('retourCatalogue')}
      </Link>
    </div>
  )
}
