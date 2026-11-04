import { getAtlasCells } from './exeAssets'
import type { GameArchive } from './gameArchive'
import type { Rect } from './image'
import type { CatalogSheet } from './types'

// Registry atlas keys do not always match their on-disk PNG filenames.
const FILES: Record<string, string> = {
  cards_1: '8BitDeck.png',
  cards_2: '8BitDeck_opt2.png',
  chips: 'chips.png',
  shop_sign: 'ShopSignAnimation.png',
}

export function sheetPreviewPlan(sheet: CatalogSheet): {
  path: string
  cells: Array<{ id: string; rect: Rect }>
} {
  const file = FILES[sheet.atlasKey]
  if (!file) throw new Error(`No vanilla atlas mapping for ${sheet.label}`)
  const cols =
    sheet.mode === 'animated' ? (sheet.frames ?? 1) : (sheet.cols ?? 1)
  const rows = sheet.rows ?? 1
  const count =
    sheet.mode === 'whole'
      ? 1
      : sheet.mode === 'animated'
        ? (sheet.frames ?? 1)
        : sheet.cells.length || cols * rows
  return {
    path: `resources/textures/1x/${file}`,
    cells: Array.from({ length: count }, (_, i) => ({
      id: String(i),
      rect:
        sheet.mode === 'whole'
          ? { x: 0, y: 0, w: cols * sheet.px, h: rows * sheet.py }
          : {
              x: (sheet.cells[i]?.x ?? i % cols) * sheet.px,
              y: (sheet.cells[i]?.y ?? Math.floor(i / cols)) * sheet.py,
              w: sheet.px,
              h: sheet.py,
            },
    })),
  }
}

const cache = new WeakMap<
  GameArchive,
  Map<string, Promise<Record<string, string>>>
>()

/** Tiles and an immediately opened modal share one atlas extraction. Cache by
 * archive identity so replacing/forgetting an import cannot reuse its old art. */
export function loadSheetPreviews(
  archive: GameArchive,
  sheet: CatalogSheet
): Promise<Record<string, string>> {
  let sheets = cache.get(archive)
  if (!sheets) {
    sheets = new Map()
    cache.set(archive, sheets)
  }
  const existing = sheets.get(sheet.id)
  if (existing) return existing
  const { path, cells } = sheetPreviewPlan(sheet)
  const pending = getAtlasCells(archive, path, cells)
  sheets.set(sheet.id, pending)
  void pending.catch(() => sheets.delete(sheet.id))
  return pending
}
