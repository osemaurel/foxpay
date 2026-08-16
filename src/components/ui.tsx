import type { ReactNode } from 'react'

/**
 * Petit label mono en capitales, repris de la référence : c'est lui qui donne
 * le ton « produit » avant même qu'on lise le titre.
 */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.18em] text-chalk-faint">{children}</p>
  )
}

export function Card({
  title,
  eyebrow,
  children,
}: {
  title?: string
  eyebrow?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-ink-card p-6 sm:p-8">
      {(title || eyebrow) && (
        <header className="mb-6 space-y-2">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          {title && <h2 className="text-lg font-medium text-chalk">{title}</h2>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-chalk">{label}</span>
      {children}
      {hint && <span className="mt-2 block text-xs leading-relaxed text-chalk-faint">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-line bg-ink-raised px-3.5 py-2.5 text-chalk ' +
  'placeholder:text-chalk-faint outline-none transition ' +
  'focus:border-[var(--accent)] disabled:opacity-50'

export const fileInputClass =
  'w-full text-sm text-chalk-muted file:mr-3 file:cursor-pointer file:rounded-lg ' +
  'file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-chalk ' +
  'hover:file:bg-white/15'

/** `accent` bascule le bouton sur la couleur de la boutique. */
export function Button({
  children,
  accent,
  variant = 'solid',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  accent?: boolean
  variant?: 'solid' | 'ghost'
}) {
  const base =
    'inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-medium ' +
    'transition disabled:opacity-40 disabled:pointer-events-none '

  const styles =
    variant === 'ghost'
      ? 'border border-line text-chalk hover:bg-white/5'
      : accent
        ? 'text-black hover:brightness-110'
        : 'bg-white text-black hover:bg-white/90'

  return (
    <button
      {...props}
      style={accent && variant === 'solid' ? { backgroundColor: 'var(--accent)' } : undefined}
      className={`${base}${styles} ${className}`}
    >
      {children}
    </button>
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  const styles =
    kind === 'error'
      ? 'border-stop/40 bg-stop/10 text-stop'
      : 'border-go/40 bg-go/10 text-go'
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      {children}
    </div>
  )
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <p className="p-10 text-center font-mono text-xs uppercase tracking-[0.18em] text-chalk-faint">
      {label}
    </p>
  )
}

export function ImagePicker({
  label,
  hint,
  url,
  onPick,
  disabled,
}: {
  label: string
  hint?: string
  url: string | null
  onPick: (file: File) => void
  disabled?: boolean
}) {
  return (
    <Field label={label} hint={hint}>
      {url && (
        <img
          src={url}
          alt=""
          className="mb-3 h-24 w-full rounded-xl border border-line bg-ink object-contain p-2"
        />
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
          e.target.value = ''
        }}
        className={fileInputClass}
      />
    </Field>
  )
}
