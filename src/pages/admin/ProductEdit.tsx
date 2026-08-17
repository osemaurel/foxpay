import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { uploadProductFile, uploadPublicAsset } from '../../lib/upload'
import { formatFileSize, formatPrice } from '../../lib/format'
import { isEmptyHtml } from '../../lib/richText'
import { slugify } from '../../lib/slug'
import {
  Alert,
  Button,
  Card,
  Field,
  fileInputClass,
  ImagePicker,
  inputClass,
} from '../../components/ui'
import ReviewsEditor from './ReviewsEditor'
import { useAdmin } from './AdminLayout'

// L'éditeur ne concerne que le vendeur : il ne doit pas alourdir le bundle
// que télécharge un acheteur sur la page boutique.
const RichTextEditor = lazy(() => import('../../components/RichTextEditor'))

const EMPTY = {
  title: '',
  slug: '',
  description: '' as string | null,
  price: 0,
  compare_at_price: null as number | null,
  cta_label: null as string | null,
  cta_color: null as string | null,
  cover_url: null as string | null,
  file_path: null as string | null,
  file_name: null as string | null,
  file_size: null as number | null,
  is_active: false,
  position: 0,
}

export default function ProductEdit() {
  const { productId } = useParams<{ productId: string }>()
  const { shop, products, reloadProducts } = useAdmin()
  const navigate = useNavigate()

  const existing = products.find((p) => p.id === productId) ?? null
  const isNew = !productId || productId === 'nouveau'

  const [form, setForm] = useState({
    ...EMPTY,
    ...(existing ?? {}),
    position: existing?.position ?? products.length,
  })
  // Le lien suit le titre tant que le produit n'est pas enregistré ; ensuite on
  // ne le touche plus tout seul, sinon un partage déjà fait cesserait de marcher.
  const [slugLocked, setSlugLocked] = useState(!isNew)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!isNew && !existing) {
    return (
      <Card title="Produit introuvable">
        <p className="text-sm text-ink-muted">
          Ce produit n'existe plus.{' '}
          <Link to="/admin/produits" className="underline">
            Retour au catalogue
          </Link>
        </p>
      </Card>
    )
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function pickCover(file: File) {
    setBusy(true)
    setError(null)
    try {
      set('cover_url', await uploadPublicAsset(shop.id, 'cover', file))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  async function pickFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      const uploaded = await uploadProductFile(shop.id, file)
      setForm((f) => ({
        ...f,
        file_path: uploaded.path,
        file_name: uploaded.name,
        file_size: uploaded.size,
      }))
      setSaved(false)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const payload = {
      shop_id: shop.id,
      title: form.title,
      slug: form.slug || slugify(form.title) || 'produit',
      description:
        form.description && !isEmptyHtml(form.description) ? form.description : null,
      price: form.price,
      compare_at_price: form.compare_at_price || null,
      cta_label: form.cta_label?.trim() || null,
      cta_color: form.cta_color || null,
      cover_url: form.cover_url,
      file_path: form.file_path,
      file_name: form.file_name,
      file_size: form.file_size,
      is_active: form.is_active,
      position: form.position,
    }

    const { data, error } = existing
      ? await supabase.from('products').update(payload).eq('id', existing.id).select().single()
      : await supabase.from('products').insert(payload).select().single()

    if (error) {
      setError(
        error.code === '23505'
          ? 'Un autre produit de ta boutique utilise déjà ce lien. Change-le.'
          : error.message,
      )
      setBusy(false)
      return
    }

    await reloadProducts()
    setBusy(false)
    if (existing) {
      setSaved(true)
    } else {
      navigate(`/admin/produits/${data.id}`, { replace: true })
    }
  }

  // Sans fichier, il n'y a rien à livrer : on empêche la mise en vente.
  const canPublish = Boolean(form.file_path) && form.price > 0 && form.title.trim() !== ''

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/admin/produits"
          className="text-sm text-ink-faint transition hover:text-ink"
        >
          ← Catalogue
        </Link>
        {existing && existing.is_active && (
          <a
            href={`/boutique/${shop.slug}/p/${existing.slug}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-ink-faint transition hover:text-ink"
          >
            Voir la page publique ↗
          </a>
        )}
      </div>

      <Card title="Ce que tu vends">
        <form id="product-form" onSubmit={save} className="space-y-4">
          <Field label="Titre">
            <input
              required
              value={form.title}
              onChange={(e) => {
                set('title', e.target.value)
                if (!slugLocked) set('slug', slugify(e.target.value))
              }}
              className={inputClass}
            />
          </Field>

          <Field
            label="Lien du produit"
            hint={`/boutique/${shop.slug}/p/${form.slug || '…'}`}
          >
            <input
              required
              value={form.slug}
              onChange={(e) => {
                setSlugLocked(true)
                set('slug', slugify(e.target.value))
              }}
              className={inputClass}
            />
          </Field>

          <Field
            label="Description"
            hint="Gras, italique, listes, titres. La mise en forme apparaît telle quelle sur la boutique."
          >
            <Suspense
              fallback={<div className="min-h-56 rounded-xl border border-line bg-raise" />}
            >
              <RichTextEditor
                value={form.description ?? ''}
                onChange={(html) => set('description', html)}
              />
            </Suspense>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Prix (FCFA)"
              hint={form.price > 0 ? `Affiché : ${formatPrice(form.price)}` : 'Nombre entier.'}
            >
              <input
                type="number"
                min={0}
                step={1}
                required
                value={form.price}
                onChange={(e) => set('price', Number(e.target.value))}
                className={inputClass}
              />
            </Field>

            <Field
              label="Prix barré (facultatif)"
              hint={
                form.compare_at_price && form.compare_at_price > form.price
                  ? `Remise affichée : −${Math.round(
                      (1 - form.price / form.compare_at_price) * 100,
                    )} %`
                  : 'Doit être supérieur au prix. Laisse vide pour ne rien barrer.'
              }
            >
              <input
                type="number"
                min={0}
                step={1}
                value={form.compare_at_price ?? ''}
                onChange={(e) =>
                  set('compare_at_price', e.target.value ? Number(e.target.value) : null)
                }
                className={inputClass}
              />
            </Field>
          </div>

          <ImagePicker
            label="Image du produit"
            hint="Elle est affichée en carré, partout. Envoie une image carrée pour éviter un recadrage surprise."
            square
            url={form.cover_url}
            onPick={pickCover}
            disabled={busy}
          />
        </form>
      </Card>

      <Card title="Le fichier livré">
        <p className="mb-4 text-sm text-ink-muted">
          Stocké en privé. Il n'est jamais accessible sans paiement : l'acheteur reçoit un lien
          signé, valable 24 h et utilisable 3 fois.
        </p>

        {form.file_name ? (
          <p className="mb-3 rounded-lg bg-tint px-3 py-2 text-sm text-ink">
            {form.file_name}{' '}
            <span className="text-ink-faint">{formatFileSize(form.file_size)}</span>
          </p>
        ) : (
          <p className="mb-3 text-sm text-ink-faint">Aucun fichier pour l'instant.</p>
        )}

        <Field label={form.file_name ? 'Remplacer le fichier' : 'Envoyer le fichier'}>
          <input
            type="file"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) pickFile(file)
              e.target.value = ''
            }}
            className={fileInputClass}
          />
        </Field>
      </Card>

      {existing ? (
        <ReviewsEditor productId={existing.id} />
      ) : (
        <Card title="Avis clients">
          <p className="text-sm text-ink-faint">
            Enregistre d'abord le produit, puis tu pourras ajouter des avis.
          </p>
        </Card>
      )}

      <Card title="Bouton d'achat">
        <p className="mb-4 text-sm text-ink-muted">
          C'est le bouton sur lequel l'acheteur clique. Laisse vide pour garder le texte et la
          couleur par défaut de la boutique.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Texte du bouton" hint="40 caractères maximum.">
            <input
              maxLength={40}
              placeholder="Acheter"
              value={form.cta_label ?? ''}
              onChange={(e) => set('cta_label', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Couleur du bouton">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.cta_color ?? shop.accent_color}
                onChange={(e) => set('cta_color', e.target.value)}
                className="h-10 w-16 rounded-lg border border-line"
              />
              {form.cta_color ? (
                <button
                  type="button"
                  onClick={() => set('cta_color', null)}
                  className="text-sm text-ink-faint underline underline-offset-2 hover:text-ink"
                >
                  Revenir à la couleur de la boutique
                </button>
              ) : (
                <span className="text-sm text-ink-faint">Couleur de la boutique</span>
              )}
            </div>
          </Field>
        </div>

        <div className="mt-6">
          <p className="mb-2 text-xs text-ink-faint">Aperçu</p>
          <span
            className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-medium text-white"
            style={{ backgroundColor: form.cta_color ?? shop.accent_color }}
          >
            {form.cta_label?.trim() || 'Acheter'}
          </span>
        </div>
      </Card>

      <Card title="Mise en vente">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.is_active}
            disabled={!canPublish}
            onChange={(e) => set('is_active', e.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span className="text-sm">
            <span className="font-medium text-ink">Afficher ce produit sur la boutique</span>
            <span className="block text-ink-faint">
              {canPublish
                ? 'Décoche pour le retirer de la vente sans le supprimer.'
                : 'Il faut un titre, un prix supérieur à zéro et un fichier avant de pouvoir vendre.'}
            </span>
          </span>
        </label>

        <div className="mt-6 space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          {saved && <Alert kind="ok">Produit enregistré.</Alert>}
          <Button type="submit" form="product-form" disabled={busy}>
            {busy ? '…' : existing ? 'Enregistrer' : 'Créer le produit'}
          </Button>
        </div>
      </Card>
    </>
  )
}
