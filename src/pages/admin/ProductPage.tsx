import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { uploadProductFile, uploadPublicAsset } from '../../lib/upload'
import { formatFileSize, formatPrice } from '../../lib/format'
import {
  Alert,
  Button,
  Card,
  Field,
  fileInputClass,
  ImagePicker,
  inputClass,
} from '../../components/ui'
import { useAdmin } from './AdminLayout'

const EMPTY = {
  title: '',
  description: '' as string | null,
  price: 0,
  cover_url: null as string | null,
  file_path: null as string | null,
  file_name: null as string | null,
  file_size: null as number | null,
  is_active: false,
}

export default function ProductPage() {
  const { shop, product, onProductSaved } = useAdmin()
  const [form, setForm] = useState({ ...EMPTY, ...(product ?? {}) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

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
      description: form.description,
      price: form.price,
      cover_url: form.cover_url,
      file_path: form.file_path,
      file_name: form.file_name,
      file_size: form.file_size,
      is_active: form.is_active,
    }

    const { data, error } = product
      ? await supabase.from('products').update(payload).eq('id', product.id).select().single()
      : await supabase.from('products').insert(payload).select().single()

    if (error) setError(error.message)
    else {
      onProductSaved(data)
      setSaved(true)
    }
    setBusy(false)
  }

  // Sans fichier, il n'y a rien à livrer : on empêche la mise en vente.
  const canPublish = Boolean(form.file_path) && form.price > 0 && form.title.trim() !== ''

  return (
    <>
      <Card title="Ce que tu vends">
        <form id="product-form" onSubmit={save} className="space-y-4">
          <Field label="Titre">
            <input
              required
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Description" hint="Les retours à la ligne sont conservés.">
            <textarea
              rows={5}
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="Prix (XOF)"
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

          <ImagePicker
            label="Image de couverture"
            hint="Format paysage conseillé."
            url={form.cover_url}
            onPick={pickCover}
            disabled={busy}
          />
        </form>
      </Card>

      <Card title="Le fichier livré">
        <p className="mb-4 text-sm text-slate-600">
          Stocké en privé. Il n'est jamais accessible sans paiement : l'acheteur reçoit un lien
          signé, valable 24 h et utilisable 3 fois.
        </p>

        {form.file_name ? (
          <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
            {form.file_name}{' '}
            <span className="text-slate-500">{formatFileSize(form.file_size)}</span>
          </p>
        ) : (
          <p className="mb-3 text-sm text-slate-500">Aucun fichier pour l'instant.</p>
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
            <span className="font-medium text-slate-900">Afficher le produit sur la boutique</span>
            <span className="block text-slate-500">
              {canPublish
                ? 'Décoche pour retirer la vente sans supprimer le produit.'
                : 'Il faut un titre, un prix supérieur à zéro et un fichier avant de pouvoir vendre.'}
            </span>
          </span>
        </label>

        <div className="mt-6 space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          {saved && <Alert kind="ok">Produit enregistré.</Alert>}
          <Button type="submit" form="product-form" disabled={busy}>
            {busy ? '…' : 'Enregistrer'}
          </Button>
        </div>
      </Card>
    </>
  )
}
