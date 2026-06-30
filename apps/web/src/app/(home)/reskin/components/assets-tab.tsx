'use client'

import { useMemo, useState } from 'react'
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
import { extractFrames, fileToDataUrl } from '../lib/image'
import {
  type Catalog,
  type CatalogSheet,
  objId,
  type ObjectEdit,
  type ProjectState,
  type SheetEdit,
} from '../lib/types'
import { UploadTile } from './upload-tile'

export function AssetsTab({
  catalog,
  project,
  setObject,
  setSheetCell,
}: {
  catalog: Catalog
  project: ProjectState
  setObject: (catId: string, key: string, edit: ObjectEdit | null) => void
  setSheetCell: (sheetId: string, index: number, dataUrl: string | null) => void
}) {
  const groups = useMemo(
    () => {
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
    },
    [catalog]
  )
  const [active, setActive] = useState(groups.objects[0]?.id ?? '')
  const [query, setQuery] = useState('')

  const category = catalog.spriteCategories.find((c) => c.id === active)
  const sheet = catalog.spriteSheets.find((s) => s.id === active)

  return (
    <div className='space-y-4 pt-4'>
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
        />
      )}
      {sheet && (
        <SheetGrid sheet={sheet} project={project} setSheetCell={setSheetCell} />
      )}
    </div>
  )
}

function editedInCategory(p: ProjectState, c: Catalog, catId: string): number {
  const objs = c.spriteObjects[catId] ?? []
  return objs.filter((o) => p.objects[objId(catId, o.key)]?.sprites.some(Boolean))
    .length
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
}: {
  catalog: Catalog
  project: ProjectState
  categoryId: string
  query: string
  setObject: (catId: string, key: string, edit: ObjectEdit | null) => void
}) {
  const cat = catalog.spriteCategories.find((c) => c.id === categoryId)!
  const ratio = cat.px / cat.py
  const objects = (catalog.spriteObjects[categoryId] ?? []).filter((o) => {
    const q = query.trim().toLowerCase()
    return !q || o.key.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
  })

  const onUpload = async (key: string, file: File) => {
    const prev = project.objects[objId(categoryId, key)]
    const sprites = cat.frames > 1
      ? await extractFrames(file, cat.frames)
      : [await fileToDataUrl(file)]
    setObject(categoryId, key, { sprites, soul: prev?.soul })
  }
  const onSoul = async (key: string, file: File) => {
    const prev = project.objects[objId(categoryId, key)]
    setObject(categoryId, key, {
      sprites: prev?.sprites ?? [],
      soul: await fileToDataUrl(file),
    })
  }

  return (
    <>
      {cat.animated && (
        <p className='text-muted-foreground text-xs'>
          Animated ({cat.frames} frames): upload an animated GIF or a horizontal
          frame-strip PNG.
        </p>
      )}
      <div className='grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8'>
        {objects.map((o) => {
          const edit = project.objects[objId(categoryId, o.key)]
          return (
            <div key={o.key} className='flex flex-col gap-1'>
              <UploadTile
                label={o.name}
                sublabel={o.key}
                ratio={ratio}
                accept={cat.animated ? 'image/*' : 'image/png,image/*'}
                preview={edit?.sprites[0]}
                onFile={(f) => onUpload(o.key, f)}
                onClear={() => setObject(categoryId, o.key, null)}
              />
              {o.soul && (
                <div className='flex items-center gap-1'>
                  <span className='text-[10px] text-muted-foreground'>soul</span>
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
                      })
                    }
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function SheetGrid({
  sheet,
  project,
  setSheetCell,
}: {
  sheet: CatalogSheet
  project: ProjectState
  setSheetCell: (sheetId: string, index: number, dataUrl: string | null) => void
}) {
  const edits: SheetEdit = project.sheets[sheet.id] ?? {}
  const ratio = sheet.px / sheet.py

  if (sheet.mode === 'whole') {
    const wholeRatio =
      ((sheet.cols ?? 1) * sheet.px) / ((sheet.rows ?? 1) * sheet.py)
    return (
      <div className='space-y-3'>
        <p className='text-muted-foreground text-xs'>{sheet.note}</p>
        <div className='w-72'>
          <UploadTile
            label={sheet.label}
            ratio={wholeRatio}
            preview={edits[0]}
            onFile={async (f) => setSheetCell(sheet.id, 0, await fileToDataUrl(f))}
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
                  onFile={async (f) =>
                    setSheetCell(sheet.id, i, await fileToDataUrl(f))
                  }
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
  const onFile = async (index: number, file: File) =>
    setSheetCell(sheet.id, index, await fileToDataUrl(file))

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
