import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { slugify } from '../../lib/slug'
import type { Product, Shop } from '../../lib/types'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../../components/ui'
import ThemeToggle from '../../components/ThemeToggle'

export type AdminContext = {
  shop: Shop
  products: Product[]
  reloadProducts: () => Promise<void>
  onShopSaved: (shop: Shop) => void
}

/** Accès au contexte depuis les pages enfants. */
export function useAdmin() {
  return useOutletContext<AdminContext>()
}

const TABS = [
  { to: '/admin', label: 'Accueil', end: true },
  { to: '/admin/produits', label: 'Produits', end: false },
  { to: '/admin/ventes', label: 'Ventes', end: false },
  { to: '/admin/retraits', label: 'Retraits', end: false },
  { to: '/admin/parametres', label: 'Paramètres', end: false },
]

export default function AdminLayout({ session }: { session: Session }) {
  const [shop, setShop] = useState<Shop | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const loadProducts = useCallback(async (shopId: string) => {
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('shop_id', shopId)
      .order('position')
      .order('created_at')
    setProducts(data ?? [])
  }, [])

  const load = useCallback(async () => {
    const { data: shopRow } = await supabase
      .from('shops')
      .select('*')
      .eq('owner_id', session.user.id)
      .maybeSingle()

    setShop(shopRow)
    if (shopRow) await loadProducts(shopRow.id)
    setLoading(false)
  }, [session.user.id, loadProducts])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <Spinner />

  // Tant que la boutique n'existe pas, il n'y a rien à naviguer.
  if (!shop) {
    return (
      <Shell email={session.user.email}>
        <main className="mx-auto max-w-3xl p-4 py-8">
          <CreateShop ownerId={session.user.id} onCreated={load} />
        </main>
      </Shell>
    )
  }

  const context: AdminContext = {
    shop,
    products,
    reloadProducts: () => loadProducts(shop.id),
    onShopSaved: setShop,
  }

  return (
    <Shell email={session.user.email} shop={shop}>
      <nav className="border-b border-line bg-raise">
        <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                'whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition ' +
                (isActive
                  ? 'border-[var(--accent)] text-ink'
                  : 'border-transparent text-ink-faint hover:text-ink')
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-3xl space-y-6 p-4 py-8">
        <Outlet context={context} />
      </main>
    </Shell>
  )
}

function Shell({
  email,
  shop,
  children,
}: {
  email?: string
  shop?: Shop
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-raise">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-ink">
              {shop ? shop.name : 'Administration'}
            </h1>
            {email && <p className="truncate text-xs text-ink-faint">{email}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => supabase.auth.signOut()}
              className="text-sm text-ink-faint transition hover:text-ink"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>
      {children}
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
        error.code === '23505' ? 'Ce lien est déjà pris, choisis-en un autre.' : error.message,
      )
      setBusy(false)
    } else {
      onCreated()
    }
  }

  return (
    <Card title="Crée ta boutique">
      <p className="mb-4 text-sm text-ink-muted">
        Deux informations suffisent pour commencer. Tout le reste se règle ensuite.
      </p>
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
