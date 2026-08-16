import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { missingEnv, supabase } from './lib/supabase'
import { Spinner } from './components/ui'
import ConfigError from './pages/ConfigError'
import Login from './pages/Login'
import Shop from './pages/Shop'
import Return from './pages/Return'
import AdminLayout from './pages/admin/AdminLayout'
import Home from './pages/admin/Home'
import ProductPage from './pages/admin/ProductPage'
import SalesPage from './pages/admin/SalesPage'
import SettingsPage from './pages/admin/SettingsPage'

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
      <Routes>
        <Route path="/boutique/:slug" element={<Shop />} />
        <Route path="/boutique/:slug/retour" element={<Return />} />
        <Route path="/login" element={session ? <Navigate to="/admin" replace /> : <Login />} />

        <Route
          path="/admin"
          element={session ? <AdminLayout session={session} /> : <Navigate to="/login" replace />}
        >
          <Route index element={<Home />} />
          <Route path="produit" element={<ProductPage />} />
          <Route path="ventes" element={<SalesPage />} />
          <Route path="parametres" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
