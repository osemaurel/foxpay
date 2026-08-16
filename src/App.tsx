import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Admin from './pages/Admin'
import Shop from './pages/Shop'
import Return from './pages/Return'

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

  if (!ready) return <Spinner />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/boutique/:slug" element={<Shop />} />
        <Route path="/boutique/:slug/retour" element={<Return />} />
        <Route
          path="/login"
          element={session ? <Navigate to="/admin" replace /> : <Login />}
        />
        <Route
          path="/admin"
          element={session ? <Admin session={session} /> : <Navigate to="/login" replace />}
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
