'use client'

import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { clipBlindFrames, composeBlindSingle } from '../lib/blinds'
import { buildEdge, type EdgeOption } from '../lib/edges'
import {
  applyMask,
  cropImage,
  extractFrames,
  extractFramesNative,
  type FitMode,
  fileToDataUrl,
  fitInto,
  loadImage,
  type Rect,
  renderSprite,
} from '../lib/image'
import {
  type EdgeMode,
  type ObjectEdit,
  type RenderSettings,
  SHADER_OPTIONS,
} from '../lib/types'

// --- request shapes ---------------------------------------------------------

/** Which contextual options a surface exposes. */
export interface AssetCaps {
  soul?: boolean // object has a soul overlay slot
  shader?: boolean // P_CENTERS default-shader picker
  animated?: boolean // frame-based category (blinds): whole-strip/GIF ingest
  gif?: boolean // static category that turns a GIF into a per-object animation
}

interface CommonReq {
  title: string
  targetW: number
  targetH: number
  artW?: number // internal footprint for the crop aspect lock
  artH?: number
}

export type AssetRequest =
  | (CommonReq & {
      kind: 'object'
      caps: AssetCaps
      framesCount?: number // category frame count (blinds)
      edges?: EdgeOption[] // shape/border options (sources pre-resolved)
      defaultPreview?: string // the object's vanilla cell: silhouette + preview
      // Vanilla animation frames (blinds), for the chip shape + shine overlay.
      loadFrames?: () => Promise<string[]>
      value: ObjectEdit | undefined
      commit: (edit: ObjectEdit) => void
    })
  | (CommonReq & {
      kind: 'cell'
      value: string | undefined
      commit: (dataUrl: string | null) => void
      clipShape?: string // mask a cell upload is clipped to (e.g. the chip shape)
      // Animated sheet main tile: ingest a strip/GIF into N cells at once.
      animatedStrip?: { frames: number; onStrip: (slices: string[]) => void }
    })
  | (CommonReq & {
      kind: 'icon'
      value: string | undefined
      commit: (dataUrl: string | null) => void
    })

// --- provider / hook --------------------------------------------------------

interface AssetModalCtx {
  openAsset: (req: AssetRequest) => void
}

const Ctx = createContext<AssetModalCtx | null>(null)

export function useAssetModal(): AssetModalCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAssetModal must be used within AssetModalProvider')
  return c
}

export function AssetModalProvider({
  children,
}: {
  children: ReactNode
}) {
  const [open, setOpen] = useState<{ req: AssetRequest; id: number } | null>(
    null
  )
  const nextId = useRef(0)
  const openAsset = useCallback((req: AssetRequest) => {
    nextId.current += 1
    setOpen({ req, id: nextId.current })
  }, [])
  const value = useMemo(() => ({ openAsset }), [openAsset])

  return (
    <Ctx.Provider value={value}>
      {children}
      {open && (
        // key remounts the modal per open so its working state is fresh
        <AssetModal
          key={open.id}
          request={open.req}
          onClose={() => setOpen(null)}
        />
      )}
    </Ctx.Provider>
  )
}

// --- modal ------------------------------------------------------------------

const isGif = (f: File) =>
  f.type === 'image/gif' || f.name.toLowerCase().endsWith('.gif')

const SHADER_NONE = '__none__'
const EDGE_NONE = '__none__'

function AssetModal({
  request,
  onClose,
}: {
  request: AssetRequest
  onClose: () => void
}) {
  const [work, setWork] = useState<ObjectEdit>(() =>
    request.kind === 'object'
      ? (request.value ?? { sprites: [] })
      : { sprites: [] }
  )
  const [cellValue, setCellValue] = useState<string | undefined>(() =>
    request.kind === 'object' ? undefined : request.value
  )
  const [cropping, setCropping] = useState<{
    file: File
    target: 'main' | 'soul' | 'cell' | 'icon'
  } | null>(null)
  const [busy, setBusy] = useState(false)
  // Animated-object (blind) upload: how to read the file + whether to add the
  // game's shine when a single image is used.
  const [animMode, setAnimMode] = useState<'single' | 'sheet' | 'gif'>('single')
  const [overlay, setOverlay] = useState(true)
  const mainRef = useRef<HTMLInputElement>(null)
  const soulRef = useRef<HTMLInputElement>(null)

  const commitObject = useCallback(
    (next: ObjectEdit) => {
      setWork(next)
      if (request.kind === 'object') request.commit(next)
    },
    [request]
  )

  const onPickMain = useCallback(
    async (file: File) => {
      setBusy(true)
      try {
        if (request.kind === 'object') {
          if (request.caps.animated && (request.framesCount ?? 1) > 1) {
            // Single image is cropped, then composed with the chip shape/shine.
            if (animMode === 'single') {
              setCropping({ file, target: 'main' })
              return
            }
            const frames = await extractFrames(file, request.framesCount ?? 1)
            const vanilla = request.loadFrames ? await request.loadFrames() : []
            const sprites = await clipBlindFrames(frames, vanilla[0])
            commitObject({ ...work, sprites, base: undefined, render: undefined })
            return
          }
          if (request.caps.gif && isGif(file)) {
            const { frames, fps } = await extractFramesNative(file)
            commitObject({
              ...work,
              sprites: frames,
              fps,
              base: undefined,
              render: undefined,
            })
            return
          }
          setCropping({ file, target: 'main' })
        } else if (request.kind === 'cell') {
          if (request.animatedStrip && animMode !== 'single') {
            const slices = await extractFrames(file, request.animatedStrip.frames)
            request.animatedStrip.onStrip(slices)
            setCellValue(slices[0])
            return
          }
          setCropping({ file, target: 'cell' })
        } else {
          setCropping({ file, target: 'icon' })
        }
      } finally {
        setBusy(false)
      }
    },
    [request, work, commitObject, animMode]
  )

  // Render an object sprite from a base + settings, lifting the edge assets
  // (silhouette + border ring) for the chosen edge option.
  const buildObjectSprite = useCallback(
    async (base: string, render: RenderSettings): Promise<string> => {
      if (request.kind !== 'object') return base
      const option = request.edges?.find((e) => e.value === render.edge)
      const { interior, ring } = await buildEdge(option, request.defaultPreview, {
        w: request.targetW,
        h: request.targetH,
      })
      return renderSprite(base, render, {
        targetW: request.targetW,
        targetH: request.targetH,
        interior,
        ring,
      })
    },
    [request]
  )

  const onCropApply = useCallback(
    async (cropped: string, fit: FitMode) => {
      const target = cropping?.target
      setBusy(true)
      try {
        if (
          request.kind === 'object' &&
          target === 'main' &&
          request.caps.animated &&
          (request.framesCount ?? 1) > 1
        ) {
          // Single-image blind: clip to the chip shape (+ optional shine).
          const vanilla = request.loadFrames ? await request.loadFrames() : []
          let sprites: string[]
          if (vanilla.length) {
            sprites = await composeBlindSingle(cropped, vanilla, {
              targetW: request.targetW,
              targetH: request.targetH,
              fit,
              overlay,
            })
          } else {
            const one = await fitInto(cropped, request.targetW, request.targetH, fit)
            sprites = Array.from({ length: request.framesCount ?? 1 }, () => one)
          }
          commitObject({ ...work, sprites, base: undefined, render: undefined })
        } else if (request.kind === 'object' && target === 'main') {
          const firstUpload = !work.base && work.sprites.length === 0
          // Default new card art to the object's own silhouette.
          const hasShape = request.edges?.some((e) => e.value === 'shape')
          const render: RenderSettings = {
            ...(work.render ?? {}),
            fit,
            ...(firstUpload && hasShape ? { edge: 'shape' as const } : {}),
          }
          const final = await buildObjectSprite(cropped, render)
          commitObject({ ...work, base: cropped, render, sprites: [final] })
        } else if (request.kind === 'object' && target === 'soul') {
          const soul = await fitInto(cropped, request.targetW, request.targetH, fit)
          commitObject({ ...work, soul })
        } else if (
          request.kind === 'cell' &&
          request.animatedStrip &&
          animMode === 'single'
        ) {
          // Single image → repeat across the animated sheet's frames.
          const one = await fitInto(cropped, request.targetW, request.targetH, fit)
          request.animatedStrip.onStrip(
            Array.from({ length: request.animatedStrip.frames }, () => one)
          )
          setCellValue(one)
        } else if (request.kind === 'cell' || request.kind === 'icon') {
          let final = await fitInto(cropped, request.targetW, request.targetH, fit)
          if (request.kind === 'cell' && request.clipShape) {
            final = await applyMask(final, request.clipShape)
          }
          request.commit(final)
          setCellValue(final)
        }
      } finally {
        setBusy(false)
        setCropping(null)
      }
    },
    [cropping, request, work, commitObject, buildObjectSprite, overlay, animMode]
  )

  const setEdge = useCallback(
    async (edge: EdgeMode | undefined) => {
      if (request.kind !== 'object') return
      setBusy(true)
      try {
        const render = { ...(work.render ?? {}), edge }
        const hasUpload = Boolean(work.base)
        const renderBase = work.base ?? request.defaultPreview
        if (renderBase && (hasUpload || edge)) {
          const final = await buildObjectSprite(renderBase, render)
          commitObject({ ...work, render, sprites: [final] })
        } else {
          commitObject({
            ...work,
            render,
            sprites: hasUpload ? work.sprites : [],
          })
        }
      } finally {
        setBusy(false)
      }
    },
    [request, work, commitObject, buildObjectSprite]
  )

  const removeMain = useCallback(() => {
    if (request.kind === 'object') {
      commitObject({ ...work, sprites: [], base: undefined, render: undefined })
    } else {
      request.commit(null)
      setCellValue(undefined)
    }
  }, [request, work, commitObject])

  // --- derived preview ------------------------------------------------------
  const obj = request.kind === 'object' ? request : null
  const caps = obj?.caps
  const previewMain = obj ? work.sprites[0] : cellValue
  const previewDefault =
    obj && !work.sprites[0] ? obj.defaultPreview : undefined
  const soul = obj ? work.soul : undefined

  const scale = Math.max(
    1,
    Math.floor(300 / Math.max(request.targetW, request.targetH))
  )
  const dispW = request.targetW * scale
  const dispH = request.targetH * scale

  const isAnim = Boolean(
    obj && (work.sprites.length > 1 || obj.caps.animated)
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-4xl'>
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
        </DialogHeader>

        {cropping ? (
          <CropStage
            file={cropping.file}
            targetW={request.targetW}
            targetH={request.targetH}
            artW={request.artW}
            artH={request.artH}
            initialFit={work.render?.fit ?? 'stretch'}
            onCancel={() => setCropping(null)}
            onApply={onCropApply}
          />
        ) : (
          <div className='flex flex-wrap gap-6'>
            {/* large preview */}
            <div className='flex flex-col items-center gap-2'>
              <div
                className='relative bg-[length:12px_12px] bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)]'
                style={{ width: dispW, height: dispH }}
              >
                {previewMain ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewMain}
                    alt='preview'
                    className='absolute inset-0 h-full w-full object-contain'
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : previewDefault ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewDefault}
                    alt='vanilla default'
                    className='absolute inset-0 h-full w-full object-contain opacity-40'
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : (
                  <span className='absolute inset-0 flex items-center justify-center text-muted-foreground text-xs'>
                    No image
                  </span>
                )}
                {soul && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={soul}
                    alt='soul overlay'
                    className='pointer-events-none absolute inset-0 h-full w-full object-contain'
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
              </div>
              <p className='text-muted-foreground text-xs'>
                {request.targetW}×{request.targetH}
              </p>
            </div>

            {/* controls */}
            <div className='flex flex-1 flex-col gap-4'>
              <input
                ref={mainRef}
                type='file'
                accept={caps?.animated || caps?.gif ? 'image/*' : 'image/png,image/*'}
                className='hidden'
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onPickMain(f)
                  if (mainRef.current) mainRef.current.value = ''
                }}
              />
              {((obj && caps?.animated) ||
                (request.kind === 'cell' && request.animatedStrip)) && (
                <div className='space-y-1'>
                  <Label>Upload as</Label>
                  <Select
                    value={animMode}
                    onValueChange={(v) =>
                      setAnimMode(v as 'single' | 'sheet' | 'gif')
                    }
                  >
                    <SelectTrigger className='w-48'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='single'>Single image</SelectItem>
                      <SelectItem value='sheet'>Sprite sheet</SelectItem>
                      <SelectItem value='gif'>GIF</SelectItem>
                    </SelectContent>
                  </Select>
                  {animMode === 'single' && obj?.loadFrames && (
                    <div className='flex items-center gap-2 pt-1'>
                      <Switch
                        id='blind-overlay'
                        checked={overlay}
                        disabled={busy}
                        onCheckedChange={setOverlay}
                      />
                      <Label htmlFor='blind-overlay'>
                        Add the game’s shine animation
                      </Label>
                    </div>
                  )}
                </div>
              )}
              <div className='flex flex-wrap gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={busy}
                  onClick={() => mainRef.current?.click()}
                >
                  {previewMain ? 'Replace image' : 'Add image'}
                </Button>
                {previewMain && (
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={busy}
                    onClick={removeMain}
                  >
                    Remove
                  </Button>
                )}
              </div>

              {isAnim && (
                <p className='text-muted-foreground text-xs'>
                  {caps?.animated
                    ? animMode === 'single'
                      ? `${obj?.framesCount ?? 21}-frame blind: your image is clipped to the chip shape${obj?.loadFrames && overlay ? ', with the game’s shine added' : ''}.`
                      : `${obj?.framesCount ?? 21}-frame blind: upload a GIF or horizontal frame-strip.`
                    : `Animated GIF (${work.sprites.length}f @ ${work.fps ?? 10}fps). Shape/border options apply to stills only.`}
                </p>
              )}

              {/* soul */}
              {obj && caps?.soul && (
                <div className='space-y-1'>
                  <Label>Soul overlay</Label>
                  <input
                    ref={soulRef}
                    type='file'
                    accept='image/png,image/*'
                    className='hidden'
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) setCropping({ file: f, target: 'soul' })
                      if (soulRef.current) soulRef.current.value = ''
                    }}
                  />
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={busy}
                      onClick={() => soulRef.current?.click()}
                    >
                      {work.soul ? 'Replace soul' : 'Add soul'}
                    </Button>
                    {work.soul && (
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={busy}
                        onClick={() => commitObject({ ...work, soul: undefined })}
                      >
                        Remove soul
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* edge treatment: shape clip or a lifted border (stills only) */}
              {obj && !isAnim && obj.edges && obj.edges.length > 0 && (
                <div className='space-y-1'>
                  <Label>Border</Label>
                  <Select
                    value={work.render?.edge ?? EDGE_NONE}
                    onValueChange={(v) =>
                      setEdge(v === EDGE_NONE ? undefined : (v as EdgeMode))
                    }
                  >
                    <SelectTrigger className='w-56'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EDGE_NONE}>None</SelectItem>
                      {obj.edges.map((e) => (
                        <SelectItem key={e.value} value={e.value}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className='text-muted-foreground text-xs'>
                    {obj.defaultPreview
                      ? 'Shapes and borders are lifted from your Balatro.exe and composited onto this card.'
                      : 'Import Balatro.exe for exact shapes and borders.'}
                  </p>
                </div>
              )}

              {/* shader (metadata flag; no visual preview change) */}
              {obj && caps?.shader && (
                <div className='space-y-1'>
                  <Label>Default shader</Label>
                  <Select
                    value={work.shader ?? SHADER_NONE}
                    onValueChange={(v) =>
                      commitObject({
                        ...work,
                        shader: v === SHADER_NONE ? undefined : v,
                      })
                    }
                  >
                    <SelectTrigger className='w-48'>
                      <SelectValue placeholder='shader' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SHADER_NONE}>no shader</SelectItem>
                      {SHADER_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className='text-muted-foreground text-xs'>
                    A default edition/shader applied in-game (visual only).
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {!cropping && (
          <DialogFooter>
            <Button onClick={onClose} disabled={busy}>
              Done
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- crop stage -------------------------------------------------------------

const MAX_DISPLAY = 360
const MIN_CROP = 4

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'

// Fit modes plus 'card', which locks the crop to the internal art footprint.
type CropMode = FitMode | 'card'

interface DragState {
  mode: DragMode
  startX: number
  startY: number
  startRect: Rect
  scale: number
  imgW: number
  imgH: number
  aspect: number
}

function clampRect(
  r: Rect,
  iw: number,
  ih: number,
  mode: DragMode,
  aspect: number
): Rect {
  let { x, y, w, h } = r
  if (aspect > 0 && mode !== 'move') {
    const anchorRight = mode === 'nw' || mode === 'sw'
    const anchorBottom = mode === 'nw' || mode === 'ne'
    h = w / aspect
    // Cap to the image while preserving the locked aspect, so neither side can
    // grow past the original width or height.
    if (w > iw) {
      w = iw
      h = w / aspect
    }
    if (h > ih) {
      h = ih
      w = h * aspect
    }
    if (w < MIN_CROP) {
      w = MIN_CROP
      h = w / aspect
    }
    if (h < MIN_CROP) {
      h = MIN_CROP
      w = h * aspect
    }
    if (anchorRight) x = r.x + r.w - w
    if (anchorBottom) y = r.y + r.h - h
  }
  w = Math.max(MIN_CROP, Math.min(w, iw))
  h = Math.max(MIN_CROP, Math.min(h, ih))
  x = Math.max(0, Math.min(x, iw - w))
  y = Math.max(0, Math.min(y, ih - h))
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** The largest `aspect`-ratio rect that fits inside the image, centered. */
function aspectRect(iw: number, ih: number, aspect: number): Rect {
  let w = iw
  let h = w / aspect
  if (h > ih) {
    h = ih
    w = h * aspect
  }
  return {
    x: Math.round((iw - w) / 2),
    y: Math.round((ih - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  }
}

/** Crop marquee + fit + aspect lock. Returns the raw cropped source and fit mode
 *  (the parent applies shape/border afterward). */
function CropStage({
  file,
  targetW,
  targetH,
  artW,
  artH,
  initialFit,
  onApply,
  onCancel,
}: {
  file: File
  targetW: number
  targetH: number
  artW?: number
  artH?: number
  initialFit: FitMode
  onApply: (cropped: string, fit: FitMode) => void
  onCancel: () => void
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [mode, setMode] = useState<CropMode>(initialFit)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<DragState | null>(null)

  const hasArt = Boolean(artW && artH)
  // The aspect the 'card' lock enforces: the internal footprint if provided.
  const lockAspect = artW && artH ? artW / artH : targetW / targetH
  const aspectLock = mode === 'card'
  // How the cropped art fills the cell; 'card' crops to shape then fills.
  const fillMode: FitMode = mode === 'card' ? 'stretch' : mode

  useEffect(() => {
    let live = true
    fileToDataUrl(file).then(async (url) => {
      const img = await loadImage(url)
      if (!live) return
      setSrc(url)
      setImgSize({ w: img.width, h: img.height })
      setRect({ x: 0, y: 0, w: img.width, h: img.height })
    })
    return () => {
      live = false
    }
  }, [file])

  const scale = useMemo(() => {
    if (!imgSize) return 1
    return Math.min(MAX_DISPLAY / imgSize.w, MAX_DISPLAY / imgSize.h)
  }, [imgSize])

  // Live "raw fit" preview (shape/border are applied later, in the overview).
  useEffect(() => {
    if (!src || !rect || rect.w < 1 || rect.h < 1) return
    let live = true
    ;(async () => {
      const cropped = await cropImage(src, rect)
      const out = await fitInto(cropped, targetW, targetH, fillMode)
      if (live) setPreview(out)
    })()
    return () => {
      live = false
    }
  }, [src, rect, fillMode, targetW, targetH])

  const handleMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.startX) / d.scale
    const dy = (e.clientY - d.startY) / d.scale
    let { x, y, w, h } = d.startRect
    if (d.mode === 'move') {
      x += dx
      y += dy
    } else {
      if (d.mode === 'nw' || d.mode === 'sw') {
        x += dx
        w -= dx
      }
      if (d.mode === 'ne' || d.mode === 'se') w += dx
      if (d.mode === 'nw' || d.mode === 'ne') {
        y += dy
        h -= dy
      }
      if (d.mode === 'sw' || d.mode === 'se') h += dy
    }
    setRect(clampRect({ x, y, w, h }, d.imgW, d.imgH, d.mode, d.aspect))
  }, [])

  const handleUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleUp)
  }, [handleMove])

  const beginDrag = (mode: DragMode) => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!rect || !imgSize) return
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startRect: rect,
      scale,
      imgW: imgSize.w,
      imgH: imgSize.h,
      aspect: aspectLock ? lockAspect : 0,
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const apply = async () => {
    if (!src || !rect) return
    setBusy(true)
    try {
      onApply(await cropImage(src, rect), fillMode)
    } finally {
      setBusy(false)
    }
  }

  const dispW = imgSize ? imgSize.w * scale : 0
  const dispH = imgSize ? imgSize.h * scale : 0
  // Big result preview on the left, sized like the overview's joker preview.
  const previewScale = Math.max(1, Math.floor(300 / Math.max(targetW, targetH)))

  return (
    <>
      <div className='flex flex-col gap-6 sm:flex-row'>
        {/* large result preview, mirroring the overview's joker preview */}
        <div className='flex flex-col items-center gap-2 sm:shrink-0'>
          <div
            className='relative bg-[length:12px_12px] bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)]'
            style={{ width: targetW * previewScale, height: targetH * previewScale }}
          >
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt='preview'
                className='absolute inset-0 h-full w-full object-contain'
                style={{ imageRendering: 'pixelated' }}
              />
            )}
          </div>
          <p className='text-muted-foreground text-xs'>
            {targetW}×{targetH}
          </p>
        </div>

        {/* crop box with the fit selector below it */}
        <div className='flex min-w-0 flex-1 flex-col gap-4'>
          <div className='flex flex-col items-center gap-2'>
            <div
              className='relative select-none bg-[length:12px_12px] bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)]'
              style={{ width: dispW, height: dispH }}
            >
              {src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt='upload'
                  draggable={false}
                  className='pointer-events-none absolute inset-0 h-full w-full'
                  style={{ imageRendering: 'pixelated' }}
                />
              )}
              {rect && imgSize && (
                <div
                  onPointerDown={beginDrag('move')}
                  className='absolute cursor-move border-2 border-primary'
                  style={{
                    left: rect.x * scale,
                    top: rect.y * scale,
                    width: rect.w * scale,
                    height: rect.h * scale,
                  }}
                >
                  {(['nw', 'ne', 'sw', 'se'] as DragMode[]).map((h) => (
                    <span
                      key={h}
                      onPointerDown={beginDrag(h)}
                      className='absolute size-3 rounded-sm border border-primary bg-background'
                      style={{
                        cursor: `${h}-resize`,
                        left: h.includes('w') ? -6 : undefined,
                        right: h.includes('e') ? -6 : undefined,
                        top: h.includes('n') ? -6 : undefined,
                        bottom: h.includes('s') ? -6 : undefined,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            <p className='text-muted-foreground text-xs'>
              Drag to move, corners to resize
            </p>
          </div>

          <div className='space-y-1'>
            <Label>Fit</Label>
            <Select
              value={mode}
              onValueChange={(v) => {
                const m = v as CropMode
                setMode(m)
                if (m === 'card' && imgSize) {
                  setRect(aspectRect(imgSize.w, imgSize.h, lockAspect))
                }
              }}
            >
              <SelectTrigger className='w-56'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='stretch'>Stretch (squish)</SelectItem>
                <SelectItem value='contain'>Contain (letterbox)</SelectItem>
                <SelectItem value='cover'>Cover (crop)</SelectItem>
                {hasArt && (
                  <SelectItem value='card'>
                    Card crop ({artW}×{artH})
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {aspectLock && (
              <p className='text-muted-foreground text-xs'>
                Crop locked to {artW}×{artH}; it can’t exceed the image.
              </p>
            )}
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant='ghost' onClick={onCancel} disabled={busy}>
          Back
        </Button>
        <Button onClick={apply} disabled={busy || !rect}>
          {busy ? 'Working…' : 'Apply'}
        </Button>
      </DialogFooter>
    </>
  )
}
