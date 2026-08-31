import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import ShopLayout from './pages/shop/ShopLayout'
import ShopHome from './pages/shop/ShopHome'
import ShopProductPage from './pages/shop/ProductPage'
import ShopCheckout from './pages/shop/Checkout'
import ShopMerci from './pages/shop/Merci'
import Login from './pages/Login'
import ScrollToTop from './components/ScrollToTop'
import AdminLayout from './pages/admin/AdminLayout'
import Home from './pages/admin/Home'
import ProductsList from './pages/admin/ProductsList'
import ProductEdit from './pages/admin/ProductEdit'
import SalesPage from './pages/admin/SalesPage'
import SettingsPage from './pages/admin/SettingsPage'
import Retraits from './pages/admin/Retraits'
import '@fontsource-variable/inter'
import '@fontsource-variable/geist-mono'
import './index.css'

const session = { user: { id: 'user-1', email: 'moi@atelierkodi.ci' } } as unknown as Session

const SCREENS = [
  {
    id: 'shop',
    label: 'Page boutique',
    note: 'Le catalogue. Clique sur un produit pour ouvrir sa page — les images sont cadrées en carré.',
    render: () => (
      <MemoryRouter initialEntries={['/boutique/atelier-kodi']}>
        <ScrollToTop />
        <Routes>
          <Route path="/boutique/:slug" element={<ShopLayout />}>
            <Route index element={<ShopHome />} />
            <Route path="p/:productSlug" element={<ShopProductPage />} />
            <Route path="checkout/:productSlug" element={<ShopCheckout />} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  },
  {
    id: 'admin',
    label: 'Administration',
    note: 'Cinq onglets, navigables ici même. Les champs sont modifiables : change la couleur d’accent dans Paramètres, enregistre, puis reviens sur la page boutique.',
    render: () => (
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout session={session} />}>
            <Route index element={<Home />} />
            <Route path="produits" element={<ProductsList />} />
            <Route path="produits/nouveau" element={<ProductEdit />} />
            <Route path="produits/:productId" element={<ProductEdit />} />
            <Route path="ventes" element={<SalesPage />} />
            <Route path="retraits" element={<Retraits />} />
            <Route path="parametres" element={<SettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  },
  {
    id: 'merci',
    label: 'Confirmation',
    note: 'Où atterrit l’acheteur dès que son paiement aboutit : le bouton de téléchargement, et où chercher l’email s’il ne le voit pas.',
    render: () => (
      <MemoryRouter initialEntries={['/boutique/atelier-kodi/merci?order=demo-merci']}>
        <ScrollToTop />
        <Routes>
          <Route path="/boutique/:slug" element={<ShopLayout />}>
            <Route path="merci" element={<ShopMerci />} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  },
  {
    id: 'checkout',
    label: 'Paiement',
    note: 'Tout se passe ici : pays, numéro, opérateur. La demande part sur le téléphone de l’acheteur, sans quitter la boutique.',
    render: () => (
      <MemoryRouter initialEntries={['/boutique/atelier-kodi/checkout/vendre-en-ligne']}>
        <ScrollToTop />
        <Routes>
          <Route path="/boutique/:slug" element={<ShopLayout />}>
            <Route path="checkout/:productSlug" element={<ShopCheckout />} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  },
  {
    id: 'login',
    label: 'Connexion',
    note: 'L’entrée de l’administration. Les identifiants ne sont pas branchés sur cette preview.',
    render: () => <Login />,
  },
]

function Preview() {
  const [current, setCurrent] = useState(SCREENS[0])

  return (
    <>
      <div className="sticky top-0 z-50 border-b border-stone-700 bg-stone-900">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <span className="text-sm font-semibold tracking-wide text-stone-100">
            Aperçu Foxpay
          </span>
          <nav className="flex flex-wrap gap-1">
            {SCREENS.map((screen) => (
              <button
                key={screen.id}
                onClick={() => setCurrent(screen)}
                aria-current={screen.id === current.id}
                className={
                  'rounded-full px-2.5 py-1 text-xs transition sm:px-3 sm:py-1.5 sm:text-sm ' +
                  (screen.id === current.id
                    ? 'bg-stone-100 text-stone-900'
                    : 'text-stone-300 hover:bg-stone-800 hover:text-stone-100')
                }
              >
                {screen.label}
              </button>
            ))}
          </nav>
        </div>
        <p className="mx-auto hidden max-w-5xl px-4 pb-3 text-sm text-stone-400 sm:block">{current.note}</p>
      </div>

      <div key={current.id}>{current.render()}</div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
)
