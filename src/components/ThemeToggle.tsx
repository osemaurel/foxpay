import { useEffect, useState } from 'react'
import { applyTheme, readTheme, type Theme } from '../lib/theme'

/** Bascule clair / sombre. Discrète : c'est une préférence, pas une fonction. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={next === 'light' ? 'Passer en clair' : 'Passer en sombre'}
      aria-label={next === 'light' ? 'Passer en mode clair' : 'Passer en mode sombre'}
      className={
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ' +
        'border-line text-ink-faint transition hover:bg-tint hover:text-ink ' +
        className
      }
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}
