// Minimal, dependency-free ZIP reader/writer (STORE / no compression).
//
// We only ever produce STORE entries, so the matching reader only needs to
// handle method 0, which is enough for round-tripping our own packs. PNGs are
// already compressed, so storing them uncompressed costs little.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function writeU32(arr: number[], v: number) {
  arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
}
function writeU16(arr: number[], v: number) {
  arr.push(v & 0xff, (v >>> 8) & 0xff)
}

/** Build a STORE-only ZIP from the given entries. */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: number[] = []
  let offset = 0

  for (const e of entries) {
    const nameBytes = enc.encode(e.name)
    const crc = crc32(e.data)
    const size = e.data.length

    const local: number[] = []
    writeU32(local, 0x04034b50) // local file header sig
    writeU16(local, 20) // version needed
    writeU16(local, 0) // flags
    writeU16(local, 0) // method: store
    writeU16(local, 0) // mod time
    writeU16(local, 0) // mod date
    writeU32(local, crc)
    writeU32(local, size) // compressed size
    writeU32(local, size) // uncompressed size
    writeU16(local, nameBytes.length)
    writeU16(local, 0) // extra len
    const localHeader = new Uint8Array(local)

    chunks.push(localHeader, nameBytes, e.data)
    const localTotal = localHeader.length + nameBytes.length + e.data.length

    // central directory record
    writeU32(central, 0x02014b50)
    writeU16(central, 20) // version made by
    writeU16(central, 20) // version needed
    writeU16(central, 0) // flags
    writeU16(central, 0) // method
    writeU16(central, 0) // time
    writeU16(central, 0) // date
    writeU32(central, crc)
    writeU32(central, size)
    writeU32(central, size)
    writeU16(central, nameBytes.length)
    writeU16(central, 0) // extra
    writeU16(central, 0) // comment
    writeU16(central, 0) // disk number
    writeU16(central, 0) // internal attrs
    writeU32(central, 0) // external attrs
    writeU32(central, offset) // local header offset
    for (const b of nameBytes) central.push(b)

    offset += localTotal
  }

  const centralBytes = new Uint8Array(central)
  const eocd: number[] = []
  writeU32(eocd, 0x06054b50)
  writeU16(eocd, 0) // disk
  writeU16(eocd, 0) // disk with cd
  writeU16(eocd, entries.length)
  writeU16(eocd, entries.length)
  writeU32(eocd, centralBytes.length)
  writeU32(eocd, offset) // cd offset
  writeU16(eocd, 0) // comment len
  const eocdBytes = new Uint8Array(eocd)

  const total =
    chunks.reduce((n, c) => n + c.length, 0) + centralBytes.length + eocdBytes.length
  const out = new Uint8Array(total)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  out.set(centralBytes, p)
  p += centralBytes.length
  out.set(eocdBytes, p)
  return out
}

function readU32(b: Uint8Array, o: number) {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0
}
function readU16(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8)
}

/** Read a STORE-method ZIP into a name->bytes map. Deflated entries are skipped. */
export function readZip(buf: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  // locate EOCD by scanning backwards for its signature
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (readU32(buf, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record)')

  const count = readU16(buf, eocd + 10)
  let p = readU32(buf, eocd + 16) // central directory offset

  for (let i = 0; i < count; i++) {
    if (readU32(buf, p) !== 0x02014b50) break
    const method = readU16(buf, p + 10)
    const compSize = readU32(buf, p + 20)
    const nameLen = readU16(buf, p + 28)
    const extraLen = readU16(buf, p + 30)
    const commentLen = readU16(buf, p + 32)
    const localOff = readU32(buf, p + 42)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))

    // jump to local header to find the data start
    const lhNameLen = readU16(buf, localOff + 26)
    const lhExtraLen = readU16(buf, localOff + 28)
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen
    if (method === 0) {
      out.set(name, buf.subarray(dataStart, dataStart + compSize))
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export const zipText = (s: string) => enc.encode(s)
export const unzipText = (b: Uint8Array) => dec.decode(b)
