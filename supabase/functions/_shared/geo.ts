/**
 * Détection du pays de l'acheteur, à partir de son adresse IP.
 *
 * Elle sert uniquement à présélectionner le bon pays sur la page de paiement,
 * pour que l'indicatif et les opérateurs s'affichent tout de suite. Ce n'est
 * jamais une décision : l'acheteur peut changer de pays, et c'est ce qu'il
 * choisit qui compte pour le paiement.
 *
 * L'IP est envoyée à un service de géolocalisation, mais n'est stockée nulle
 * part — ni chez nous, ni sur la commande.
 */

/**
 * Correspondance ISO alpha-2 → alpha-3, limitée aux pays couverts par l'un des
 * deux processeurs. Traduire ne présélectionne rien : c'est la page de paiement
 * qui ne retient le pays deviné que si la boutique y vend vraiment. Un acheteur
 * ailleurs n'est pas « mal détecté », il choisit simplement son pays lui-même.
 */
const ALPHA2_TO_ALPHA3: Record<string, string> = {
  BJ: 'BEN',
  BF: 'BFA',
  CD: 'COD',
  CG: 'COG',
  CI: 'CIV',
  CM: 'CMR',
  GA: 'GAB',
  GH: 'GHA',
  GM: 'GMB',
  GN: 'GIN',
  GW: 'GNB',
  KE: 'KEN',
  ML: 'MLI',
  NE: 'NER',
  NG: 'NGA',
  SN: 'SEN',
  TG: 'TGO',
  TZ: 'TZA',
  UG: 'UGA',
}

/** Une réponse lente vaut une réponse absente : la page ne doit pas attendre. */
const TIMEOUT_MS = 1500
const TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 500

const cache = new Map<string, { code: string | null; at: number }>()

function isPrivate(ip: string): boolean {
  return (
    ip.startsWith('10.') ||
    ip.startsWith('127.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('::1') ||
    ip.startsWith('fc') ||
    ip.startsWith('fd') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  )
}

/**
 * L'IP réelle de l'acheteur. Cloudflare est devant Supabase et renseigne
 * `cf-connecting-ip` ; les autres en-têtes sont des replis.
 */
export function clientIp(req: Request): string | null {
  const candidate =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('sb-forwarded-for') ??
    req.headers.get('x-forwarded-for')?.split(',')[0] ??
    ''

  const ip = candidate.trim()
  if (!ip || isPrivate(ip)) return null
  return ip
}

function readCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null
}

async function ipwhois(ip: string): Promise<string | null> {
  const res = await fetch(`https://ipwho.is/${ip}?fields=country_code`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null
  return readCode((await res.json()).country_code)
}

async function countryIs(ip: string): Promise<string | null> {
  const res = await fetch(`https://api.country.is/${ip}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null
  return readCode((await res.json()).country)
}

/**
 * Le pays de l'acheteur en ISO alpha-3, ou null si on n'en sait rien.
 *
 * Deux services indépendants : le premier est le plus rapide, le second prend
 * le relais s'il tombe. Une panne des deux n'empêche pas de payer — la page
 * demande simplement son pays à l'acheteur, comme avant.
 */
export async function detectCountry(req: Request): Promise<string | null> {
  const ip = clientIp(req)
  if (!ip) return null

  const hit = cache.get(ip)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.code

  let alpha2: string | null = null
  try {
    alpha2 = await ipwhois(ip)
  } catch {
    // Silencieux : on tente le second service.
  }

  if (!alpha2) {
    try {
      alpha2 = await countryIs(ip)
    } catch {
      // Tant pis.
    }
  }

  const code = alpha2 ? (ALPHA2_TO_ALPHA3[alpha2] ?? null) : null

  // Purge grossière : cette mémoire ne vit que le temps d'une instance.
  if (cache.size >= MAX_ENTRIES) cache.clear()
  cache.set(ip, { code, at: Date.now() })

  return code
}
