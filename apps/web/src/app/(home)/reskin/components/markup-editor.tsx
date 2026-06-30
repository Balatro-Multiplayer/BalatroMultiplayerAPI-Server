'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { cn } from '@/lib/utils'
import {
  type Doc,
  parseMarkup,
  serializeMarkup,
  type Style,
} from '../lib/balatroMarkup'
import {
  buildHtml,
  type Caret,
  getSelection,
  readDoc,
  restoreSelection,
} from '../lib/markupDom'

export interface EditorHandle {
  /** Set or clear one control key over the current selection. */
  apply: (key: keyof Style | string, value: string | null) => void
  /** Clear all style over the current selection. */
  reset: () => void
  /** Insert a variable slot (#n#) at the caret. */
  insertVar: (n: string) => void
  focus: () => void
}

export const MarkupEditor = forwardRef<
  EditorHandle,
  {
    initial: string[]
    multiline: boolean
    onChange: (lines: string[]) => void
    onBlur?: () => void
  }
>(function MarkupEditor({ initial, multiline, onChange, onBlur }, ref) {
  const elRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<Doc>(parseMarkup(initial.length ? initial : ['']))
  // Remember the last selection made INSIDE the editor, so toolbar actions still
  // have a target after a popover/dropdown steals focus and collapses it.
  const lastSel = useRef<{ start: Caret; end: Caret } | null>(null)

  useEffect(() => {
    const onSel = () => {
      const el = elRef.current
      const sel = window.getSelection()
      if (!el || !sel || sel.rangeCount === 0) return
      if (!el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return
      const r = getSelection(el)
      if (r) lastSel.current = r
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const activeRange = () =>
    lastSel.current ?? (elRef.current ? getSelection(elRef.current) : null)

  // Render the model to the DOM imperatively (decoupled from React) so typing
  // never triggers a React re-render that would reset the caret.
  const render = useCallback((caret?: { start: Caret; end: Caret }) => {
    const el = elRef.current
    if (!el) return
    el.innerHTML = buildHtml(docRef.current)
    if (caret) restoreSelection(el, caret)
  }, [])

  useEffect(() => {
    render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = useCallback(() => {
    onChange(serializeMarkup(docRef.current))
  }, [onChange])

  const onInput = () => {
    if (elRef.current) docRef.current = readDoc(elRef.current)
    emit()
  }

  const mutateRange = (fn: (s: Style) => Style) => {
    const el = elRef.current
    if (!el) return
    docRef.current = readDoc(el)
    const range = activeRange()
    if (!range) return
    const { start, end } = range
    if (start.line === end.line && start.idx === end.idx) return // nothing selected
    const doc = docRef.current
    for (let li = start.line; li <= end.line; li++) {
      const line = doc[li]
      if (!line) continue
      const from = li === start.line ? start.idx : 0
      const to = li === end.line ? end.idx : line.length
      for (let i = from; i < to; i++) if (line[i]) line[i]!.style = fn(line[i]!.style)
    }
    render(range)
    emit()
  }

  const splitLineAtCaret = () => {
    const el = elRef.current
    if (!el) return
    docRef.current = readDoc(el)
    const range = activeRange()
    if (!range) return
    const { start } = range
    const line = docRef.current[start.line] ?? []
    const before = line.slice(0, start.idx)
    const after = line.slice(start.idx)
    docRef.current.splice(start.line, 1, before, after)
    render({
      start: { line: start.line + 1, idx: 0 },
      end: { line: start.line + 1, idx: 0 },
    })
    emit()
  }

  useImperativeHandle(ref, () => ({
    apply: (key, value) =>
      mutateRange((s) => {
        const next = { ...s }
        if (value === null) delete next[key as string]
        else next[key as string] = value
        return next
      }),
    reset: () => mutateRange(() => ({})),
    insertVar: (n) => {
      const el = elRef.current
      if (!el) return
      docRef.current = readDoc(el)
      const range = activeRange()
      if (!range) return
      const { start } = range
      const line = docRef.current[start.line]
      if (!line) return
      const style = line[start.idx - 1]?.style ?? line[start.idx]?.style ?? {}
      line.splice(start.idx, 0, { kind: 'var', n, style: { ...style } })
      const caret = {
        start: { ...start, idx: start.idx + 1 },
        end: { ...start, idx: start.idx + 1 },
      }
      render(caret)
      emit()
    },
    focus: () => elRef.current?.focus(),
  }))

  return (
    <div
      ref={elRef}
      contentEditable
      suppressContentEditableWarning
      role='textbox'
      aria-multiline={multiline}
      spellCheck={false}
      onInput={onInput}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (multiline) splitLineAtCaret()
        }
      }}
      onPaste={(e) => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, text)
      }}
      className={cn(
        'min-h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-center font-medium text-[13px] leading-tight shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'
      )}
    />
  )
})
