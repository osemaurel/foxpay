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

/**
 * Lien de téléchargement envoyé à l'acheteur : il pointe sur la fonction
 * download.
 *
 * La langue voyage dans l'adresse plutôt que d'être relue en base : la page ne
 * s'affiche qu'en cas de refus — lien expiré, quota atteint — et aller chercher
 * une commande pour choisir la langue d'un message d'erreur serait un aller-
 * retour pour rien. Un paramètre trafiqué ne change que la langue du message.
 */
export const downloadUrl = (token: string, langue: 'fr' | 'en' = 'fr') =>
  `${requireEnv('SUPABASE_URL')}/functions/v1/download?token=${token}&lang=${langue}`
