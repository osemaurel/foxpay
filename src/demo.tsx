import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import Shop from './pages/Shop'
import Admin from './pages/Admin'
import Login from './pages/Login'
import Return from './pages/Return'
import './index.css'

const session = { user: { id: 'user-1', email: 'moi@atelierkodi.ci' } } as unknown as Session

const SCREENS = [
  {
    id: 'shop',
    label: 'Page boutique',
    note: 'Ce que voit un acheteur sur /boutique/atelier-kodi. Le bouton « Acheter » ouvre le formulaire.',
    render: () => (
      <MemoryRouter initialEntries={['/boutique/atelier-kodi']}>
        <Routes>
          <Route path="/boutique/:slug" element={<Shop />} />
        </Routes>
      </MemoryRouter>
    ),
  },
  {
    id: 'admin',
    label: 'Administration',
    note: 'Ton écran. Les champs sont modifiables et le rendu suit — change la couleur d’accent puis reviens sur la page boutique.',
    render: () => <Admin session={session} />,
  },
  {
    id: 'return',
    label: 'Après paiement',
    note: 'La page où l’acheteur atterrit en revenant du mobile money, une fois le paiement confirmé.',
    render: () => (
      <MemoryRouter initialEntries={['/boutique/atelier-kodi/retour?order=demo']}>
        <Routes>
          <Route path="/boutique/:slug/retour" element={<Return />} />
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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
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
                  'rounded-full px-3 py-1.5 text-sm transition ' +
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
        <p className="mx-auto max-w-5xl px-4 pb-3 text-sm text-stone-400">{current.note}</p>
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
