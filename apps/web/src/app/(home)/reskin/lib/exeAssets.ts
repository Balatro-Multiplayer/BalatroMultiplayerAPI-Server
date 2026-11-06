// Read texture atlases out of the user's own Balatro.exe or Balatro.love,
// entirely in the browser. A LÖVE-fused game exe is
// a Windows PE with a full ZIP concatenated after it, so archive offsets are
// relative to the ZIP's start, not byte 0 — we recover that base. Nothing is
// uploaded; the file is read locally and only the user's own output uses it.

import { inflateSync } from 'fflate'
import { GameArchive } from './gameArchive'
import { cropImage, type Rect } from './image'
import { flattenLoc, parseLocLua } from './locLua'
import type { LocValues } from './types'

const readU32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0
const readU16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8)

interface ZipEntry {
  method: number
  size: number // uncompressed size, checked before extracting an app's .love
  data: Uint8Array // raw (possibly deflated) member bytes
}

/** Parse the central directory of a (possibly fused) ZIP, correcting every
 *  offset by the archive's base position within the file. */
export function readFusedZip(source: Uint8Array | GameArchive): Map<string, ZipEntry> {
  const buf = source instanceof GameArchive ? source.readBytes() : source
  let eocd = -1
  // A fused Windows executable can have data after the ZIP (e.g. a signing
  // trailer). Keep that compatibility, but skip signature bytes in comments
  // or trailers unless they point to an actual central directory.
  for (let i = buf.length - 22; i >= 0; i--) {
    if (
      readU32(buf, i) !== 0x06054b50 ||
      i + 22 + readU16(buf, i + 20) > buf.length
    )
      continue
    const directoryStart = i - readU32(buf, i + 12)
    const empty =
      i === 0 &&
      readU16(buf, i + 10) === 0 &&
      readU32(buf, i + 12) === 0 &&
      readU32(buf, i + 16) === 0
    if (
      empty ||
      (directoryStart >= 0 &&
        directoryStart + 46 <= i &&
        readU32(buf, directoryStart) === 0x02014b50)
    ) {
      eocd = i
      break
    }
  }
  if (eocd < 0)
    throw new Error('Not a ZIP archive (no end-of-central-directory)')

  const count = readU16(buf, eocd + 10)
  const cdSize = readU32(buf, eocd + 12)
  const cdOff = readU32(buf, eocd + 16)
  if (
    readU16(buf, eocd + 4) !== 0 ||
    readU16(buf, eocd + 6) !== 0 ||
    readU16(buf, eocd + 8) !== count ||
    count === 0xffff ||
    cdSize === 0xffffffff ||
    cdOff === 0xffffffff
  ) {
    throw new Error(
      'Split and ZIP64 archives are not supported. Choose Balatro.love directly.'
    )
  }
  // Where the ZIP actually begins inside the file (0 for a plain .love/.zip).
  const archiveBase = eocd - cdSize - cdOff
  if (archiveBase < 0) throw new Error('Invalid ZIP directory offset')
  const cdStart = archiveBase + cdOff
  const dec = new TextDecoder()

  const out = new Map<string, ZipEntry>()
  let p = cdStart
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || readU32(buf, p) !== 0x02014b50) {
      throw new Error('Invalid ZIP directory entry')
    }
    const flags = readU16(buf, p + 8)
    const method = readU16(buf, p + 10)
    const compSize = readU32(buf, p + 20)
    const size = readU32(buf, p + 24)
    const nameLen = readU16(buf, p + 28)
    const extraLen = readU16(buf, p + 30)
    const commentLen = readU16(buf, p + 32)
    const localOff = readU32(buf, p + 42)
    const next = p + 46 + nameLen + extraLen + commentLen
    if (
      next > eocd ||
      localOff === 0xffffffff ||
      size === 0xffffffff ||
      compSize === 0xffffffff
    ) {
      throw new Error('Invalid or ZIP64 directory entry')
    }
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) {
      throw new Error(
        'Encrypted or unsupported ZIP compression. Choose Balatro.love directly.'
      )
    }
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))
    if (out.has(name)) throw new Error('Duplicate ZIP entry')

    const lh = archiveBase + localOff
    if (lh + 30 > cdStart || readU32(buf, lh) !== 0x04034b50) {
      throw new Error('Invalid ZIP local header')
    }
    const lhNameLen = readU16(buf, lh + 26)
    const lhExtraLen = readU16(buf, lh + 28)
    const dataStart = lh + 30 + lhNameLen + lhExtraLen
    if (dataStart + compSize > cdStart || (method === 0 && compSize !== size)) {
      throw new Error('Truncated ZIP entry')
    }
    out.set(name, {
      method,
      size,
      data: buf.subarray(dataStart, dataStart + compSize),
    })

    p = next
  }
  if (p !== eocd) throw new Error('Invalid ZIP directory size')
  return out
}

/** Prefer native decompression; older Safari versions need the JS fallback.
 *  Bound output by the ZIP's declared size rather than inflating arbitrary data. */
export async function inflateRaw(
  bytes: Uint8Array,
  size: number,
  onProgress?: (loaded: number) => void
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(size) || size < 0 || size > 256 * 1024 * 1024) {
    throw new Error('ZIP entry exceeds the 256 MiB extraction limit')
  }
  let decompressor: DecompressionStream | null = null
  try {
    decompressor = new DecompressionStream('deflate-raw')
  } catch {
    // Some browsers expose DecompressionStream but not deflate-raw.
  }
  if (!decompressor) {
    // One spare byte distinguishes an oversized stream from an exact fit.
    const out = inflateSync(bytes, { out: new Uint8Array(size + 1) })
    if (out.length !== size) throw new Error('Invalid ZIP entry size')
    onProgress?.(out.length)
    return out
  }
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(decompressor)
    .getReader()
  const out = new Uint8Array(size)
  let offset = 0
  let lastReport = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.length > size)
        throw new Error('Invalid ZIP entry size')
      out.set(value, offset)
      offset += value.length
      const now = Date.now()
      if (now - lastReport >= 100 || offset === size) {
        onProgress?.(offset)
        lastReport = now
      }
    }
    if (offset !== size) throw new Error('Truncated ZIP entry')
    return out
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

/** Extract a single cell (in atlas pixels) from a texture inside the archive. */
export async function getAtlasCell(
  buf: Uint8Array | GameArchive,
  path: string,
  cell: Rect
): Promise<string> {
  const entry = readFusedZip(buf).get(path)
  if (!entry) throw new Error(`${path} not found in the game archive`)
  const png =
    entry.method === 0 ? entry.data : await inflateRaw(entry.data, entry.size)
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
  buf: Uint8Array | GameArchive,
  path: string,
  cells: Array<{ id: string; rect: Rect }>
): Promise<Record<string, string>> {
  const entry = readFusedZip(buf).get(path)
  if (!entry) throw new Error(`${path} not found in the game archive`)
  const png =
    entry.method === 0 ? entry.data : await inflateRaw(entry.data, entry.size)
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
  exe: Uint8Array | GameArchive,
  lang: string
): Promise<LocValues> {
  const entry = readFusedZip(exe).get(`localization/${lang}.lua`)
  if (!entry)
    throw new Error(`localization/${lang}.lua not found in the archive`)
  const bytes =
    entry.method === 0 ? entry.data : await inflateRaw(entry.data, entry.size)
  const text = new TextDecoder('utf-8').decode(bytes)
  const node = parseLocLua(text) as Record<string, unknown>
  return flattenLoc({
    descriptions: (node.descriptions ?? {}) as never,
    misc: (node.misc ?? {}) as never,
  })
}
