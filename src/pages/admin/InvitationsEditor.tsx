import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Alert, Button, Card, Field, inputClass } from '../../components/ui'

/**
 * Les invitations : la seule façon d'ouvrir un compte sur la plateforme.
 *
 * L'inscription publique est fermée. Créer une invitation produit un lien à
 * remettre à la personne — elle l'ouvre, choisit son mot de passe, et se
 * retrouve avec son propre espace et sa propre boutique.
 *
 * Cet écran n'est visible que par le propriétaire de la plateforme. Les
 * fonctions qu'il appelle le revérifient chacune de leur côté : masquer une
 * carte ne protège rien, ce sont elles qui décident.
 */

type Invitation = {
  /** Nul dès qu'elle a servi : le code n'a plus à circuler. */
  code: string | null
  note: string | null
  created_at: string
  used_at: string | null
  utilisee_par: string | null
}

const dateLisible = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

export default function InvitationsEditor() {
  const [liste, setListe] = useState<Invitation[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [copie, setCopie] = useState<string | null>(null)

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('lister_invitations')
    if (error) setErreur(error.message)
    else setListe((data ?? []) as Invitation[])
  }, [])

  useEffect(() => {
    void charger()
  }, [charger])

  const lien = (code: string) => `${window.location.origin}/login?invitation=${code}`

  async function creer(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErreur(null)

    const { error } = await supabase.rpc('creer_invitation', { p_note: note.trim() || null })
    if (error) setErreur(error.message)
    else {
      setNote('')
      await charger()
    }
    setBusy(false)
  }

  async function revoquer(code: string) {
    setErreur(null)
    const { error } = await supabase.rpc('revoquer_invitation', { p_code: code })
    if (error) setErreur(error.message)
    else await charger()
  }

  async function copier(code: string) {
    try {
      await navigator.clipboard.writeText(lien(code))
      setCopie(code)
    } catch {
      // Sur un navigateur qui refuse le presse-papiers, le lien reste affiché
      // juste à côté : il se sélectionne à la main.
      setErreur("Le lien n'a pas pu être copié. Sélectionne-le à la main.")
    }
  }

  return (
    <Card title="Invitations" eyebrow="Accès">
      <p className="mb-6 text-sm leading-relaxed text-ink-muted">
        Personne ne peut créer de compte sans invitation. Chaque lien ne sert qu'une fois, et la
        personne qui l'ouvre choisit elle-même son mot de passe.
      </p>

      <form onSubmit={creer} className="mb-6 space-y-4">
        <Field label="Pour qui ?" hint="Facultatif — juste pour t'y retrouver dans la liste.">
          <input
            placeholder="Awa, Abidjan"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? '…' : 'Créer une invitation'}
        </Button>
      </form>

      {erreur && <Alert kind="error">{erreur}</Alert>}

      {liste.length === 0 ? (
        <p className="text-sm text-ink-faint">Aucune invitation pour l'instant.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {liste.map((i) => (
            <li key={i.code ?? `${i.created_at}-${i.utilisee_par}`} className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{i.note || 'Sans nom'}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Créée le {dateLisible(i.created_at)}
                  </p>
                </div>

                {i.used_at ? (
                  <span className="shrink-0 text-xs text-ink-faint">
                    Utilisée{i.utilisee_par ? ` par ${i.utilisee_par}` : ''}
                  </span>
                ) : (
                  <div className="flex shrink-0 gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => i.code && copier(i.code)}
                      className="text-ink-muted underline underline-offset-2 transition hover:text-ink"
                    >
                      {copie === i.code ? 'Copié' : 'Copier le lien'}
                    </button>
                    <button
                      type="button"
                      onClick={() => i.code && revoquer(i.code)}
                      className="text-ink-faint underline underline-offset-2 transition hover:text-ink"
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </div>

              {i.code && (
                <code className="mt-2 block truncate font-mono text-xs text-ink-faint">
                  {lien(i.code)}
                </code>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
