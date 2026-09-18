import { useCallback, useEffect, useState } from 'react'
import { supabase, urlFonction } from '../../lib/supabase'
import { Alert, Button, Card, Field, inputClass } from '../../components/ui'
import { useAdmin } from './AdminLayout'

/**
 * Le compte SasPay du vendeur : là où arrive l'argent de ses ventes.
 *
 * Deux choses à coller, prises chez SasPay, et une adresse email. La clé sert
 * à demander le paiement ; le secret de webhook sert à reconnaître l'avis de
 * paiement qu'ils nous renvoient — sans lui, la vente n'est confirmée qu'au
 * passage suivant du balayage, avec quelques minutes de retard.
 *
 * Ce que cet écran ne fait jamais, c'est réafficher une clé. Elle part dans le
 * coffre et n'en ressort que côté serveur, au moment d'encaisser. On en montre
 * les quatre derniers caractères : assez pour reconnaître celle qu'on a collée,
 * pas assez pour s'en servir. Un champ laissé vide ne remplace donc rien.
 */

/** Ce que renvoie `etat_identifiants_processeur`, pour le seul SasPay. */
type Etat = {
  processor: string
  api_key_hint: string | null
  webhook_configure: boolean
  email_recus: string | null
  updated_at: string
}

export default function PaiementsEditor() {
  const { shop } = useAdmin()

  const [etat, setEtat] = useState<Etat | null>(null)
  const [cle, setCle] = useState('')
  const [secret, setSecret] = useState('')
  const [recus, setRecus] = useState('')
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enregistre, setEnregistre] = useState(false)
  const [adresseCopiee, setAdresseCopiee] = useState(false)

  // La même pour toutes les boutiques : c'est le secret déposé ici qui dit de
  // laquelle vient chaque avis de paiement.
  const adresseWebhook = urlFonction('saspay-callback')

  const charger = useCallback(async () => {
    const { data } = await supabase.rpc('etat_identifiants_processeur', { p_shop: shop.id })
    const ligne = ((data ?? []) as Etat[]).find((l) => l.processor === 'saspay') ?? null
    setEtat(ligne)
    setRecus(ligne?.email_recus ?? '')
  }, [shop.id])

  useEffect(() => {
    void charger()
  }, [charger])

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErreur(null)

    const { error } = await supabase.rpc('enregistrer_identifiants_processeur', {
      p_shop: shop.id,
      p_processor: 'saspay',
      // Les champs vides partent en `null` : la fonction garde alors la clé
      // déjà en place plutôt que de l'effacer.
      p_api_key: cle.trim() || null,
      p_webhook_secret: secret.trim() || null,
      p_email_recus: recus.trim() || null,
    })

    if (error) {
      setErreur(error.message)
    } else {
      // Les champs se vident : ce qui vient d'être collé est dans le coffre, et
      // le laisser à l'écran donnerait à croire qu'on peut le relire.
      setCle('')
      setSecret('')
      setEnregistre(true)
      await charger()
    }
    setBusy(false)
  }

  return (
    <Card title="Paiements" eyebrow="SasPay">
      {shop.identifiants_plateforme ? (
        <p className="mb-6 text-sm leading-relaxed text-ink-muted">
          Cette boutique encaisse avec le compte SasPay de la plateforme. Il n'y a pas de clé à
          déposer ici.
        </p>
      ) : (
        <p className="mb-6 text-sm leading-relaxed text-ink-muted">
          Tes ventes arrivent sur <strong>ton</strong> compte SasPay, jamais sur un autre. Tant
          qu'aucune clé n'est déposée, le paiement mobile money n'est pas proposé à tes acheteurs.
        </p>
      )}

      <form onSubmit={enregistrer} className="space-y-4">
        {!shop.identifiants_plateforme && (
          <>
            <Field
              label="Clé API"
              hint={
                etat?.api_key_hint
                  ? `Une clé se terminant par …${etat.api_key_hint} est enregistrée. Laisse vide pour la garder.`
                  : 'Copie-la depuis ton tableau de bord SasPay. Elle ne sera plus jamais réaffichée.'
              }
            >
              <input
                type="password"
                autoComplete="off"
                placeholder={etat?.api_key_hint ? '••••••••' : ''}
                value={cle}
                onChange={(e) => {
                  setCle(e.target.value)
                  setEnregistre(false)
                }}
                className={inputClass}
              />
            </Field>

            <div className="rounded-xl border border-line bg-raise p-4">
              <p className="text-sm font-medium text-ink">Adresse à déclarer chez SasPay</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                Crée un webhook chez SasPay avec cette adresse, et <strong>coche les événements
                de transaction</strong> — sans eux, SasPay n'envoie rien et tes ventes sont
                confirmées avec du retard. SasPay t'affiche alors un secret : c'est lui qui va
                dans le champ ci-dessous.
              </p>
              <code className="mt-3 block break-all font-mono text-xs text-ink-muted">
                {adresseWebhook}
              </code>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(adresseWebhook)
                    setAdresseCopiee(true)
                  } catch {
                    setErreur("L'adresse n'a pas pu être copiée. Sélectionne-la à la main.")
                  }
                }}
                className="mt-2 text-sm text-ink-muted underline underline-offset-2 transition hover:text-ink"
              >
                {adresseCopiee ? 'Copiée' : "Copier l'adresse"}
              </button>
            </div>

            <Field
              label="Secret de webhook"
              hint={
                etat?.webhook_configure
                  ? 'Un secret est enregistré. Laisse vide pour le garder.'
                  : 'Sans lui, les ventes sont confirmées avec quelques minutes de retard.'
              }
            >
              <input
                type="password"
                autoComplete="off"
                placeholder={etat?.webhook_configure ? '••••••••' : ''}
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value)
                  setEnregistre(false)
                }}
                className={inputClass}
              />
            </Field>
          </>
        )}

        <Field
          label="Adresse pour les reçus SasPay"
          hint="SasPay envoie son propre reçu à l'adresse qu'on lui donne. Mets la tienne pour que tes acheteurs ne reçoivent pas ce courrier d'un expéditeur qu'ils ne connaissent pas. Vide, c'est l'acheteur qui le reçoit."
        >
          <input
            type="email"
            placeholder="Aucune"
            value={recus}
            onChange={(e) => {
              setRecus(e.target.value)
              setEnregistre(false)
            }}
            className={inputClass}
          />
        </Field>

        {erreur && <Alert kind="error">{erreur}</Alert>}
        {enregistre && <Alert kind="ok">Réglages de paiement enregistrés.</Alert>}

        <Button type="submit" disabled={busy}>
          {busy ? '…' : 'Enregistrer'}
        </Button>
      </form>
    </Card>
  )
}
