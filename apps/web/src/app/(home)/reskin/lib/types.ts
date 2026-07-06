// Shared types for the CustomReskin Studio (per-object model).

export interface CatalogCategory {
  id: string
  label: string
  registry: 'P_CENTERS' | 'P_BLINDS' | 'P_TAGS' | 'P_SEALS' | 'P_STAKES'
  px: number
  py: number
  frames: number // 1 for static, >1 for animated (blinds = 21)
  animated: boolean
  soul: boolean // any object in the category has a soul overlay
}

export interface CatalogObject {
  key: string
  name: string
  soul?: boolean
  pos?: { x: number; y: number } // cell in the vanilla atlas
  // Odd-shaped objects (half/square joker, cut-outs) ship a 1-bit alpha
  // silhouette (base64 PNG, no data-URL prefix) plus the tight footprint box,
  // so uploads can be fit onto and clipped to the real card shape.
  mask?: string
  maskBox?: { x: number; y: number; w: number; h: number }
}

export interface CatalogSheetCell {
  key?: string
  name?: string
  x?: number
  y?: number
  index?: number
}

export interface CatalogSheet {
  id: string
  label: string
  atlasKey: string
  group?: 'objects' | 'sheets'
  mode: 'whole' | 'cells' | 'animated'
  px: number
  py: number
  cols?: number
  rows?: number
  frames?: number
  animated?: boolean
  cells: CatalogSheetCell[]
  note?: string
}

export interface LocField {
  key: string
  label: string
  path: string // real game loc path, e.g. "descriptions.Joker.j_x.name"
  multiline: boolean
}

/** Per-language value map: loc path -> current value, served from public/. */
export type LocValues = Record<string, string | string[]>

export interface LocItem {
  key: string
  label: string
  fields: LocField[]
}

export interface LocGroup {
  id: string
  label: string
  items: LocItem[]
}

export interface Catalog {
  generatedFrom: string
  languages: string[]
  spriteCategories: CatalogCategory[]
  spriteObjects: Record<string, CatalogObject[]>
  spriteSheets: CatalogSheet[]
  locGroups: LocGroup[]
}

// --- project (editor) state -------------------------------------------------

/** One object's uploaded art. `sprites` length equals the category frame count
 *  (1 for static, 21 for blinds). A static object with >1 sprite is an uploaded
 *  GIF animation; `fps` is its playback rate (Balatro plays it on its own
 *  per-object animation atlas). `soul` is the optional overlay layer. */
export interface ObjectEdit {
  sprites: string[] // PNG data URLs
  soul?: string
  fps?: number // animation rate when sprites.length > 1 (uploaded GIF)
}

/** A composed sheet's per-cell uploads: cell index -> PNG data URL. */
export type SheetEdit = Record<number, string>

/** lang -> dot-path -> value, e.g. "descriptions.Joker.j_x.name" -> "Foo". */
export type LocEdits = Record<string, Record<string, string | string[]>>

export interface ProjectOptions {
  displayName: string
  author: string // comma-separated; "Virtualized" is always credited first
  version: string
  icon?: string // PNG data URL for the mod-list icon
}

export interface ProjectState {
  schema: 2
  options: ProjectOptions
  objects: Record<string, ObjectEdit> // key = `${categoryId}/${objectKey}`
  sheets: Record<string, SheetEdit> // key = sheetId
  loc: LocEdits
}

export function emptyProject(): ProjectState {
  return {
    schema: 2,
    options: { displayName: 'My Reskin', author: '', version: '1.0.0' },
    objects: {},
    sheets: {},
    loc: {},
  }
}

export const objId = (categoryId: string, key: string) => `${categoryId}/${key}`
