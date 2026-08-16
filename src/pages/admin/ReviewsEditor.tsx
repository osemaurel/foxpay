import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Review } from '../../lib/types'
import { Alert, Button, Card, Field, inputClass } from '../../components/ui'

/** Une ligne en cours d'édition. `isNew` distingue un ajout d'une modification. */
type Draft = {
  id: string
  author_name: string
  author_detail: string
  rating: number | null
  body: string
  is_visible: boolean
  isNew: boolean
}

const toDraft = (review: Review): Draft => ({
  id: review.id,
  author_name: review.author_name,
  author_detail: review.author_detail ?? '',
  rating: review.rating,
  body: review.body,
  is_visible: review.is_visible,
  isNew: false,
})

export default function ReviewsEditor({ productId }: { productId: string }) {
  const [rows, setRows] = useState<Draft[] | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    supabase
      .from('reviews')
      .select('*')
      .eq('product_id', productId)
      .order('position')
      .order('created_at')
      .then(({ data }) => setRows((data ?? []).map(toDraft)))
  }, [productId])

  function patch(id: string, values: Partial<Draft>) {
    setRows((list) => list!.map((row) => (row.id === id ? { ...row, ...values } : row)))
    setSaved(false)
  }

  function add() {
    setRows((list) => [
      ...list!,
      {
        id: `nouveau-${Date.now()}`,
        author_name: '',
        author_detail: '',
        rating: 5,
        body: '',
        is_visible: true,
        isNew: true,
      },
    ])
    setSaved(false)
  }

  function remove(id: string) {
    const row = rows!.find((r) => r.id === id)!
    // Une ligne jamais enregistrée n'a rien à supprimer en base.
    if (!row.isNew) setRemoved((list) => [...list, id])
    setRows((list) => list!.filter((r) => r.id !== id))
    setSaved(false)
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= rows!.length) return
    const next = [...rows!]
    ;[next[index], next[target]] = [next[target], next[index]]
    setRows(next)
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    setError(null)

    const incomplet = rows!.find((r) => !r.author_name.trim() || !r.body.trim())
    if (incomplet) {
      setError("Chaque avis a besoin d'un nom et d'un texte.")
      setBusy(false)
      return
    }

    if (removed.length > 0) {
      const { error } = await supabase.from('reviews').delete().in('id', removed)
      if (error) {
        setError(error.message)
        setBusy(false)
        return
      }
    }

    // La position est recalculée à partir de l'ordre affiché : c'est lui qui
    // fait foi, pas la valeur stockée.
    for (const [index, row] of rows!.entries()) {
      const payload = {
        product_id: productId,
        author_name: row.author_name.trim(),
        author_detail: row.author_detail.trim() || null,
        rating: row.rating,
        body: row.body.trim(),
        is_visible: row.is_visible,
        position: index,
      }
      const { error } = row.isNew
        ? await supabase.from('reviews').insert(payload)
        : await supabase.from('reviews').update(payload).eq('id', row.id)

      if (error) {
        setError(error.message)
        setBusy(false)
        return
      }
    }

    const { data } = await supabase
      .from('reviews')
      .select('*')
      .eq('product_id', productId)
      .order('position')
      .order('created_at')

    setRows((data ?? []).map(toDraft))
    setRemoved([])
    setSaved(true)
    setBusy(false)
  }

  if (!rows) return <Card title="Avis clients">Chargement…</Card>

  return (
    <Card title="Avis clients">
      <p className="mb-5 text-sm text-ink-muted">
        Les témoignages affichés sur la page du produit. Recopie ici ce que tes clients t'ont
        écrit — la boutique ne les présente pas comme vérifiés, mais ils doivent rester vrais.
      </p>

      <div className="space-y-4">
        {rows.map((row, index) => (
          <div key={row.id} className="rounded-xl border border-line bg-raise p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-faint">
                Avis {index + 1}
              </span>
              <div className="flex items-center gap-1">
                <Tool label="Monter" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </Tool>
                <Tool
                  label="Descendre"
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Tool>
                <Tool label="Supprimer" onClick={() => remove(row.id)}>
                  ✕
                </Tool>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nom">
                <input
                  value={row.author_name}
                  onChange={(e) => patch(row.id, { author_name: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Précision" hint="Ville, métier…">
                <input
                  value={row.author_detail}
                  placeholder="Abidjan"
                  onChange={(e) => patch(row.id, { author_detail: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Note">
                <select
                  value={row.rating ?? ''}
                  onChange={(e) =>
                    patch(row.id, { rating: e.target.value ? Number(e.target.value) : null })
                  }
                  className={inputClass}
                >
                  <option value="">Sans note</option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} / 5
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Témoignage">
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={row.body}
                  onChange={(e) => patch(row.id, { body: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={row.is_visible}
                onChange={(e) => patch(row.id, { is_visible: e.target.checked })}
                className="h-4 w-4"
              />
              Afficher sur la boutique
            </label>
          </div>
        ))}

        {rows.length === 0 && (
          <p className="text-sm text-ink-faint">
            Aucun avis. La section n'apparaît pas sur la page du produit tant qu'il n'y en a
            pas.
          </p>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="ok">Avis enregistrés.</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="ghost" onClick={add} disabled={busy}>
            Ajouter un avis
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? '…' : 'Enregistrer les avis'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function Tool({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-7 rounded-lg border border-line text-xs text-ink-faint transition hover:bg-tint hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  )
}
