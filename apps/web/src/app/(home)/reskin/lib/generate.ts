// Build a ready-to-install CustomReskin mod ZIP entirely in the browser.
// Packs each category's uploaded sprites into one atlas and emits per-object
// rebinds; composes the all-or-nothing grid sheets as raw overrides.

import { CORE_LUA } from '../templates/coreLua'
import { composeAtlas, composeWhole, loadImage, type PlacedCell } from './image'
import { nestEdits, toLuaModule } from './luaSerialize'
import {
  type Catalog,
  type CatalogSheet,
  objId,
  type ProjectState,
  type SheetEdit,
} from './types'
import { createZip, type ZipEntry, zipText } from './zip'

const PROJECT_FILE = 'reskin.project.json'

function authorList(raw: string): string[] {
  const extra = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((a) => a.toLowerCase() !== 'virtualized')
  return ['Virtualized', ...extra]
}

function manifestJson(p: ProjectState): string {
  const name = p.options.displayName || 'CustomReskin'
  return (
    JSON.stringify(
      {
        id: 'CustomReskin', // never changes, so packs never collide
        name,
        display_name: name,
        author: authorList(p.options.author),
        description:
          'A drop-in reskin and localization pack for Balatro. Built with the BMP Reskin Studio.',
        prefix: 'reskin',
        main_file: 'core.lua',
        priority: -100,
        badge_colour: '5E3B76',
        badge_text_colour: 'FFFFFF',
        version: p.options.version || '1.0.0',
        dependencies: ['Steamodded (>=1.0.0~BETA-1221a)', 'Lovely (>=0.8)'],
      },
      null,
      2
    ) + '\n'
  )
}

function gridFor(n: number): { cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  return { cols, rows: Math.ceil(n / cols) }
}

/** Map a sheet's edited cell indices to placed grid cells. */
function placedForSheet(sheet: CatalogSheet, edits: SheetEdit): PlacedCell[] {
  const cols = sheet.cols ?? sheet.frames ?? 1
  return Object.entries(edits).map(([idxStr, dataUrl]) => {
    const index = Number(idxStr)
    if (sheet.animated) return { col: index, row: 0, dataUrl }
    return { col: index % cols, row: Math.floor(index / cols), dataUrl }
  })
}

export async function generatePack(
  project: ProjectState,
  catalog: Catalog
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const entries: ZipEntry[] = []
  const manifestAtlases: Record<string, unknown>[] = []
  const manifestObjects: Record<string, unknown>[] = []
  // Mod-list icon: only set when the user uploads one (see below).
  let icon: Record<string, unknown> | undefined

  const pushAtlasPng = async (
    name: string,
    cols: number,
    rows: number,
    px: number,
    py: number,
    cells: PlacedCell[]
  ) => {
    entries.push({
      name: `assets/1x/${name}.png`,
      data: await composeAtlas({ cols, rows, px, py, scale: 1, cells }),
    })
    entries.push({
      name: `assets/2x/${name}.png`,
      data: await composeAtlas({ cols, rows, px, py, scale: 2, cells }),
    })
  }

  // --- per-object categories ------------------------------------------------
  for (const cat of catalog.spriteCategories) {
    const objects = catalog.spriteObjects[cat.id] ?? []
    const edited = objects
      .map((o) => ({ o, e: project.objects[objId(cat.id, o.key)] }))
      .filter((x) => x.e && x.e.sprites.some(Boolean))
    if (edited.length === 0) continue

    const atlasName = `cat_${cat.id}`
    const cells: PlacedCell[] = []
    let cols: number
    let rows: number

    if (cat.frames > 1) {
      // animated (blinds): one row of `frames` frames per object
      cols = cat.frames
      rows = edited.length
      edited.forEach(({ e }, row) => {
        for (let f = 0; f < cat.frames; f++) {
          const dataUrl = e!.sprites[f] ?? e!.sprites[e!.sprites.length - 1]
          if (dataUrl) cells.push({ col: f, row, dataUrl })
        }
      })
      edited.forEach(({ o }, row) => {
        manifestObjects.push({
          registry: cat.registry,
          key: o.key,
          atlas: atlasName,
          x: 0,
          y: row,
        })
      })
    } else {
      const g = gridFor(edited.length)
      cols = g.cols
      rows = g.rows
      edited.forEach(({ o, e }, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        cells.push({ col, row, dataUrl: e!.sprites[0]! })
        manifestObjects.push({
          registry: cat.registry,
          key: o.key,
          atlas: atlasName,
          x: col,
          y: row,
        })
      })
    }

    await pushAtlasPng(atlasName, cols, rows, cat.px, cat.py, cells)
    manifestAtlases.push({
      key: atlasName,
      path: `${atlasName}.png`,
      px: cat.px,
      py: cat.py,
      ...(cat.frames > 1 ? { frames: cat.frames } : {}),
    })

    // soul overlays
    const souls = edited.filter((x) => x.e!.soul)
    if (souls.length > 0) {
      const soulName = `${atlasName}_soul`
      const sg = gridFor(souls.length)
      const soulCells: PlacedCell[] = souls.map((x, i) => ({
        col: i % sg.cols,
        row: Math.floor(i / sg.cols),
        dataUrl: x.e!.soul!,
      }))
      await pushAtlasPng(soulName, sg.cols, sg.rows, cat.px, cat.py, soulCells)
      manifestAtlases.push({
        key: soulName,
        path: `${soulName}.png`,
        px: cat.px,
        py: cat.py,
      })
      souls.forEach((x, i) => {
        const obj = manifestObjects.find(
          (m) => m.key === x.o.key && m.registry === cat.registry
        )
        if (obj) {
          obj.soul_atlas = soulName
          obj.soul_x = i % sg.cols
          obj.soul_y = Math.floor(i / sg.cols)
        }
      })
    }
  }

  // --- composed sheets (raw overrides) -------------------------------------
  for (const sheet of catalog.spriteSheets) {
    const edits = project.sheets[sheet.id]
    if (!edits || Object.keys(edits).length === 0) continue
    const cols = sheet.cols ?? sheet.frames ?? 1
    const rows = sheet.rows ?? 1
    if (sheet.mode === 'whole') {
      const dataUrl = edits[0]
      if (!dataUrl) continue
      entries.push({
        name: `assets/1x/${sheet.atlasKey}.png`,
        data: await composeWhole({
          width: cols * sheet.px,
          height: rows * sheet.py,
          dataUrl,
        }),
      })
      entries.push({
        name: `assets/2x/${sheet.atlasKey}.png`,
        data: await composeWhole({
          width: cols * sheet.px * 2,
          height: rows * sheet.py * 2,
          dataUrl,
        }),
      })
    } else {
      const cells = placedForSheet(sheet, edits)
      await pushAtlasPng(sheet.atlasKey, cols, rows, sheet.px, sheet.py, cells)
    }
    manifestAtlases.push({
      key: sheet.atlasKey,
      raw: true,
      path: `${sheet.atlasKey}.png`,
      px: sheet.px,
      py: sheet.py,
      ...(sheet.animated ? { frames: sheet.frames, atlas_table: 'ANIMATION_ATLAS' } : {}),
    })
  }

  // Mod-list icon, only when the user uploaded one (no entry otherwise).
  if (project.options.icon) {
    const img = await loadImage(project.options.icon)
    const px = img.naturalWidth || img.width || 1
    const py = img.naturalHeight || img.height || 1
    entries.push({
      name: 'assets/1x/modicon.png',
      data: await composeWhole({ width: px, height: py, dataUrl: project.options.icon }),
    })
    entries.push({
      name: 'assets/2x/modicon.png',
      data: await composeWhole({
        width: px * 2,
        height: py * 2,
        dataUrl: project.options.icon,
      }),
    })
    icon = { path: 'modicon.png', px, py }
  }

  // --- data/manifest.lua ----------------------------------------------------
  entries.push({
    name: 'data/manifest.lua',
    data: zipText(
      toLuaModule({
        atlases: manifestAtlases,
        objects: manifestObjects,
        sounds: [],
        ...(icon ? { icon } : {}),
      } as never)
    ),
  })

  // --- localization ---------------------------------------------------------
  for (const [lang, edits] of Object.entries(project.loc)) {
    if (!edits || Object.keys(edits).length === 0) continue
    entries.push({
      name: `localization/${lang}.lua`,
      data: zipText(toLuaModule(nestEdits(edits) as never)),
    })
  }

  // --- static files ---------------------------------------------------------
  entries.push({ name: 'CustomReskin.json', data: zipText(manifestJson(project)) })
  entries.push({ name: 'core.lua', data: zipText(CORE_LUA) })
  entries.push({ name: PROJECT_FILE, data: zipText(JSON.stringify(project)) })

  const bytes = createZip(entries)
  const safeName =
    (project.options.displayName || 'CustomReskin')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'CustomReskin'
  return { bytes, fileName: `${safeName}.zip` }
}

export const PROJECT_FILE_NAME = PROJECT_FILE
