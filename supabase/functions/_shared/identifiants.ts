import { admin, requireEnv } from './admin.ts'
import type { Processeur } from './catalogue.ts'

/**
 * Quelles clés servent à encaisser, et pour le compte de qui.
 *
 * C'est le point où se joue la séparation entre vendeurs. Une clé lue
 * globalement ferait tomber l'argent d'une boutique sur le compte d'une autre :
 * tout ce fichier existe pour que cela ne puisse pas arriver par distraction.
 *
 * Deux régimes, et un seul les sépare :
 *
 *   - la boutique porte `identifiants_plateforme` — c'est la boutique
 *     d'origine, celle dont les clés sont les secrets d'environnement ;
 *   - toutes les autres n'encaissent qu'avec **leurs propres** clés, déposées
 *     dans le coffre. Sans clé déposée, elles n'encaissent pas du tout.
 *
 * Ce second cas est volontairement sec. Retomber « par défaut » sur les clés de
 * la plateforme serait commode et catastrophique : une boutique neuve
 * encaisserait chez quelqu'un d'autre sans que personne ne s'en aperçoive.
 */

export type Identifiants = {
  apiKey: string
  /** Absent tant que le vendeur n'a pas collé son secret de webhook. */
  webhookSecret: string | null
}

type Regime = {
  plateforme: boolean
  /** Les processeurs pour lesquels une clé existe. Vide si aucun. */
  avecCle: Set<Processeur>
}

const TOUS: Processeur[] = ['pawapay', 'sebpay', 'saspay']

async function regime(shopId: string): Promise<Regime> {
  const { data: shop, error: erreurShop } = await admin
    .from('shops')
    .select('identifiants_plateforme')
    .eq('id', shopId)
    .maybeSingle()

  // Une panne de lecture doit se voir. Renvoyer « aucun processeur » couperait
  // tous les paiements de toutes les boutiques sans rien dire à personne :
  // mieux vaut une erreur franche, que l'appelant traduit en « moyens de
  // paiement momentanément indisponibles ».
  if (erreurShop) throw erreurShop

  if (shop?.identifiants_plateforme) {
    return { plateforme: true, avecCle: new Set(TOUS) }
  }

  const { data, error } = await admin
    .from('shop_processor_credentials')
    .select('processor, api_key_id')
    .eq('shop_id', shopId)

  if (error) throw error

  const avecCle = new Set<Processeur>()
  for (const ligne of data ?? []) {
    if (ligne.api_key_id) avecCle.add(ligne.processor as Processeur)
  }

  return { plateforme: false, avecCle }
}

/**
 * Les processeurs que cette boutique a le droit d'utiliser.
 *
 * Le routage s'y conforme : une méthode dont aucun processeur autorisé ne peut
 * s'occuper n'est ni proposée à l'acheteur, ni acceptée si la requête est
 * forgée.
 */
export async function processeursAutorises(shopId: string): Promise<Set<Processeur>> {
  return (await regime(shopId)).avecCle
}

/**
 * Les identifiants SasPay de cette boutique — les siens, ou ceux de la
 * plateforme si c'est la boutique d'origine. `null` quand elle n'en a pas :
 * l'appelant doit alors renoncer, jamais se rabattre ailleurs.
 */
export async function identifiantsSaspay(shopId: string): Promise<Identifiants | null> {
  const { plateforme } = await regime(shopId)

  if (plateforme) {
    return {
      apiKey: requireEnv('SASPAY_API_KEY'),
      webhookSecret: Deno.env.get('SASPAY_WEBHOOK_SECRET') ?? null,
    }
  }

  const { data, error } = await admin.rpc('lire_identifiants_processeur', {
    p_shop: shopId,
    p_processor: 'saspay',
  })

  if (error) {
    console.error('identifiants saspay', error)
    return null
  }

  const ligne = (data ?? [])[0] as { api_key: string | null; webhook_secret: string | null } | undefined
  if (!ligne?.api_key) return null

  return { apiKey: ligne.api_key, webhookSecret: ligne.webhook_secret }
}

/**
 * La clé SasPay de la plateforme, pour ce qui ne concerne aucune vente en
 * particulier : la lecture du catalogue des pays et des réseaux. Ce catalogue
 * est le même pour tous les marchands SasPay, il n'a pas à être rechargé par
 * boutique.
 */
export const cleCataloguePlateforme = () => requireEnv('SASPAY_API_KEY')
