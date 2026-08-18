import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { uploadPublicAsset } from '../../lib/upload'
import { slugify } from '../../lib/slug'
import type { Shop } from '../../lib/types'
import { Alert, Button, Card, Field, ImagePicker, inputClass } from '../../components/ui'
import CurrenciesEditor from './CurrenciesEditor'
import { useAdmin } from './AdminLayout'

export default function SettingsPage() {
  const { shop, onShopSaved } = useAdmin()
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
        facebook_pixel_id: form.facebook_pixel_id || null,
      })
      .eq('id', shop.id)
      .select()
      .single()

    if (error) {
      setError(
        error.code === '23505'
          ? 'Ce lien est déjà pris.'
          : error.code === '23514'
            ? "L'identifiant du pixel ne doit contenir que des chiffres."
            : error.message,
      )
    } else {
      onShopSaved(data)
      setSaved(true)
    }
    setBusy(false)
  }

  return (
    <>
      <form onSubmit={save} className="space-y-6">
      <Card title="Identité">
        <div className="space-y-4">
          <Field label="Nom de la boutique">
            <input
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="Lien public"
            hint={`Ta boutique sera sur /boutique/${form.slug}. Changer ce lien casse les anciens partages.`}
          >
            <input
              required
              value={form.slug}
              onChange={(e) => set('slug', slugify(e.target.value))}
              className={inputClass}
            />
          </Field>

          <Field label="Présentation" hint="Les retours à la ligne sont conservés.">
            <textarea
              rows={4}
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <Card title="Apparence">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <ImagePicker
              label="Logo"
              hint="Carré, affiché en rond."
              url={form.logo_url}
              onPick={(f) => pickImage('logo', f)}
              disabled={busy}
            />
            <ImagePicker
              label="Bannière"
              hint="Bandeau en haut de la boutique."
              url={form.banner_url}
              onPick={(f) => pickImage('banner', f)}
              disabled={busy}
            />
          </div>

          <Field
            label="Couleur d'accent"
            hint="Utilisée pour le prix et le bouton d'achat."
          >
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.accent_color}
                onChange={(e) => set('accent_color', e.target.value)}
                className="h-10 w-16 rounded-lg border border-line"
              />
              <code className="font-mono text-sm text-ink-muted">{form.accent_color}</code>
            </div>
          </Field>
        </div>
      </Card>

      <Card title="Suivi publicitaire">
        <p className="mb-5 text-sm leading-relaxed text-ink-muted">
          Si tu fais de la publicité sur Facebook ou Instagram, ton pixel Meta compte ici les
          produits consultés, les paiements commencés et les achats. Laissé vide, aucun script
          n'est chargé sur ta boutique et rien n'est envoyé à Meta.
        </p>

        <Field
          label="Identifiant du pixel Meta"
          hint="Uniquement des chiffres, tel qu'il apparaît dans le gestionnaire d'événements."
        >
          <input
            inputMode="numeric"
            placeholder="Aucun"
            value={form.facebook_pixel_id ?? ''}
            onChange={(e) => set('facebook_pixel_id', e.target.value.replace(/\D/g, '') || null)}
            className={inputClass}
          />
        </Field>
      </Card>

      <Card title="Paiement et contact">
        <p className="mb-5 text-sm text-ink-muted">
          Tes acheteurs paient en mobile money depuis les sept pays de la zone franc CFA
          (Bénin, Burkina&nbsp;Faso, Cameroun, Congo, Côte&nbsp;d'Ivoire, Gabon, Sénégal).
          Chacun choisit son pays et son opérateur au moment de payer ; ton prix reste le même,
          les deux francs CFA ayant la même valeur.
        </p>

        <div className="space-y-4">

          <Field
            label="Email de contact"
            hint="Affiché sur la boutique, et utilisé comme adresse de réponse dans l'email de livraison."
          >
            <input
              type="email"
              value={form.contact_email ?? ''}
              onChange={(e) => set('contact_email', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <div className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          {saved && <Alert kind="ok">Paramètres enregistrés.</Alert>}
          <Button type="submit" disabled={busy}>
            {busy ? '…' : 'Enregistrer'}
          </Button>
        </div>
      </form>

      <CurrenciesEditor />
    </>
  )
}
