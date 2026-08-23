import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { missingEnv, supabase } from './lib/supabase'
import { Spinner } from './components/ui'
import ScrollToTop from './components/ScrollToTop'
import ConfigError from './pages/ConfigError'
import Login from './pages/Login'
import Telechargement from './pages/Telechargement'
import ShopLayout from './pages/shop/ShopLayout'
import ShopHome from './pages/shop/ShopHome'
import ProductPage from './pages/shop/ProductPage'
import Checkout from './pages/shop/Checkout'
import AdminLayout from './pages/admin/AdminLayout'
import Home from './pages/admin/Home'
import ProductsList from './pages/admin/ProductsList'
import ProductEdit from './pages/admin/ProductEdit'
import SalesPage from './pages/admin/SalesPage'
import SettingsPage from './pages/admin/SettingsPage'
import Retraits from './pages/admin/Retraits'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (missingEnv.length > 0) return <ConfigError missing={missingEnv} />
  if (!ready) return <Spinner />

  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        {/* Boutique publique */}
        <Route path="/boutique/:slug" element={<ShopLayout />}>
          <Route index element={<ShopHome />} />
          <Route path="p/:productSlug" element={<ProductPage />} />
          <Route path="checkout/:productSlug" element={<Checkout />} />
        </Route>

        {/* Où atterrit un lien de téléchargement refusé. */}
        <Route path="/telechargement" element={<Telechargement />} />

        <Route path="/login" element={session ? <Navigate to="/admin" replace /> : <Login />} />

        {/* Administration */}
        <Route
          path="/admin"
          element={session ? <AdminLayout session={session} /> : <Navigate to="/login" replace />}
        >
          <Route index element={<Home />} />
          <Route path="produits" element={<ProductsList />} />
          <Route path="produits/nouveau" element={<ProductEdit />} />
          <Route path="produits/:productId" element={<ProductEdit />} />
          <Route path="ventes" element={<SalesPage />} />
          <Route path="retraits" element={<Retraits />} />
          <Route path="parametres" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
