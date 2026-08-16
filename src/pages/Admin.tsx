import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Product, Shop } from '../lib/types'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../components/ui'
import ShopForm from './admin/ShopForm'
import ProductForm from './admin/ProductForm'
import Sales from './admin/Sales'

export default function Admin({ session }: { session: Session }) {
  const [shop, setShop] = useState<Shop | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: shopRow } = await supabase
      .from('shops')
      .select('*')
      .eq('owner_id', session.user.id)
      .maybeSingle()

    setShop(shopRow)

    if (shopRow) {
      const { data: productRow } = await supabase
        .from('products')
        .select('*')
        .eq('shop_id', shopRow.id)
        .maybeSingle()
      setProduct(productRow)
    }
    setLoading(false)
  }, [session.user.id])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <Spinner />

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <h1 className="font-semibold text-slate-900">Administration</h1>
          <div className="flex items-center gap-4 text-sm">
            {shop && (
              <a
                href={`/boutique/${shop.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-slate-500 hover:text-slate-900"
              >
                Voir la boutique ↗
              </a>
            )}
            <button
              onClick={() => supabase.auth.signOut()}
              className="text-slate-500 hover:text-slate-900"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4 py-8">
        {!shop ? (
          <CreateShop ownerId={session.user.id} onCreated={load} />
        ) : (
          <>
            <ShopForm shop={shop} onSaved={setShop} />
            <ProductForm shop={shop} product={product} onSaved={setProduct} />
            <Sales shop={shop} />
          </>
        )}
      </main>
    </div>
  )
}

/** Première visite : on crée la boutique avec le strict minimum. */
function CreateShop({ ownerId, onCreated }: { ownerId: string; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('shops').insert({ owner_id: ownerId, name, slug })
    if (error) {
      setError(
        error.code === '23505'
          ? 'Ce lien est déjà pris, choisis-en un autre.'
          : error.message,
      )
      setBusy(false)
    } else {
      onCreated()
    }
  }

  return (
    <Card title="Créer ta boutique">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nom de la boutique">
          <input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSlug(slugify(e.target.value))
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Lien public" hint={`Ta boutique sera sur /boutique/${slug || '…'}`}>
          <input
            required
            value={slug}
            onChange={(e) => setSlug(slugify(e.target.value))}
            className={inputClass}
          />
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? '…' : 'Créer'}
        </Button>
      </form>
    </Card>
  )
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}
