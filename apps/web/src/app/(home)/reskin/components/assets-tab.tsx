'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { atlasFileFor, posFor } from '../lib/atlasOverrides'
import { type EdgeOption, edgeOptionsFor } from '../lib/edges'
import { getAtlasCell, getAtlasCells } from '../lib/exeAssets'
import { filledSilhouette } from '../lib/image'
import {
  type Catalog,
  type CatalogSheet,
  type ObjectEdit,
  objId,
  type ProjectState,
  type SheetEdit,
} from '../lib/types'
import { type AssetCaps, useAssetModal } from './asset-modal'
import { UploadTile } from './upload-tile'

export function AssetsTab({
  catalog,
  project,
  setObject,
  setSheetCell,
  exeBuf,
}: {
  catalog: Catalog
  project: ProjectState
  setObject: (catId: string, key: string, edit: ObjectEdit | null) => void
  setSheetCell: (sheetId: string, index: number, dataUrl: string | null) => void
  exeBuf: Uint8Array | null
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

  const category = catalog.spriteCategories.find((c) => c.id === active)
  const sheet = catalog.spriteSheets.find((s) => s.id === active)

  // Vanilla art shown faded behind each tile once an exe is imported. Extracted
  // per active category from its atlas and cached across category switches.
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const defaultsCache = useRef<Map<string, Record<string, string>>>(new Map())
  const atlasFile = category ? atlasFileFor(category) : undefined
  useEffect(() => {
    if (!exeBuf || !category || !atlasFile) {
      setDefaults({})
      return
    }
    const cached = defaultsCache.current.get(category.id)
    if (cached) {
      setDefaults(cached)
      return
    }
    let cancelled = false
    const cells = (catalog.spriteObjects[category.id] ?? [])
      .map((o) => ({ o, pos: posFor(category.id, o) }))
      .filter((x) => x.pos)
      .map((x) => ({
        id: x.o.key,
        rect: {
          x: x.pos!.x * category.px,
          y: x.pos!.y * category.py,
          w: category.px,
          h: category.py,
        },
      }))
    getAtlasCells(exeBuf, `resources/textures/1x/${atlasFile}`, cells)
      .then((map) => {
        if (cancelled) return
        defaultsCache.current.set(category.id, map)
        setDefaults(map)
      })
      .catch(() => !cancelled && setDefaults({}))
    return () => {
      cancelled = true
    }
  }, [exeBuf, category, atlasFile, catalog])

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
          defaults={defaults}
          exeBuf={exeBuf}
        />
      )}
      {sheet && (
        <SheetGrid
          sheet={sheet}
          project={project}
          setSheetCell={setSheetCell}
          exeBuf={exeBuf}
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
  defaults,
  exeBuf,
}: {
  catalog: Catalog
  project: ProjectState
  categoryId: string
  query: string
  setObject: (catId: string, key: string, edit: ObjectEdit | null) => void
  defaults: Record<string, string>
  exeBuf: Uint8Array | null
}) {
  const { openAsset } = useAssetModal()
  const cat = catalog.spriteCategories.find((c) => c.id === categoryId)!
  const ratio = cat.px / cat.py
  const objects = (catalog.spriteObjects[categoryId] ?? []).filter((o) => {
    const q = query.trim().toLowerCase()
    return (
      !q || o.key.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
    )
  })

  const openObject = (key: string) => {
    const o = (catalog.spriteObjects[categoryId] ?? []).find((x) => x.key === key)
    if (!o) return
    const caps: AssetCaps = {
      soul: Boolean(o.soul),
      shader: cat.registry === 'P_CENTERS',
      animated: cat.frames > 1,
      gif: cat.frames === 1,
    }
    // Edge options (shape/border), with each border's source vanilla cell
    // resolved from the category defaults. Border edges need the exe (a source
    // cell); 'shape' is always offered (procedural rounded corners without one).
    const edges: EdgeOption[] = edgeOptionsFor(categoryId, o.key)
      .map((opt) => ({
        ...opt,
        source: opt.sourceKey ? defaults[opt.sourceKey] : defaults[o.key],
      }))
      .filter((opt) => opt.value === 'shape' || Boolean(opt.source))
    // Internal art footprint for the crop aspect lock. Prefer the catalog's
    // measured value; fall back to 69×93 for card-shaped P_CENTERS before the
    // catalog is regenerated with per-type artPx/artPy.
    const artW =
      cat.artPx ?? (cat.registry === 'P_CENTERS' ? 69 : undefined)
    const artH =
      cat.artPy ?? (cat.registry === 'P_CENTERS' ? 93 : undefined)
    // Blinds: load the vanilla animation frames (a row of the atlas) on demand,
    // for the chip silhouette and the shine overlay.
    const loadFrames =
      cat.frames > 1 && exeBuf && cat.atlasFile && o.pos
        ? async (): Promise<string[]> => {
            if (!exeBuf || !cat.atlasFile || !o.pos) return []
            const row = o.pos.y
            const cells = Array.from({ length: cat.frames }, (_, f) => ({
              id: `f${f}`,
              rect: { x: f * cat.px, y: row * cat.py, w: cat.px, h: cat.py },
            }))
            const map = await getAtlasCells(
              exeBuf,
              `resources/textures/1x/${cat.atlasFile}`,
              cells
            )
            return Array.from({ length: cat.frames }, (_, f) => map[`f${f}`]).filter(
              (s): s is string => Boolean(s)
            )
          }
        : undefined
    openAsset({
      kind: 'object',
      title: o.name,
      targetW: cat.px,
      targetH: cat.py,
      artW,
      artH,
      caps,
      framesCount: cat.frames,
      edges,
      defaultPreview: defaults[key],
      loadFrames,
      exeBuf,
      value: project.objects[objId(categoryId, key)],
      commit: (edit: ObjectEdit) => setObject(categoryId, key, edit),
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
          Click a tile to add art, a soul, a shader, or a border. Upload a GIF to
          make the object animated in-game.
        </p>
      )}
      <div className='grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8'>
        {objects.map((o) => {
          const edit = project.objects[objId(categoryId, o.key)]
          return (
            <UploadTile
              key={o.key}
              label={o.name}
              sublabel={
                !cat.animated && edit && edit.sprites.length > 1
                  ? `${o.key} · ${edit.sprites.length}f @ ${edit.fps ?? 10}fps`
                  : o.key
              }
              ratio={ratio}
              preview={edit?.sprites[0]}
              defaultPreview={defaults[o.key]}
              onOpen={() => openObject(o.key)}
              onClear={() => setObject(categoryId, o.key, null)}
            />
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
  exeBuf,
}: {
  sheet: CatalogSheet
  project: ProjectState
  setSheetCell: (sheetId: string, index: number, dataUrl: string | null) => void
  exeBuf: Uint8Array | null
}) {
  const { openAsset } = useAssetModal()
  const edits: SheetEdit = project.sheets[sheet.id] ?? {}
  const ratio = sheet.px / sheet.py

  // Stake chips are circular — clip uploads to the vanilla chip silhouette.
  const [clipShape, setClipShape] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (sheet.id !== 'chips' || !exeBuf) {
      setClipShape(undefined)
      return
    }
    let cancelled = false
    getAtlasCell(exeBuf, 'resources/textures/1x/chips.png', {
      x: 0,
      y: 0,
      w: sheet.px,
      h: sheet.py,
    })
      .then((cell) => filledSilhouette(cell, { threshold: 128 }))
      .then((s) => {
        if (!cancelled) setClipShape(s)
      })
      .catch(() => {
        if (!cancelled) setClipShape(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [sheet.id, sheet.px, sheet.py, exeBuf])

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
            onOpen={() =>
              openAsset({
                kind: 'cell',
                title: sheet.label,
                targetW: wholeW,
                targetH: wholeH,
                value: edits[0],
                commit: (d: string | null) => setSheetCell(sheet.id, 0, d),
              })
            }
            onClear={() => setSheetCell(sheet.id, 0, null)}
          />
        </div>
      </div>
    )
  }

  if (sheet.mode === 'animated') {
    const frames = sheet.frames ?? 1
    const clearAll = () => {
      for (let i = 0; i < frames; i++) setSheetCell(sheet.id, i, null)
    }
    return (
      <div className='space-y-3'>
        <p className='text-muted-foreground text-xs'>{sheet.note}</p>
        <div className='w-40'>
          <UploadTile
            label={`${sheet.label} (${frames} frames)`}
            ratio={ratio}
            preview={edits[0]}
            onOpen={() =>
              openAsset({
                kind: 'cell',
                title: `${sheet.label} (${frames} frames)`,
                targetW: sheet.px,
                targetH: sheet.py,
                value: edits[0],
                commit: (d: string | null) =>
                  d === null ? clearAll() : setSheetCell(sheet.id, 0, d),
                animatedStrip: {
                  frames,
                  onStrip: (slices: string[]) =>
                    slices.forEach((d, i) => setSheetCell(sheet.id, i, d)),
                },
              })
            }
            onClear={clearAll}
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
                  onOpen={() =>
                    openAsset({
                      kind: 'cell',
                      title: `${sheet.label} · frame ${i}`,
                      targetW: sheet.px,
                      targetH: sheet.py,
                      value: edits[i],
                      commit: (d: string | null) => setSheetCell(sheet.id, i, d),
                    })
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

  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground text-xs'>{sheet.note}</p>
      <div className='grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-13'>
        {Array.from({ length: cellCount }, (_, i) => {
          const cell = sheet.cells[i]
          const name = cell?.name ?? `Cell ${i}`
          return (
            <UploadTile
              key={i}
              label={name}
              ratio={ratio}
              preview={edits[i]}
              onOpen={() =>
                openAsset({
                  kind: 'cell',
                  title: name,
                  targetW: sheet.px,
                  targetH: sheet.py,
                  value: edits[i],
                  clipShape,
                  commit: (d: string | null) => setSheetCell(sheet.id, i, d),
                })
              }
              onClear={() => setSheetCell(sheet.id, i, null)}
            />
          )
        })}
      </div>
    </div>
  )
}
