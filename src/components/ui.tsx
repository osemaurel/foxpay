import type { ReactNode } from 'react'

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {title && <h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>}
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
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none ' +
  'focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50'

export function Button({
  children,
  accent,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { accent?: string }) {
  return (
    <button
      {...props}
      style={accent ? { backgroundColor: accent } : undefined}
      className={
        'rounded-lg px-4 py-2 font-medium text-white transition disabled:opacity-50 ' +
        (accent ? 'hover:brightness-110' : 'bg-slate-900 hover:bg-slate-700 ') +
        (props.className ?? '')
      }
    >
      {children}
    </button>
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  const styles =
    kind === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return <p className="p-8 text-center text-slate-500">{label}</p>
}
