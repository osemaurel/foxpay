import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { uploadProductFile, uploadPublicAsset } from '../../lib/upload'
import type { Product, Shop } from '../../lib/types'
import { formatFileSize } from '../../lib/format'
import { Alert, Button, Card, Field, inputClass } from '../../components/ui'
import { ImagePicker } from './ShopForm'

const EMPTY = {
  title: '',
  description: '',
  price: 0,
  cover_url: null as string | null,
  file_path: null as string | null,
  file_name: null as string | null,
  file_size: null as number | null,
  is_active: false,
}

export default function ProductForm({
  shop,
  product,
  onSaved,
}: {
  shop: Shop
  product: Product | null
  onSaved: (product: Product) => void
}) {
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
      onSaved(data)
      setSaved(true)
    }
    setBusy(false)
  }

  // Sans fichier, il n'y a rien à livrer : on empêche la mise en vente.
  const canPublish = Boolean(form.file_path) && form.price > 0 && form.title.trim() !== ''

  return (
    <Card title="Ton produit">
      <form onSubmit={save} className="space-y-4">
        <Field label="Titre">
          <input
            required
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Description">
          <textarea
            rows={4}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Prix (XOF)" hint="Nombre entier, sans décimales.">
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
          url={form.cover_url}
          onPick={pickCover}
          disabled={busy}
        />

        <Field
          label="Fichier à livrer"
          hint="PDF, ZIP, etc. Stocké en privé : jamais accessible sans paiement."
        >
          {form.file_name && (
            <p className="mb-2 text-sm text-slate-600">
              {form.file_name}{' '}
              <span className="text-slate-400">{formatFileSize(form.file_size)}</span>
            </p>
          )}
          <input
            type="file"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) pickFile(file)
              e.target.value = ''
            }}
            className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.is_active}
            disabled={!canPublish}
            onChange={(e) => set('is_active', e.target.checked)}
            className="h-4 w-4"
          />
          Mettre en vente
          {!canPublish && (
            <span className="text-slate-400">— titre, prix et fichier requis</span>
          )}
        </label>

        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="ok">Produit enregistré.</Alert>}

        <Button type="submit" disabled={busy}>
          {busy ? '…' : 'Enregistrer'}
        </Button>
      </form>
    </Card>
  )
}
