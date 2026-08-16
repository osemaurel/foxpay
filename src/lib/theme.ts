export type Theme = 'dark' | 'light'

const KEY = 'foxpay-theme'

/**
 * Le sombre est la direction artistique du projet : il reste le défaut, y
 * compris pour un visiteur dont le système est en clair. Le clair ne s'active
 * que sur un choix explicite, qui est ensuite mémorisé.
 */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    // Stockage refusé (navigation privée, cookies bloqués) : on reste au défaut.
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Le thème s'appliquera quand même, il ne survivra juste pas au rechargement.
  }
}
