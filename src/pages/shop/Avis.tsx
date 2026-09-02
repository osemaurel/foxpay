import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { callFunction } from '../../lib/supabase'
import { useLangue } from '../../lib/i18n'
import { Alert, Eyebrow, Spinner } from '../../components/ui'

/**
 * La page où l'acheteur dépose son avis, un jour après son achat.
 *
 * Rien à créer, rien à retenir : l'identifiant de commande dans l'adresse suffit
 * — c'est déjà lui qui donne accès au fichier. Quelqu'un qui vient de payer
 * n'ouvrira pas un compte pour dire ce qu'il a pensé, et le lui demander
 * reviendrait à n'avoir aucun avis.
 *
 * Les étoiles sont de vrais boutons radio sous une apparence d'étoiles : au
 * clavier comme au lecteur d'écran, c'est un choix parmi cinq, pas un dessin.
 *
 * La note part seule si l'acheteur n'écrit rien. Beaucoup donnent quatre
 * étoiles et s'en vont, et quatre étoiles valent mieux que rien.
 */
type Etat = {
  product_title: string
  deja_donne: boolean
  whatsapp_url: string | null
}

const NOTES = [1, 2, 3, 4, 5] as const

export default function Avis() {
  const { slug } = useParams<{ slug: string }>()
  const [params] = useSearchParams()
  const { t } = useLangue()

  const orderId = params.get('order')
  const [etat, setEtat] = useState<Etat | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const [note, setNote] = useState(0)
  const [commentaire, setCommentaire] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [envoye, setEnvoye] = useState(false)

  useEffect(() => {
    if (!orderId) {
      setErreur(t('avisIntrouvable'))
      return
    }

    let annule = false
    callFunction<Etat>('avis', { action: 'etat', order_id: orderId })
      .then((r) => {
        if (annule) return
        setEtat(r)
        setEnvoye(r.deja_donne)
      })
      .catch(() => !annule && setErreur(t('avisIntrouvable')))

    return () => {
      annule = true
    }
  }, [orderId])

  async function envoyer() {
    if (!orderId || note === 0 || envoi) return
    setEnvoi(true)
    setErreur(null)

    try {
      await callFunction('avis', {
        action: 'envoyer',
        order_id: orderId,
        rating: note,
        body: commentaire.trim() || undefined,
      })
      setEnvoye(true)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : t('avisEchec'))
    } finally {
      setEnvoi(false)
    }
  }

  if (erreur && !etat) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Alert kind="error">{erreur}</Alert>
        <Retour slug={slug} label={t('retourCatalogue')} />
      </div>
    )
  }

  if (!etat) {
    return (
      <div className="py-16">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-10">
      {envoye ? (
        <section className="space-y-4 rounded-2xl border border-line bg-card p-6 text-center sm:p-8">
          <span
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-go/15 text-2xl text-go"
            aria-hidden="true"
          >
            ✓
          </span>
          <Eyebrow>{t('avisMerciTitre')}</Eyebrow>
          <p className="text-sm leading-relaxed text-ink-muted">{t('avisMerciTexte')}</p>
        </section>
      ) : (
        <section className="space-y-6 rounded-2xl border border-line bg-card p-6 sm:p-8">
          <div className="space-y-2">
            <Eyebrow>{t('monAvisTitre')}</Eyebrow>
            <h1 className="text-xl font-medium text-ink">
              {t('avisSousTitre')(etat.product_title)}
            </h1>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm text-ink-muted">{t('avisNote')}</legend>
            <div className="flex justify-center gap-1">
              {NOTES.map((valeur) => (
                <label
                  key={valeur}
                  className="cursor-pointer p-1 text-3xl transition hover:scale-110"
                  title={t('avisEtoiles')(valeur)}
                >
                  <input
                    type="radio"
                    name="note"
                    value={valeur}
                    checked={note === valeur}
                    onChange={() => setNote(valeur)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={valeur <= note ? 'text-amber-400' : 'text-line'}
                  >
                    ★
                  </span>
                  <span className="sr-only">{t('avisEtoiles')(valeur)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <label htmlFor="commentaire" className="block text-sm text-ink-muted">
              {t('avisCommentaire')}
            </label>
            <textarea
              id="commentaire"
              rows={4}
              maxLength={2000}
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              placeholder={t('avisCommentairePlace')}
              className="w-full rounded-xl border border-line bg-raise px-3.5 py-2.5 text-ink placeholder:text-ink-faint outline-none transition focus:border-[var(--accent)]"
            />
          </div>

          {erreur && <Alert kind="error">{erreur}</Alert>}

          <button
            type="button"
            onClick={envoyer}
            disabled={note === 0 || envoi}
            className="w-full rounded-xl bg-ink px-6 py-4 text-base font-medium text-canvas transition hover:opacity-90 disabled:opacity-40"
          >
            {envoi ? t('avisEnvoi') : t('avisEnvoyer')}
          </button>

          <p className="text-center text-xs leading-relaxed text-ink-faint">{t('avisPrive')}</p>
        </section>
      )}

      {/* Un acheteur dont le fichier ne s'ouvre pas n'a que faire d'un
          formulaire à étoiles : il lui faut quelqu'un au bout du fil. */}
      {etat.whatsapp_url && (
        <section className="space-y-3 rounded-2xl border border-line bg-raise p-6">
          <h2 className="text-sm font-medium text-ink">{t('avisProblemeTitre')}</h2>
          <p className="text-sm leading-relaxed text-ink-muted">{t('avisProblemeTexte')}</p>
          <a
            href={etat.whatsapp_url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl bg-[#25d366] px-6 py-3.5 text-center text-sm font-medium text-[#0b3d20] transition hover:opacity-90"
          >
            {t('avisWhatsapp')}
          </a>
        </section>
      )}

      <Retour slug={slug} label={t('retourCatalogue')} />
    </div>
  )
}

function Retour({ slug, label }: { slug: string | undefined; label: string }) {
  return (
    <Link
      to={`/boutique/${slug}`}
      className="block text-center text-sm text-ink-faint underline underline-offset-2 hover:text-ink"
    >
      {label}
    </Link>
  )
}
