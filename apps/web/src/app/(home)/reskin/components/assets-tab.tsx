'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { type EdgeOption, edgeOptionsFor } from '../lib/edges'
import { getAtlasCell, getAtlasCells } from '../lib/exeAssets'
import type { GameArchive } from '../lib/gameArchive'
import { filledSilhouette } from '../lib/image'
import { loadObjectPreviews, type ObjectPreviews } from '../lib/objectPreviews'
import { loadSheetPreviews } from '../lib/sheetPreviews'
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
  exeBuf: GameArchive | null
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

  const [vanilla, setVanilla] = useState<{
    archive: GameArchive
    categoryId: string
    images: ObjectPreviews
    error?: boolean
  } | null>(null)
  useEffect(() => {
    if (!exeBuf || !category) return
    let cancelled = false
    loadObjectPreviews(exeBuf, catalog, category).then(
      (images) => {
        if (!cancelled)
          setVanilla({ archive: exeBuf, categoryId: category.id, images })
      },
      () => {
        if (!cancelled)
          setVanilla({
            archive: exeBuf,
            categoryId: category.id,
            images: { base: {}, soul: {} },
            error: true,
          })
      }
    )
    return () => {
      cancelled = true
    }
  }, [exeBuf, category, catalog])
  const currentVanilla =
    vanilla?.archive === exeBuf && vanilla?.categoryId === category?.id
      ? vanilla
      : null
  const defaults = currentVanilla?.images ?? { base: {}, soul: {} }
  const defaultsLoading = Boolean(exeBuf && category && !currentVanilla)
  const defaultsError = currentVanilla?.error

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

      {defaultsLoading && (
        <p
          role='status'
          className='animate-pulse text-muted-foreground text-sm motion-reduce:animate-none'
        >
          Loading vanilla art for {category?.label}…
        </p>
      )}
      {defaultsError && (
        <p role='alert' className='text-sm'>
          The game archive loaded, but this category’s vanilla art could not be
          read. You can still add your own art.
        </p>
      )}
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
          key={sheet.id}
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
  return objs.filter((o) => Boolean(p.objects[objId(catId, o.key)])).length
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
  defaults: ObjectPreviews
  exeBuf: GameArchive | null
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
    const o = (catalog.spriteObjects[categoryId] ?? []).find(
      (x) => x.key === key
    )
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
        source: opt.sourceKey
          ? defaults.base[opt.sourceKey]
          : defaults.base[o.key],
      }))
      .filter((opt) => opt.value === 'shape' || Boolean(opt.source))
    // Internal art footprint for the crop aspect lock. Prefer the catalog's
    // measured value; fall back to 69×93 for card-shaped P_CENTERS before the
    // catalog is regenerated with per-type artPx/artPy.
    const artW = cat.artPx ?? (cat.registry === 'P_CENTERS' ? 69 : undefined)
    const artH = cat.artPy ?? (cat.registry === 'P_CENTERS' ? 93 : undefined)
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
            return Array.from(
              { length: cat.frames },
              (_, f) => map[`f${f}`]
            ).filter((s): s is string => Boolean(s))
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
      defaultPreview: defaults.base[key],
      loadDefaultPreview: exeBuf
        ? () =>
            loadObjectPreviews(exeBuf, catalog, cat).then(
              (images) => images.base[key]
            )
        : undefined,
      defaultSoulPreview: defaults.soul[key],
      loadDefaultSoulPreview:
        exeBuf && o.soul
          ? () =>
              loadObjectPreviews(exeBuf, catalog, cat).then(
                (images) => images.soul[key]
              )
          : undefined,
      soulShader: o.soulShader,
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
          Click a tile to add art, a soul, a shader, or a border. Upload a GIF
          to make the object animated in-game.
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
              defaultPreview={defaults.base[o.key]}
              overlay={edit?.soul}
              defaultOverlay={defaults.soul[o.key]}
              overlayHidden={edit?.hideSoul}
              overlayShader={o.soulShader}
              hasEdit={Boolean(edit)}
              shaderOption={edit?.shader}
              shaderExe={exeBuf}
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
  exeBuf: GameArchive | null
}) {
  const { openAsset } = useAssetModal()
  const edits: SheetEdit = project.sheets[sheet.id] ?? {}
  const ratio = sheet.px / sheet.py
  const [vanilla, setVanilla] = useState<{
    archive: GameArchive
    images: Record<string, string>
    error?: string
  } | null>(null)
  useEffect(() => {
    if (!exeBuf) return
    let cancelled = false
    loadSheetPreviews(exeBuf, sheet).then(
      (images) => !cancelled && setVanilla({ archive: exeBuf, images }),
      (error) =>
        !cancelled &&
        setVanilla({
          archive: exeBuf,
          images: {},
          error: error instanceof Error ? error.message : String(error),
        })
    )
    return () => {
      cancelled = true
    }
  }, [exeBuf, sheet])
  const defaults = vanilla?.archive === exeBuf ? (vanilla?.images ?? {}) : {}
  const vanillaFor = (index: number) => ({
    defaultPreview: defaults[index],
    loadDefaultPreview: exeBuf
      ? () => loadSheetPreviews(exeBuf, sheet).then((images) => images[index])
      : undefined,
  })
  const previewStatus =
    exeBuf &&
    (vanilla?.archive !== exeBuf ? (
      <p role='status' className='text-muted-foreground text-xs'>
        Loading original game art…
      </p>
    ) : (
      vanilla.error && (
        <p role='alert' className='text-sm'>
          Could not load original game art: {vanilla.error}
        </p>
      )
    ))

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
        {previewStatus}
        <div className='w-72'>
          <UploadTile
            label={sheet.label}
            ratio={wholeRatio}
            preview={edits[0]}
            defaultPreview={defaults[0]}
            onOpen={() =>
              openAsset({
                kind: 'cell',
                title: sheet.label,
                targetW: wholeW,
                targetH: wholeH,
                value: edits[0],
                ...vanillaFor(0),
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
        {previewStatus}
        <div className='w-40'>
          <UploadTile
            label={`${sheet.label} (${frames} frames)`}
            ratio={ratio}
            preview={edits[0]}
            defaultPreview={defaults[0]}
            onOpen={() =>
              openAsset({
                kind: 'cell',
                title: `${sheet.label} (${frames} frames)`,
                targetW: sheet.px,
                targetH: sheet.py,
                value: edits[0],
                ...vanillaFor(0),
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
        {(Object.keys(edits).length > 0 ||
          Object.keys(defaults).length > 0) && (
          <div className='flex gap-1'>
            {Array.from({ length: frames }, (_, i) => (
              <div key={i} className='w-12'>
                <UploadTile
                  label={`f${i}`}
                  small
                  ratio={ratio}
                  preview={edits[i]}
                  defaultPreview={defaults[i]}
                  onOpen={() =>
                    openAsset({
                      kind: 'cell',
                      title: `${sheet.label} · frame ${i}`,
                      targetW: sheet.px,
                      targetH: sheet.py,
                      value: edits[i],
                      ...vanillaFor(i),
                      commit: (d: string | null) =>
                        setSheetCell(sheet.id, i, d),
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
      {previewStatus}
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
              defaultPreview={defaults[i]}
              onOpen={() =>
                openAsset({
                  kind: 'cell',
                  title: name,
                  targetW: sheet.px,
                  targetH: sheet.py,
                  value: edits[i],
                  ...vanillaFor(i),
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
