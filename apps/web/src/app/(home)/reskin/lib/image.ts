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
  }
}

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
