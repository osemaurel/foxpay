import { supabase } from './supabase'

/**
 * Convention de chemin partagée avec les policies Storage : <shop_id>/<fichier>.
 * Le nom porte un suffixe aléatoire pour qu'un remplacement ne soit pas masqué
 * par le cache CDN.
 */
function buildPath(shopId: string, kind: string, file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  return `${shopId}/${kind}-${crypto.randomUUID()}.${ext}`
}

/** Upload dans le bucket public shop-assets et renvoie l'URL publique. */
export async function uploadPublicAsset(
  shopId: string,
  kind: 'logo' | 'banner' | 'cover',
  file: File,
): Promise<string> {
  const path = buildPath(shopId, kind, file)
  const { error } = await supabase.storage.from('shop-assets').upload(path, file)
  if (error) throw error
  return supabase.storage.from('shop-assets').getPublicUrl(path).data.publicUrl
}

/**
 * Upload dans le bucket privé product-files. Renvoie le chemin, jamais une URL :
 * le fichier n'est servi qu'via une URL signée générée après paiement.
 */
export async function uploadProductFile(
  shopId: string,
  file: File,
): Promise<{ path: string; name: string; size: number }> {
  const path = buildPath(shopId, 'file', file)
  const { error } = await supabase.storage.from('product-files').upload(path, file)
  if (error) throw error
  return { path, name: file.name, size: file.size }
}
