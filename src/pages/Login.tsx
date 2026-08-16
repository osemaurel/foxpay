import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alert, Button, Card, Field, inputClass } from '../components/ui'

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

    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (error) setError(error.message)
    else if (mode === 'signup') setNotice('Compte créé. Vérifie tes emails si une confirmation est demandée.')
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-bold text-slate-900">Administration</h1>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Mot de passe">
              <input
                type="password"
                required
                minLength={8}
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
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
            className="mt-4 w-full text-sm text-slate-500 hover:text-slate-800"
          >
            {mode === 'signin' ? 'Créer un compte' : "J'ai déjà un compte"}
          </button>
        </Card>
      </div>
    </div>
  )
}
