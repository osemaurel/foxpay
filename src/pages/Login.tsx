import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alert, Button, Card, Field, inputClass } from '../components/ui'

/** Les messages de Supabase Auth sont en anglais : on traduit les plus courants. */
function translate(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.'
  if (m.includes('email not confirmed'))
    return "Ce compte existe mais l'email n'a pas encore été confirmé. Ouvre le lien reçu par email, puis reconnecte-toi."
  if (m.includes('user already registered'))
    return 'Un compte existe déjà avec cet email. Connecte-toi plutôt.'
  if (m.includes('password should be')) return 'Le mot de passe doit faire au moins 8 caractères.'
  if (m.includes('rate limit') || m.includes('too many'))
    return "Trop de tentatives d'envoi d'email. Attends quelques minutes avant de réessayer."
  return message
}

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(translate(error.message))
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(translate(error.message))
      } else if (data.session) {
        // Confirmation désactivée côté projet : on est connecté directement.
        setNotice('Compte créé.')
      } else {
        setNotice(
          `Compte créé. Un email de confirmation a été envoyé à ${email} — ouvre le lien qu'il contient, puis reviens te connecter.`,
        )
      }
    }

    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-bold text-chalk">Administration</h1>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Mot de passe"
              hint={mode === 'signup' ? '8 caractères minimum.' : undefined}
            >
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>

            {error && <Alert kind="error">{error}</Alert>}
            {notice && <Alert kind="ok">{notice}</Alert>}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? '…' : mode === 'signin' ? 'Se connecter' : 'Créer le compte'}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
              setNotice(null)
            }}
            className="mt-4 w-full text-sm text-chalk-faint transition hover:text-chalk"
          >
            {mode === 'signin' ? 'Créer un compte' : "J'ai déjà un compte"}
          </button>
        </Card>
      </div>
    </div>
  )
}
