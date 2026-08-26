'use client'

import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Only the marks/nodes the launcher's own HTML renderer actually understands
// get exposed here -- @tiptap/starter-kit (v3) bundles a lot more
// (blockquote, strike, underline, code/codeBlock, horizontalRule) than this
// editor should allow, so those are explicitly turned off below rather than
// left at their defaults. `link` is also bundled directly in this installed
// starter-kit version (@tiptap/extension-link under the hood) so there's no
// need for a separate extension import/registration.
function buildExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [3] },
      codeBlock: false,
      blockquote: false,
      strike: false,
      underline: false,
      horizontalRule: false,
      link: {
        openOnClick: false,
        autolink: false,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
  ]
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      aria-label={label}
      aria-pressed={active}
      className={cn('px-2', active && 'bg-accent text-accent-foreground')}
      onMouseDown={(e) => {
        // Preserve the editor's text selection -- a normal button click
        // steals focus first and collapses it before onClick runs.
        e.preventDefault()
        onClick()
      }}
    >
      {children}
    </Button>
  )
}

export function BlogTiptapEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (html: string) => void
}) {
  // Tracks the last HTML this component itself emitted via onChange, so the
  // sync effect below can tell "value changed because we typed" (no-op)
  // apart from "value changed because the parent swapped in a different
  // post's content" (needs editor.commands.setContent) -- without this,
  // naively calling setContent on every prop change would reset the cursor
  // to the start of the document on every keystroke.
  const lastEmitted = useRef(value)

  const editor = useEditor({
    extensions: buildExtensions(),
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-invert prose-sm max-w-none min-h-[240px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      lastEmitted.current = html
      onChange(html)
    },
  })

  useEffect(() => {
    if (!editor) return
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    editor.commands.setContent(value, { emitUpdate: false })
  }, [value, editor])

  if (!editor) return null

  function setLink() {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href as string | undefined
    // eslint-disable-next-line no-alert
    const input = window.prompt('Link URL', previousUrl ?? '')
    if (input === null) return
    const url = input.trim()
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center gap-1 rounded-md border border-input bg-muted/40 p-1'>
        <ToolbarButton
          label='Bold'
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className='size-4' />
        </ToolbarButton>
        <ToolbarButton
          label='Italic'
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className='size-4' />
        </ToolbarButton>
        <ToolbarButton
          label='Heading 3'
          active={editor.isActive('heading', { level: 3 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        >
          <Heading3 className='size-4' />
        </ToolbarButton>
        <ToolbarButton
          label='Bullet list'
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className='size-4' />
        </ToolbarButton>
        <ToolbarButton
          label='Ordered list'
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className='size-4' />
        </ToolbarButton>
        <ToolbarButton
          label='Link'
          active={editor.isActive('link')}
          onClick={setLink}
        >
          <LinkIcon className='size-4' />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
