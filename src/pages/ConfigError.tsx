/**
 * Écran affiché quand le build n'a pas reçu la configuration Supabase.
 * Il remplace la page blanche : sans lui, l'erreur n'existe que dans la console.
 */
export default function ConfigError({ missing }: { missing: string[] }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="w-full max-w-lg rounded-xl border border-line bg-ink-card p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-chalk">Configuration incomplète</h1>

        <p className="mt-3 text-chalk-muted">
          {missing.length > 1 ? 'Ces variables manquaient' : 'Cette variable manquait'} au
          moment de construire l'application :
        </p>

        <ul className="mt-3 space-y-1">
          {missing.map((name) => (
            <li
              key={name}
              className="rounded-lg bg-ink-raised px-3 py-2 font-mono text-sm text-chalk"
            >
              {name}
            </li>
          ))}
        </ul>

        <p className="mt-5 text-sm leading-relaxed text-chalk-muted">
          Ajoute-les dans les variables d'environnement de ton hébergeur, puis{' '}
          <strong>relance un déploiement</strong>. Vite remplace ces valeurs pendant le build :
          les ajouter sans reconstruire ne change rien.
        </p>

        <p className="mt-3 text-sm leading-relaxed text-chalk-faint">
          Sur Vercel, l'intégration Supabase injecte des variables nommées{' '}
          <code className="font-mono">SUPABASE_URL</code> et{' '}
          <code className="font-mono">NEXT_PUBLIC_SUPABASE_…</code>. Vite ne lit que les noms
          commençant par <code className="font-mono">VITE_</code> : il faut donc ajouter
          celles ci-dessus à la main.
        </p>
      </div>
    </div>
  )
}
