/**
 * Sortie par adresse IP fixe.
 *
 * SebPay n'autorise ses clés API que depuis des adresses déclarées, or les Edge
 * Functions sortent d'un parc tournant : six appels d'affilée partent de six
 * adresses différentes. Les appels vers SebPay passent donc par un relais
 * (Fixie), qui leur donne deux adresses stables.
 *
 * pawaPay ne passe pas par là : il n'a pas de liste blanche, et le relais est
 * facturé à la requête — autant ne pas dépenser le quota pour rien.
 *
 * Deno n'honore pas HTTP_PROXY tout seul, d'où le client explicite.
 */

let client: unknown | null | undefined

/**
 * Le client mandaté, ou null si aucun relais n'est configuré.
 * Construit une seule fois : l'objet est réutilisable entre les requêtes.
 */
function relais(): unknown | null {
  if (client !== undefined) return client

  const url = Deno.env.get('FIXIE_URL')
  const creer = (Deno as unknown as Record<string, unknown>).createHttpClient as
    | ((options: unknown) => unknown)
    | undefined

  if (!url || typeof creer !== 'function') {
    client = null
    return client
  }

  const u = new URL(url)
  client = creer({
    proxy: {
      url: `${u.protocol}//${u.host}`,
      basicAuth: {
        username: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
      },
    },
  })
  return client
}

/**
 * `fetch`, mais en sortant par l'adresse fixe quand elle est configurée.
 *
 * Sans relais configuré, l'appel part en direct : c'est ce qu'on veut en
 * développement, et ça évite qu'une variable oubliée fasse tomber la boutique.
 * SebPay, lui, répondra IP_NOT_ALLOWED — une erreur claire, pas un mystère.
 */
export function fetchViaIpFixe(input: string | URL, init?: RequestInit): Promise<Response> {
  const c = relais()
  return c ? fetch(input, { ...init, client: c } as RequestInit) : fetch(input, init)
}

/** Vrai si un relais est configuré, pour le signaler dans les diagnostics. */
export const ipFixeConfiguree = () => relais() !== null
