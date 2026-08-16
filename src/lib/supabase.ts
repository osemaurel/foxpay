import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont requis. Copie .env.example vers .env.',
  )
}

export const supabase = createClient(url, anonKey)

/** Appelle une Edge Function et remonte le message d'erreur du serveur. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`)
  return json as T
}
