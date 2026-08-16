import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { uploadPublicAsset } from '../../lib/upload'
import { XOF_COUNTRIES, type Shop } from '../../lib/types'
import { Alert, Button, Card, Field, inputClass } from '../../components/ui'
import { slugify } from '../Admin'

export default function ShopForm({
  shop,
  onSaved,
}: {
  shop: Shop
  onSaved: (shop: Shop) => void
}) {
  const [form, setForm] = useState(shop)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function set<K extends keyof Shop>(key: K, value: Shop[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function pickImage(kind: 'logo' | 'banner', file: File) {
    setBusy(true)
    setError(null)
    try {
      const url = await uploadPublicAsset(shop.id, kind, file)
      set(kind === 'logo' ? 'logo_url' : 'banner_url', url)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const { data, error } = await supabase
      .from('shops')
      .update({
        name: form.name,
        slug: form.slug,
        description: form.description,
        logo_url: form.logo_url,
        banner_url: form.banner_url,
        accent_color: form.accent_color,
        contact_email: form.contact_email,
        country: form.country,
      })
      .eq('id', shop.id)
      .select()
      .single()

    if (error) {
      setError(error.code === '23505' ? 'Ce lien est déjà pris.' : error.message)
    } else {
      onSaved(data)
      setSaved(true)
    }
    setBusy(false)
  }

  return (
    <Card title="Ta boutique">
      <form onSubmit={save} className="space-y-4">
        <Field label="Nom">
          <input
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Lien public" hint={`/boutique/${form.slug}`}>
          <input
            required
            value={form.slug}
            onChange={(e) => set('slug', slugify(e.target.value))}
            className={inputClass}
          />
        </Field>

        <Field label="Présentation" hint="Texte libre, les retours à la ligne sont conservés.">
          <textarea
            rows={4}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pays" hint="Détermine les opérateurs mobile money proposés.">
            <select
              value={form.country}
              onChange={(e) => set('country', e.target.value)}
              className={inputClass}
            >
              {XOF_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Couleur d'accent">
            <input
              type="color"
              value={form.accent_color}
              onChange={(e) => set('accent_color', e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300"
            />
          </Field>
        </div>

        <Field label="Email de contact" hint="Affiché à l'acheteur pour te joindre.">
          <input
            type="email"
            value={form.contact_email ?? ''}
            onChange={(e) => set('contact_email', e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <ImagePicker
            label="Logo"
            url={form.logo_url}
            onPick={(f) => pickImage('logo', f)}
            disabled={busy}
          />
          <ImagePicker
            label="Bannière"
            url={form.banner_url}
            onPick={(f) => pickImage('banner', f)}
            disabled={busy}
          />
        </div>

        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="ok">Boutique enregistrée.</Alert>}

        <Button type="submit" disabled={busy}>
          {busy ? '…' : 'Enregistrer'}
        </Button>
      </form>
    </Card>
  )
}

export function ImagePicker({
  label,
  url,
  onPick,
  disabled,
}: {
  label: string
  url: string | null
  onPick: (file: File) => void
  disabled?: boolean
}) {
  return (
    <Field label={label}>
      {url && (
        <img
          src={url}
          alt=""
          className="mb-2 h-24 w-full rounded-lg border border-slate-200 object-contain p-1"
        />
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
          e.target.value = ''
        }}
        className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
      />
    </Field>
  )
}
