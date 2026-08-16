import { useMemo } from 'react'
import { toSafeHtml } from '../lib/richText'

/** Affiche une description enregistrée, après nettoyage. */
export default function RichContent({
  value,
  className = '',
}: {
  value: string
  className?: string
}) {
  const html = useMemo(() => toSafeHtml(value), [value])
  return <div className={`prose ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}
