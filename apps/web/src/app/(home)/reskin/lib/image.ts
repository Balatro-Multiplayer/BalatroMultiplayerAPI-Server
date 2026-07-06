// Browser-only canvas helpers: previews of the user's own uploads, atlas
// packing/compositing, and frame extraction. No game assets are referenced.
// Pixel-art scaling uses nearest-neighbour (imageSmoothingEnabled = false).

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('Failed to read file'))
    r.readAsDataURL(file)
  })
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  return c
}

function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.imageSmoothingEnabled = false
  return ctx
}

export async function canvasToBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png')
  )
  return new Uint8Array(await blob.arrayBuffer())
}

export interface PlacedCell {
  col: number
  row: number
  dataUrl: string
}

/** Compose a packed/override atlas: place each cell's image into its grid rect
 *  at the given resolution scale. Empty rects stay transparent. */
export async function composeAtlas(opts: {
  cols: number
  rows: number
  px: number
  py: number
  scale: 1 | 2
  cells: PlacedCell[]
}): Promise<Uint8Array> {
  const { cols, rows, px, py, scale, cells } = opts
  const cw = px * scale
  const ch = py * scale
  const c = newCanvas(cols * cw, rows * ch)
  const ctx = ctxOf(c)
  for (const cell of cells) {
    const img = await loadImage(cell.dataUrl)
    ctx.drawImage(img, cell.col * cw, cell.row * ch, cw, ch)
  }
  return canvasToBytes(c)
}

/** Draw a single uploaded image across an entire atlas at the target size. */
export async function composeWhole(opts: {
  width: number
  height: number
  dataUrl: string
}): Promise<Uint8Array> {
  const img = await loadImage(opts.dataUrl)
  const c = newCanvas(opts.width, opts.height)
  ctxOf(c).drawImage(img, 0, 0, opts.width, opts.height)
  return canvasToBytes(c)
}

/** Slice an image into `count` equal horizontal frames as data URLs. */
async function sliceStrip(
  img: HTMLImageElement,
  count: number
): Promise<string[]> {
  const fw = Math.floor(img.width / count) || img.width
  const fh = img.height
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const c = newCanvas(fw, fh)
    ctxOf(c).drawImage(img, i * fw, 0, fw, fh, 0, 0, fw, fh)
    out.push(c.toDataURL('image/png'))
  }
  return out
}

interface DecodedFrame {
  image: CanvasImageSource & {
    close?: () => void
    displayWidth?: number
    displayHeight?: number
    codedWidth?: number
    codedHeight?: number
    duration?: number // per-frame display duration, microseconds
  }
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n))

/** Extract exactly `expected` frames from an uploaded animation. Animated GIFs
 *  are decoded via the ImageDecoder API; anything else is treated as a
 *  horizontal frame-strip. The result is resampled to `expected` frames. */
export async function extractFrames(
  file: File,
  expected: number
): Promise<string[]> {
  const isGif =
    file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')
  const Decoder = (
    globalThis as unknown as { ImageDecoder?: new (init: unknown) => unknown }
  ).ImageDecoder

  if (isGif && Decoder) {
    try {
      const dec = new Decoder({
        data: await file.arrayBuffer(),
        type: 'image/gif',
      }) as {
        tracks: {
          ready: Promise<void>
          selectedTrack?: { frameCount: number }
        }
        decode: (o: { frameIndex: number }) => Promise<DecodedFrame>
      }
      await dec.tracks.ready
      const count = dec.tracks.selectedTrack?.frameCount ?? 1
      const frames: string[] = []
      for (let i = 0; i < count; i++) {
        const { image } = await dec.decode({ frameIndex: i })
        const w = image.displayWidth ?? image.codedWidth ?? 1
        const h = image.displayHeight ?? image.codedHeight ?? 1
        const c = newCanvas(w, h)
        ctxOf(c).drawImage(image, 0, 0)
        image.close?.()
        frames.push(c.toDataURL('image/png'))
      }
      return Array.from(
        { length: expected },
        (_, i) =>
          frames[
            Math.min(
              frames.length - 1,
              Math.round((i * frames.length) / expected)
            )
          ]!
      )
    } catch {
      // fall through to strip handling
    }
  }

  const img = await loadImage(await fileToDataUrl(file))
  return sliceStrip(img, expected)
}

/** Extract every frame of an uploaded animation at its native frame count, plus
 *  the animation's mean frame rate (fps). Balatro plays an animation atlas at a
 *  single fps (`current_frame = floor(fps*t) % frames`), so a per-frame-varying
 *  GIF collapses to one averaged rate. Falls back to a single still + 10fps when
 *  the file is not a decodable animation. */
export async function extractFramesNative(
  file: File
): Promise<{ frames: string[]; fps: number }> {
  const Decoder = (
    globalThis as unknown as { ImageDecoder?: new (init: unknown) => unknown }
  ).ImageDecoder

  if (Decoder) {
    try {
      const dec = new Decoder({
        data: await file.arrayBuffer(),
        type: file.type || 'image/gif',
      }) as {
        tracks: {
          ready: Promise<void>
          selectedTrack?: { frameCount: number }
        }
        decode: (o: { frameIndex: number }) => Promise<DecodedFrame>
      }
      await dec.tracks.ready
      const count = dec.tracks.selectedTrack?.frameCount ?? 1
      const frames: string[] = []
      let totalDur = 0
      let durCount = 0
      for (let i = 0; i < count; i++) {
        const { image } = await dec.decode({ frameIndex: i })
        const w = image.displayWidth ?? image.codedWidth ?? 1
        const h = image.displayHeight ?? image.codedHeight ?? 1
        const c = newCanvas(w, h)
        ctxOf(c).drawImage(image, 0, 0)
        if (typeof image.duration === 'number' && image.duration > 0) {
          totalDur += image.duration
          durCount++
        }
        image.close?.()
        frames.push(c.toDataURL('image/png'))
      }
      if (frames.length === 0) throw new Error('no frames')
      const fps = durCount > 0 ? clamp(1e6 / (totalDur / durCount), 1, 60) : 10
      return { frames, fps: Math.round(fps * 100) / 100 }
    } catch {
      // fall through to single-still handling
    }
  }

  return { frames: [await fileToDataUrl(file)], fps: 10 }
}

// --- editor primitives ------------------------------------------------------
// Pure canvas transforms used by the upload editor. All take/return PNG data
// URLs and preserve nearest-neighbour scaling (ctxOf disables smoothing).

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Copy a sub-rectangle of `src` (in source pixels) into a `rect.w × rect.h` image. */
export async function cropImage(src: string, rect: Rect): Promise<string> {
  const img = await loadImage(src)
  const c = newCanvas(rect.w, rect.h)
  ctxOf(c).drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  return c.toDataURL('image/png')
}

/** Draw `src` into `box` on an otherwise-transparent `cellW × cellH` canvas.
 *  Used to place footprint-fitted art at a card's real position within the cell. */
export async function placeInto(
  src: string,
  cellW: number,
  cellH: number,
  box: Rect
): Promise<string> {
  const img = await loadImage(src)
  const c = newCanvas(cellW, cellH)
  ctxOf(c).drawImage(
    img,
    0,
    0,
    img.width,
    img.height,
    box.x,
    box.y,
    box.w,
    box.h
  )
  return c.toDataURL('image/png')
}

export type FitMode = 'stretch' | 'contain' | 'cover'

/** Resize `src` into a `dstW × dstH` image.
 *  - stretch: fill the whole cell, distorting aspect (today's implicit squish)
 *  - contain: preserve aspect, transparent letterbox
 *  - cover: preserve aspect, fill and crop the overflow */
export async function fitInto(
  src: string,
  dstW: number,
  dstH: number,
  mode: FitMode = 'stretch'
): Promise<string> {
  const img = await loadImage(src)
  const c = newCanvas(dstW, dstH)
  const ctx = ctxOf(c)
  const sw = img.width || 1
  const sh = img.height || 1
  if (mode === 'stretch') {
    ctx.drawImage(img, 0, 0, sw, sh, 0, 0, dstW, dstH)
  } else {
    const scale =
      mode === 'contain'
        ? Math.min(dstW / sw, dstH / sh)
        : Math.max(dstW / sw, dstH / sh)
    const dw = sw * scale
    const dh = sh * scale
    ctx.drawImage(img, 0, 0, sw, sh, (dstW - dw) / 2, (dstH - dh) / 2, dw, dh)
  }
  return c.toDataURL('image/png')
}

/** Build an opaque-white silhouette of `src` (alpha >= threshold) plus the tight
 *  bounding box of its non-transparent pixels. The "rubber-band" footprint used
 *  to place and clip art onto a card's real shape (not a rectangle). */
export async function alphaMask(
  src: string,
  opts: { threshold?: number } = {}
): Promise<{ maskDataUrl: string; bbox: Rect }> {
  const threshold = opts.threshold ?? 1
  const img = await loadImage(src)
  const w = img.width || 1
  const h = img.height || 1
  const c = newCanvas(w, h)
  const ctx = ctxOf(c)
  ctx.drawImage(img, 0, 0)
  const px = ctx.getImageData(0, 0, w, h).data
  const out = ctx.createImageData(w, h)
  const op = out.data
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (px[i + 3]! >= threshold) {
        op[i] = 255
        op[i + 1] = 255
        op[i + 2] = 255
        op[i + 3] = 255
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  ctx.putImageData(out, 0, 0)
  const bbox: Rect =
    maxX < 0
      ? { x: 0, y: 0, w: 0, h: 0 }
      : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  return { maskDataUrl: c.toDataURL('image/png'), bbox }
}

/** Clip `art` to `mask` (mask scaled to art size) via destination-in. */
export async function applyMask(art: string, mask: string): Promise<string> {
  const [a, m] = await Promise.all([loadImage(art), loadImage(mask)])
  const c = newCanvas(a.width, a.height)
  const ctx = ctxOf(c)
  ctx.drawImage(a, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(m, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

/** Procedural rounded-rectangle card silhouette — the offline default shape
 *  (transparent corner pixels) when no vanilla mask is available. */
export function roundedCornerMask(
  w: number,
  h: number,
  radius: number
): string {
  const c = newCanvas(w, h)
  const ctx = ctxOf(c)
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.arcTo(w, 0, w, h, r)
  ctx.arcTo(w, h, 0, h, r)
  ctx.arcTo(0, h, 0, 0, r)
  ctx.arcTo(0, 0, w, 0, r)
  ctx.closePath()
  ctx.fill()
  return c.toDataURL('image/png')
}

/** Erode `mask` inward by `px` and split it into the eroded `interior` and the
 *  `ring` (original − interior). The ring locates a card's frame/border band. */
export async function erodeMask(
  mask: string,
  px: number
): Promise<{ ring: string; interior: string }> {
  const img = await loadImage(mask)
  const w = img.width || 1
  const h = img.height || 1
  const src = newCanvas(w, h)
  const sctx = ctxOf(src)
  sctx.drawImage(img, 0, 0)
  const data = sctx.getImageData(0, 0, w, h).data
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! >= 128

  const interiorC = newCanvas(w, h)
  const ringC = newCanvas(w, h)
  const ictx = ctxOf(interiorC)
  const rctx = ctxOf(ringC)
  const iData = ictx.createImageData(w, h)
  const rData = rctx.createImageData(w, h)
  const id = iData.data
  const rd = rData.data
  const r = Math.max(1, Math.round(px))
  const r2 = r * r
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue
      const i = (y * w + x) * 4
      let eroded = true
      for (let dy = -r; dy <= r && eroded; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r2) continue
          if (!opaque(x + dx, y + dy)) {
            eroded = false
            break
          }
        }
      }
      const tgt = eroded ? id : rd
      tgt[i] = 255
      tgt[i + 1] = 255
      tgt[i + 2] = 255
      tgt[i + 3] = 255
    }
  }
  ictx.putImageData(iData, 0, 0)
  rctx.putImageData(rData, 0, 0)
  return {
    interior: interiorC.toDataURL('image/png'),
    ring: ringC.toDataURL('image/png'),
  }
}

/** Place `art` (clipped to `interiorMask`) behind a `frame` overlay image. The
 *  output is the frame's size; used to wrap art in an extracted card border. */
export async function compositeBorder(
  art: string,
  interiorMask: string,
  frame: string
): Promise<string> {
  const clipped = await applyMask(art, interiorMask)
  const [base, over] = await Promise.all([loadImage(clipped), loadImage(frame)])
  const c = newCanvas(over.width, over.height)
  const ctx = ctxOf(c)
  ctx.drawImage(base, 0, 0, c.width, c.height)
  ctx.drawImage(over, 0, 0)
  return c.toDataURL('image/png')
}
