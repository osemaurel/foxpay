import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Variables absentes du build, s'il y en a.
 *
 * On ne lève PAS d'exception ici : une erreur au chargement du module empêche
 * React de monter et produit une page blanche sans explication. App.tsx lit
 * cette liste et affiche un écran qui dit quoi faire.
 *
 * Vite remplace import.meta.env au moment du build : ces variables doivent
 * exister avant `npm run build`, pas seulement au démarrage du serveur.
 */
export const missingEnv: string[] = [
  url ? null : 'VITE_SUPABASE_URL',
  anonKey ? null : 'VITE_SUPABASE_ANON_KEY',
].filter((name): name is string => name !== null)

export const supabase = createClient(
  url ?? 'https://absent.supabase.co',
  anonKey ?? 'absent',
)

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
