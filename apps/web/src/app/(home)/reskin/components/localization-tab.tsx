'use client'

import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { asLines, normalize } from '../lib/balatroMarkup'
import type {
  Catalog,
  LocEdits,
  LocField,
  LocItem,
  LocValues,
} from '../lib/types'
import { BalatroText } from './balatro-text'
import { type EditorHandle, MarkupEditor } from './markup-editor'
import { MarkupToolbar } from './markup-toolbar'

const LANG_NAMES: Record<string, string> = {
  de: 'German',
  'en-us': 'English',
  es_419: 'Spanish (LatAm)',
  es_ES: 'Spanish (Spain)',
  fr: 'French',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  nl: 'Dutch',
  pl: 'Polish',
  pt_BR: 'Portuguese (Brazil)',
  ru: 'Russian',
  zh_CN: 'Chinese (Simplified)',
  zh_TW: 'Chinese (Traditional)',
}
const MAX_RESULTS = 150

export function LocalizationTab({
  catalog,
  loc,
  setLocValue,
  loadLoc,
}: {
  catalog: Catalog
  loc: LocEdits
  setLocValue: (
    lang: string,
    path: string,
    value: string | string[] | null
  ) => void
  /** Load a language's values from the imported exe; null when none is imported. */
  loadLoc: ((lang: string) => Promise<LocValues>) | null
}) {
  const [lang, setLang] = useState(
    catalog.languages.includes('en-us') ? 'en-us' : (catalog.languages[0] ?? '')
  )
  const [groupId, setGroupId] = useState(catalog.locGroups[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [values, setValues] = useState<LocValues | null>(null)
  // Only one field is in WYSIWYG edit mode at a time (others show a preview).
  const [activePath, setActivePath] = useState<string | null>(null)
  const cache = useRef<Map<string, LocValues>>(new Map())

  useEffect(() => {
    if (!loadLoc) {
      setValues(null)
      return
    }
    let cancelled = false
    const cached = cache.current.get(lang)
    if (cached) {
      setValues(cached)
      return
    }
    setValues(null)
    loadLoc(lang)
      .then((v) => {
        if (cancelled) return
        cache.current.set(lang, v)
        setValues(v)
      })
      .catch(() => !cancelled && setValues({}))
    return () => {
      cancelled = true
    }
  }, [lang, loadLoc])

  const group = catalog.locGroups.find((g) => g.id === groupId)
  const edits = loc[lang] ?? {}

  const items = useMemo(() => {
    if (!group) return []
    const q = query.trim().toLowerCase()
    const matched = q
      ? group.items.filter((it) => {
          if (
            it.key.toLowerCase().includes(q) ||
            it.label.toLowerCase().includes(q)
          )
            return true
          return it.fields.some((f) => {
            const v = values?.[f.path]
            const s = Array.isArray(v) ? v.join(' ') : (v ?? '')
            return s.toLowerCase().includes(q)
          })
        })
      : group.items
    return matched.slice(0, MAX_RESULTS)
  }, [group, query, values])

  if (!loadLoc) {
    return (
      <div className='rounded-md border bg-card p-8 text-center text-muted-foreground text-sm'>
        Import your <strong>Balatro.exe</strong> in the <strong>Options</strong>{' '}
        tab to edit in-game text. The file is read locally in your browser and
        never uploaded.
      </div>
    )
  }

  return (
    <div className='space-y-4 pt-4'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='space-y-1'>
          <Label>Language</Label>
          <Select
            value={lang}
            onValueChange={(v) => {
              setLang(v)
              setActivePath(null)
            }}
          >
            <SelectTrigger className='w-52'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.languages.map((l) => (
                <SelectItem key={l} value={l}>
                  {LANG_NAMES[l] ?? l}
                  {Object.keys(loc[l] ?? {}).length > 0
                    ? ` · ${Object.keys(loc[l] ?? {}).length}`
                    : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>Group</Label>
          <Select
            value={groupId}
            onValueChange={(v) => {
              setGroupId(v)
              setActivePath(null)
            }}
          >
            <SelectTrigger className='w-60'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.locGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.label} ({g.items.length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex-1 space-y-1'>
          <Label htmlFor='loc-search'>Search</Label>
          <Input
            id='loc-search'
            value={query}
            placeholder='Filter by key, name, or current text'
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <p className='text-muted-foreground text-xs'>
        Editing <strong>{LANG_NAMES[lang] ?? lang}</strong>. Each field shows
        the current value; change it to override, or use the reset button to
        restore the original.
      </p>

      {values === null ? (
        <div className='py-8 text-center text-muted-foreground'>Loading…</div>
      ) : (
        group && (
          <div className='space-y-2'>
            {items.map((it) => (
              <ItemRow
                key={it.key}
                item={it}
                edits={edits}
                values={values}
                activePath={activePath}
                setActivePath={setActivePath}
                onChange={(path, v) => setLocValue(lang, path, v)}
              />
            ))}
            {group.items.length > items.length && (
              <p className='pt-2 text-center text-muted-foreground text-xs'>
                Showing {items.length} of {group.items.length}. Refine the
                search to see more.
              </p>
            )}
          </div>
        )
      )}
    </div>
  )
}

function ItemRow({
  item,
  edits,
  values,
  activePath,
  setActivePath,
  onChange,
}: {
  item: LocItem
  edits: Record<string, string | string[]>
  values: LocValues
  activePath: string | null
  setActivePath: (path: string | null) => void
  onChange: (path: string, value: string | string[] | null) => void
}) {
  return (
    <div className='rounded-md border bg-card p-2'>
      <code className='text-[11px] text-muted-foreground'>{item.key}</code>
      <div className='mt-1 grid gap-2'>
        {item.fields.map((f) => (
          <FieldEditor
            key={f.key}
            field={f}
            original={values[f.path]}
            override={edits[f.path]}
            editing={activePath === f.path}
            onActivate={() => setActivePath(f.path)}
            onChange={onChange}
            onResetField={() => {
              onChange(f.path, null)
              setActivePath(null)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function FieldEditor({
  field,
  original,
  override,
  editing,
  onActivate,
  onChange,
  onResetField,
}: {
  field: LocField
  original: string | string[] | undefined
  override: string | string[] | undefined
  editing: boolean
  onActivate: () => void
  onChange: (path: string, value: string | string[] | null) => void
  onResetField: () => void
}) {
  const edited = override !== undefined
  const base = original ?? (field.multiline ? [] : '')
  const current = edited ? override! : base
  const editorRef = useRef<EditorHandle>(null)

  // Only treat a field as formatted text when its value carries Balatro {} tags.
  // Most strings are plain and use a normal input/textarea.
  const hasMarkup = asLines(current).some((l) => l.includes('{'))

  // Editor emits serialized lines; clear the override when it matches the
  // original (compared in normalized form), otherwise store it.
  const handleEditor = (lines: string[]) => {
    const same =
      JSON.stringify(normalize(lines)) ===
      JSON.stringify(normalize(asLines(base)))
    if (same) onChange(field.path, null)
    else onChange(field.path, field.multiline ? lines : lines.join(''))
  }

  const applyPlain = (raw: string | string[]) =>
    onChange(
      field.path,
      JSON.stringify(raw) === JSON.stringify(base) ? null : raw
    )
  const plainText = Array.isArray(current)
    ? current.join('\n')
    : String(current)

  return (
    <div>
      <div className='mb-0.5 flex items-center justify-between'>
        <span className='text-[11px] text-muted-foreground'>{field.label}</span>
        <Button
          type='button'
          size='icon'
          variant='ghost'
          className='size-6 text-muted-foreground'
          disabled={!edited}
          title='Reset to original'
          onClick={onResetField}
        >
          <RotateCcw className='size-3.5' />
        </Button>
      </div>
      {!hasMarkup ? (
        field.multiline ? (
          <Textarea
            rows={Math.max(2, Array.isArray(current) ? current.length : 1)}
            value={plainText}
            onChange={(e) => applyPlain(e.target.value.split('\n'))}
          />
        ) : (
          <Input
            value={plainText}
            onChange={(e) => applyPlain(e.target.value)}
          />
        )
      ) : editing ? (
        <div className='space-y-1'>
          <MarkupToolbar editor={editorRef} />
          <MarkupEditor
            ref={editorRef}
            initial={asLines(current)}
            multiline={field.multiline}
            onChange={handleEditor}
          />
        </div>
      ) : (
        <button
          type='button'
          className='block w-full text-left'
          onClick={onActivate}
          title='Click to format'
        >
          <BalatroText lines={asLines(current)} />
        </button>
      )}
    </div>
  )
}
