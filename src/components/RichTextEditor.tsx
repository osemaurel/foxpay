import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { looksLikeHtml, plainTextToHtml } from '../lib/richText'

/**
 * Éditeur de description. Chargé à la demande depuis la page Produit : il pèse
 * plus lourd que le reste de l'app et n'a rien à faire dans le bundle que
 * télécharge un acheteur.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true },
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Décris ton produit…' }),
    ],
    // Une description écrite avant l'éditeur est du texte brut : on la convertit
    // pour qu'elle s'ouvre correctement au lieu d'apparaître sur une seule ligne.
    content: value ? (looksLikeHtml(value) ? value : plainTextToHtml(value)) : '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class:
          'prose min-h-44 max-h-[28rem] overflow-y-auto px-3.5 py-3 text-ink ' +
          'leading-relaxed outline-none',
      },
    },
  })

  useEffect(() => () => editor?.destroy(), [editor])

  if (!editor) {
    return <div className="min-h-56 rounded-xl border border-line bg-raise" />
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-raise focus-within:border-[var(--accent)]">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const groups = [
    [
      { label: 'G', title: 'Gras', bold: true, active: 'bold', run: () => editor.chain().focus().toggleBold().run() },
      { label: 'I', title: 'Italique', italic: true, active: 'italic', run: () => editor.chain().focus().toggleItalic().run() },
      { label: 'S', title: 'Souligné', underline: true, active: 'underline', run: () => editor.chain().focus().toggleUnderline().run() },
    ],
    [
      { label: 'T1', title: 'Titre', active: 'heading', args: { level: 2 as const }, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
      { label: 'T2', title: 'Sous-titre', active: 'heading', args: { level: 3 as const }, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    ],
    [
      { label: '•', title: 'Liste à puces', active: 'bulletList', run: () => editor.chain().focus().toggleBulletList().run() },
      { label: '1.', title: 'Liste numérotée', active: 'orderedList', run: () => editor.chain().focus().toggleOrderedList().run() },
      { label: '❝', title: 'Citation', active: 'blockquote', run: () => editor.chain().focus().toggleBlockquote().run() },
    ],
  ]

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line-soft bg-tint px-2 py-1.5">
      {groups.map((group, i) => (
        <div key={i} className="flex items-center gap-1">
          {i > 0 && <span className="mx-1 h-4 w-px bg-line" aria-hidden />}
          {group.map((item) => (
            <ToolButton
              key={item.label}
              title={item.title}
              active={editor.isActive(item.active, 'args' in item ? item.args : undefined)}
              onClick={item.run}
              bold={'bold' in item}
              italic={'italic' in item}
              underline={'underline' in item}
            >
              {item.label}
            </ToolButton>
          ))}
        </div>
      ))}

      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <LinkButton editor={editor} />

      <button
        type="button"
        title="Enlever la mise en forme"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        className="ml-auto rounded-md px-2 py-1 text-xs text-ink-faint transition hover:bg-tint-strong hover:text-ink"
      >
        Effacer le style
      </button>
    </div>
  )
}

function ToolButton({
  children,
  title,
  active,
  onClick,
  bold,
  italic,
  underline,
}: {
  children: React.ReactNode
  title: string
  active: boolean
  onClick: () => void
  bold?: boolean
  italic?: boolean
  underline?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      // onMouseDown plutôt que onClick : sinon le champ perd le focus avant
      // que la commande s'applique, et la sélection disparaît.
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={
        'h-7 min-w-7 rounded-md px-1.5 text-sm transition ' +
        (bold ? 'font-bold ' : '') +
        (italic ? 'italic ' : '') +
        (underline ? 'underline ' : '') +
        (active ? 'bg-tint-strong text-ink' : 'text-ink-faint hover:bg-tint-strong hover:text-ink')
      }
    >
      {children}
    </button>
  )
}

function LinkButton({ editor }: { editor: Editor }) {
  const active = editor.isActive('link')

  function toggle() {
    if (active) {
      editor.chain().focus().unsetLink().run()
      return
    }
    const url = window.prompt('Adresse du lien (https://…)')
    if (!url) return
    editor.chain().focus().setLink({ href: url }).run()
  }

  return (
    <ToolButton title={active ? 'Retirer le lien' : 'Ajouter un lien'} active={active} onClick={toggle}>
      🔗
    </ToolButton>
  )
}
