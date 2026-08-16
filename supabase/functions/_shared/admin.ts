import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Client service_role : il contourne RLS. C'est volontaire — les commandes ne
 * sont écrites que depuis les Edge Functions, jamais depuis le navigateur.
 */
export const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

export const SITE_URL = () => requireEnv('SITE_URL').replace(/\/+$/, '')

/** Lien de téléchargement envoyé à l'acheteur : il pointe sur la fonction download. */
export const downloadUrl = (token: string) =>
  `${requireEnv('SUPABASE_URL')}/functions/v1/download?token=${token}`
