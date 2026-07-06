// Read texture atlases out of the user's own Balatro.exe, entirely in the
// browser, to derive an optional card-border template. A LÖVE-fused game exe is
// a Windows PE with a full ZIP concatenated after it, so archive offsets are
// relative to the ZIP's start, not byte 0 — we recover that base. Nothing is
// uploaded; the file is read locally and only the user's own output uses it.

import { alphaMask, applyMask, cropImage, erodeMask, type Rect } from './image'
import { flattenLoc, parseLocLua } from './locLua'
import type { LocValues } from './types'

const readU32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0
const readU16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8)

interface ZipEntry {
  method: number
  data: Uint8Array // raw (possibly deflated) member bytes
}

/** Parse the central directory of a (possibly fused) ZIP, correcting every
 *  offset by the archive's base position within the file. */
export function readFusedZip(buf: Uint8Array): Map<string, ZipEntry> {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (readU32(buf, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0)
    throw new Error('Not a ZIP archive (no end-of-central-directory)')

  const count = readU16(buf, eocd + 10)
  const cdSize = readU32(buf, eocd + 12)
  const cdOff = readU32(buf, eocd + 16)
  // Where the ZIP actually begins inside the file (0 for a plain .zip).
  const archiveBase = eocd - cdSize - cdOff
  const dec = new TextDecoder()

  const out = new Map<string, ZipEntry>()
  let p = archiveBase + cdOff
  for (let n = 0; n < count; n++) {
    if (readU32(buf, p) !== 0x02014b50) break // central-directory header sig
    const method = readU16(buf, p + 10)
    const compSize = readU32(buf, p + 20)
    const nameLen = readU16(buf, p + 28)
    const extraLen = readU16(buf, p + 30)
    const commentLen = readU16(buf, p + 32)
    const localOff = readU32(buf, p + 42)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))

    const lh = archiveBase + localOff
    const lhNameLen = readU16(buf, lh + 26)
    const lhExtraLen = readU16(buf, lh + 28)
    const dataStart = lh + 30 + lhNameLen + lhExtraLen
    out.set(name, {
      method,
      data: buf.subarray(dataStart, dataStart + compSize),
    })

    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Inflate a raw DEFLATE stream via the browser's DecompressionStream. */
export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const DS = (
    globalThis as unknown as {
      DecompressionStream?: new (fmt: string) => ReadableWritablePair
    }
  ).DecompressionStream
  if (!DS) {
    throw new Error(
      'This browser lacks DecompressionStream (needed to read .exe)'
    )
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DS('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Extract a single cell (in atlas pixels) from a texture inside the archive. */
export async function getAtlasCell(
  buf: Uint8Array,
  path: string,
  cell: Rect
): Promise<string> {
  const entry = readFusedZip(buf).get(path)
  if (!entry) throw new Error(`${path} not found in the game archive`)
  const png = entry.method === 0 ? entry.data : await inflateRaw(entry.data)
  const url = URL.createObjectURL(
    new Blob([png as BlobPart], { type: 'image/png' })
  )
  try {
    return await cropImage(url, cell)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Inflate an atlas once and crop many cells from it — for showing every
 *  object's vanilla art as a default. Each request maps 1:1 to a result. */
export async function getAtlasCells(
  buf: Uint8Array,
  path: string,
  cells: Array<{ id: string; rect: Rect }>
): Promise<Record<string, string>> {
  const entry = readFusedZip(buf).get(path)
  if (!entry) throw new Error(`${path} not found in the game archive`)
  const png = entry.method === 0 ? entry.data : await inflateRaw(entry.data)
  const url = URL.createObjectURL(
    new Blob([png as BlobPart], { type: 'image/png' })
  )
  try {
    const out: Record<string, string> = {}
    for (const { id, rect } of cells) out[id] = await cropImage(url, rect)
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Read and flatten a language's localization from the exe into the same
 *  path->value map the studio's Localization tab consumes (no shipped text). */
export async function readLocFromExe(
  exe: Uint8Array,
  lang: string
): Promise<LocValues> {
  const entry = readFusedZip(exe).get(`localization/${lang}.lua`)
  if (!entry)
    throw new Error(`localization/${lang}.lua not found in the archive`)
  const bytes = entry.method === 0 ? entry.data : await inflateRaw(entry.data)
  const text = new TextDecoder('utf-8').decode(bytes)
  const node = parseLocLua(text) as Record<string, unknown>
  return flattenLoc({
    descriptions: (node.descriptions ?? {}) as never,
    misc: (node.misc ?? {}) as never,
  })
}

/** A card frame lifted from the vanilla base Joker: its coloured outer border
 *  ring plus the interior mask user art is drawn into and clipped to. */
export interface BorderTemplate {
  ring: string // coloured border pixels (transparent interior)
  interior: string // mask of the interior region
}

// The plain Joker (j_joker) sits at cell (0,0) in Jokers.png.
const JOKER_ATLAS = 'Jokers.png'
const JOKER_PX = 71
const JOKER_PY = 95
const DEFAULT_RING_WIDTH = 4

/** Build a border template from the user's Balatro.exe. Reads the base Joker
 *  cell, takes its silhouette, and splits it into an outer ring (the frame) and
 *  an interior region. Applied later via compositeBorder. */
export async function extractJokerBorder(
  exe: Uint8Array,
  opts: { scale?: 1 | 2; ringWidth?: number } = {}
): Promise<BorderTemplate> {
  const scale = opts.scale ?? 1
  const px = JOKER_PX * scale
  const py = JOKER_PY * scale
  const cell = await getAtlasCell(
    exe,
    `resources/textures/${scale}x/${JOKER_ATLAS}`,
    {
      x: 0,
      y: 0,
      w: px,
      h: py,
    }
  )
  const { maskDataUrl } = await alphaMask(cell, { threshold: 16 })
  const { ring, interior } = await erodeMask(
    maskDataUrl,
    (opts.ringWidth ?? DEFAULT_RING_WIDTH) * scale
  )
  const ringImg = await applyMask(cell, ring)
  return { ring: ringImg, interior }
}
