'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { BorderTemplate } from '../lib/exeAssets'
import { extractFrames, extractFramesNative } from '../lib/image'
import {
  type Catalog,
  type CatalogSheet,
  type ObjectEdit,
  objId,
  type ProjectState,
  SHADER_OPTIONS,
  type SheetEdit,
} from '../lib/types'
import { ImageEditorDialog } from './image-editor-dialog'
import { UploadTile } from './upload-tile'

/** Open the crop/fit editor for a single upload; resolves with the committed
 *  PNG data URL, or null if the user cancelled. `round` pre-enables rounded-corner
 *  masking (default for card-shaped P_CENTERS sprites). */
export type OpenEditor = (
  file: File,
  size: {
    w: number
    h: number
    round?: boolean
    mask?: string
    maskBox?: { x: number; y: number; w: number; h: number }
    border?: BorderTemplate
  }
) => Promise<string | null>

export function AssetsTab({
  catalog,
  project,
  setObject,
  setSheetCell,
  border,
}: {
  catalog: Catalog
  project: ProjectState
  setObject: (catId: string, key: string, edit: ObjectEdit | null) => void
  setSheetCell: (sheetId: string, index: number, dataUrl: string | null) => void
  border: BorderTemplate | null
}) {
  const groups = useMemo(() => {
    const objects = [
      ...catalog.spriteCategories.map((c) => ({ id: c.id, label: c.label })),
      ...catalog.spriteSheets
        .filter((s) => s.group === 'objects')
        .map((s) => ({ id: s.id, label: s.label })),
    ]
    const sheets = catalog.spriteSheets
      .filter((s) => s.group !== 'objects')
      .map((s) => ({ id: s.id, label: s.label }))
    return { objects, sheets }
  }, [catalog])
  const [active, setActive] = useState(groups.objects[0]?.id ?? '')
  const [query, setQuery] = useState('')

  // Single crop/fit editor shared by every upload tile, exposed as a
  // promise-returning `openEditor` so grids can `await` the committed result.
  const [pending, setPending] = useState<{
    file: File
    w: number
    h: number
    round: boolean
    mask?: string
    maskBox?: { x: number; y: number; w: number; h: number }
    border?: BorderTemplate
  } | null>(null)
  const resolveRef = useRef<(v: string | null) => void>(() => {})
  const openEditor = useCallback<OpenEditor>((file, size) => {
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve
      setPending({
        file,
        w: size.w,
        h: size.h,
        round: size.round ?? false,
        mask: size.mask,
        maskBox: size.maskBox,
        border: size.border,
      })
    })
  }, [])
  const finishEditor = (result: string | null) => {
    resolveRef.current(result)
    resolveRef.current = () => {}
    setPending(null)
  }

  const category = catalog.spriteCategories.find((c) => c.id === active)
  const sheet = catalog.spriteSheets.find((s) => s.id === active)

  return (
    <div className='space-y-4 pt-4'>
      {pending && (
        <ImageEditorDialog
          file={pending.file}
          targetW={pending.w}
          targetH={pending.h}
          roundCornersDefault={pending.round}
          vanillaMask={pending.mask}
          maskBox={pending.maskBox}
          border={pending.border}
          onCommit={finishEditor}
          onCancel={() => finishEditor(null)}
        />
      )}
      <div className='flex flex-wrap items-end gap-3'>
        <div className='space-y-1'>
          <Label>Category</Label>
          <Select value={active} onValueChange={setActive}>
            <SelectTrigger className='w-64'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Objects</SelectLabel>
                {groups.objects.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label} ({countFor(project, catalog, g.id)})
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Sheets</SelectLabel>
                {groups.sheets.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label} ({Object.keys(project.sheets[g.id] ?? {}).length})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {category && (
          <div className='flex-1 space-y-1'>
            <Label htmlFor='asset-search'>Search</Label>
            <Input
              id='asset-search'
              value={query}
              placeholder='Filter by name or key'
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {category && (
        <CategoryGrid
          catalog={catalog}
          project={project}
          categoryId={category.id}
          query={query}
          setObject={setObject}
          openEditor={openEditor}
          border={border}
        />
      )}
      {sheet && (
        <SheetGrid
          sheet={sheet}
          project={project}
          setSheetCell={setSheetCell}
          openEditor={openEditor}
        />
      )}
    </div>
  )
}

function editedInCategory(p: ProjectState, c: Catalog, catId: string): number {
  const objs = c.spriteObjects[catId] ?? []
  return objs.filter((o) =>
    p.objects[objId(catId, o.key)]?.sprites.some(Boolean)
  ).length
}

/** Edit count for an Objects-group entry: a sprite category or an object-grouped sheet. */
function countFor(p: ProjectState, c: Catalog, id: string): number {
  if (c.spriteCategories.some((cat) => cat.id === id))
    return editedInCategory(p, c, id)
  return Object.keys(p.sheets[id] ?? {}).length
}

function CategoryGrid({
  catalog,
  project,
  categoryId,
  query,
  setObject,
  openEditor,
  border,
}: {
  catalog: Catalog
  project: ProjectState
  categoryId: string
  query: string
  setObject: (catId: string, key: string, edit: ObjectEdit | null) => void
  openEditor: OpenEditor
  border: BorderTemplate | null
}) {
  const cat = catalog.spriteCategories.find((c) => c.id === categoryId)!
  const ratio = cat.px / cat.py
  const objects = (catalog.spriteObjects[categoryId] ?? []).filter((o) => {
    const q = query.trim().toLowerCase()
    return (
      !q || o.key.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
    )
  })

  const isGif = (f: File) =>
    f.type === 'image/gif' || f.name.toLowerCase().endsWith('.gif')

  const onUpload = async (key: string, file: File) => {
    const prev = project.objects[objId(categoryId, key)]
    // Animated categories (blinds) still ingest a whole frame-strip/GIF.
    if (cat.frames > 1) {
      const sprites = await extractFrames(file, cat.frames)
      setObject(categoryId, key, { sprites, soul: prev?.soul })
      return
    }
    // A GIF on a static category becomes a per-object animation (Balatro plays
    // it on its own animation atlas at the GIF's native rate).
    if (isGif(file)) {
      const { frames, fps } = await extractFramesNative(file)
      setObject(categoryId, key, {
        sprites: frames,
        fps,
        soul: prev?.soul,
        shader: prev?.shader,
      })
      return
    }
    const obj = (catalog.spriteObjects[categoryId] ?? []).find(
      (x) => x.key === key
    )
    const edited = await openEditor(file, {
      w: cat.px,
      h: cat.py,
      round: cat.registry === 'P_CENTERS',
      mask: obj?.mask,
      maskBox: obj?.maskBox,
      // The extracted border is a Joker frame (71×95); offer it on jokers.
      border: categoryId === 'Joker' ? (border ?? undefined) : undefined,
    })
    if (!edited) return
    setObject(categoryId, key, {
      sprites: [edited],
      soul: prev?.soul,
      shader: prev?.shader,
    })
  }
  const onSoul = async (key: string, file: File) => {
    const prev = project.objects[objId(categoryId, key)]
    const edited = await openEditor(file, { w: cat.px, h: cat.py })
    if (!edited) return
    setObject(categoryId, key, {
      sprites: prev?.sprites ?? [],
      soul: edited,
      shader: prev?.shader,
    })
  }
  const onShader = (key: string, shader: string) => {
    const prev = project.objects[objId(categoryId, key)]
    setObject(categoryId, key, {
      sprites: prev?.sprites ?? [],
      soul: prev?.soul,
      fps: prev?.fps,
      shader: shader || undefined,
    })
  }

  return (
    <>
      {cat.animated ? (
        <p className='text-muted-foreground text-xs'>
          Animated ({cat.frames} frames): upload an animated GIF or a horizontal
          frame-strip PNG.
        </p>
      ) : (
        <p className='text-muted-foreground text-xs'>
          Upload a still image (cropped on upload), or a GIF to make the object
          animated in-game.
        </p>
      )}
      <div className='grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8'>
        {objects.map((o) => {
          const edit = project.objects[objId(categoryId, o.key)]
          return (
            <div key={o.key} className='flex flex-col gap-1'>
              <UploadTile
                label={o.name}
                sublabel={
                  !cat.animated && edit && edit.sprites.length > 1
                    ? `${o.key} · ${edit.sprites.length}f @ ${edit.fps ?? 10}fps`
                    : o.key
                }
                ratio={ratio}
                accept={cat.animated ? 'image/*' : 'image/png,image/*'}
                preview={edit?.sprites[0]}
                onFile={(f) => onUpload(o.key, f)}
                onClear={() => setObject(categoryId, o.key, null)}
              />
              {o.soul && (
                <div className='flex items-center gap-1'>
                  <span className='text-[10px] text-muted-foreground'>
                    soul
                  </span>
                  <UploadTile
                    label='soul'
                    small
                    ratio={ratio}
                    preview={edit?.soul}
                    onFile={(f) => onSoul(o.key, f)}
                    onClear={() =>
                      setObject(categoryId, o.key, {
                        sprites: edit?.sprites ?? [],
                        soul: undefined,
                        shader: edit?.shader,
                      })
                    }
                  />
                </div>
              )}
              {cat.registry === 'P_CENTERS' && (
                <ShaderSelect
                  value={edit?.shader}
                  onChange={(s) => onShader(o.key, s)}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

const SHADER_NONE = '__none__'

/** Compact per-card default-shader picker (P_CENTERS only). */
function ShaderSelect({
  value,
  onChange,
}: {
  value?: string
  onChange: (shader: string) => void
}) {
  return (
    <Select
      value={value ?? SHADER_NONE}
      onValueChange={(v) => onChange(v === SHADER_NONE ? '' : v)}
    >
      <SelectTrigger className='h-6 px-1 text-[10px]'>
        <SelectValue placeholder='shader' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SHADER_NONE}>no shader</SelectItem>
        {SHADER_OPTIONS.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SheetGrid({
  sheet,
  project,
  setSheetCell,
  openEditor,
}: {
  sheet: CatalogSheet
  project: ProjectState
  setSheetCell: (sheetId: string, index: number, dataUrl: string | null) => void
  openEditor: OpenEditor
}) {
  const edits: SheetEdit = project.sheets[sheet.id] ?? {}
  const ratio = sheet.px / sheet.py
  const cellSize = { w: sheet.px, h: sheet.py }

  if (sheet.mode === 'whole') {
    const wholeW = (sheet.cols ?? 1) * sheet.px
    const wholeH = (sheet.rows ?? 1) * sheet.py
    const wholeRatio = wholeW / wholeH
    return (
      <div className='space-y-3'>
        <p className='text-muted-foreground text-xs'>{sheet.note}</p>
        <div className='w-72'>
          <UploadTile
            label={sheet.label}
            ratio={wholeRatio}
            preview={edits[0]}
            onFile={async (f) => {
              const edited = await openEditor(f, { w: wholeW, h: wholeH })
              if (edited) setSheetCell(sheet.id, 0, edited)
            }}
            onClear={() => setSheetCell(sheet.id, 0, null)}
          />
        </div>
      </div>
    )
  }

  if (sheet.mode === 'animated') {
    const frames = sheet.frames ?? 1
    const onUpload = async (file: File) => {
      const slices = await extractFrames(file, frames)
      slices.forEach((d, i) => setSheetCell(sheet.id, i, d))
    }
    return (
      <div className='space-y-3'>
        <p className='text-muted-foreground text-xs'>{sheet.note}</p>
        <div className='w-40'>
          <UploadTile
            label={`${sheet.label} (${frames} frames)`}
            ratio={ratio}
            accept='image/*'
            preview={edits[0]}
            onFile={onUpload}
            onClear={() => {
              for (let i = 0; i < frames; i++) setSheetCell(sheet.id, i, null)
            }}
          />
        </div>
        {Object.keys(edits).length > 0 && (
          <div className='flex gap-1'>
            {Array.from({ length: frames }, (_, i) => (
              <div key={i} className='w-12'>
                <UploadTile
                  label={`f${i}`}
                  small
                  ratio={ratio}
                  preview={edits[i]}
                  onFile={async (f) => {
                    const edited = await openEditor(f, cellSize)
                    if (edited) setSheetCell(sheet.id, i, edited)
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // grid sheet: playing cards (named cells) or chips (indexed cells)
  const cellCount =
    sheet.cells.length > 0
      ? sheet.cells.length
      : (sheet.cols ?? 1) * (sheet.rows ?? 1)
  const onFile = async (index: number, file: File) => {
    const edited = await openEditor(file, cellSize)
    if (edited) setSheetCell(sheet.id, index, edited)
  }

  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground text-xs'>{sheet.note}</p>
      <div className='grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-13'>
        {Array.from({ length: cellCount }, (_, i) => {
          const cell = sheet.cells[i]
          return (
            <UploadTile
              key={i}
              label={cell?.name ?? `Cell ${i}`}
              ratio={ratio}
              preview={edits[i]}
              onFile={(f) => onFile(i, f)}
              onClear={() => setSheetCell(sheet.id, i, null)}
            />
          )
        })}
      </div>
    </div>
  )
}
