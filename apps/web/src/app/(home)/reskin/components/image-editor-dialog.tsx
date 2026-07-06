'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  cropImage,
  type FitMode,
  fileToDataUrl,
  fitInto,
  loadImage,
  type Rect,
} from '../lib/image'

const MAX_DISPLAY = 360 // px the source preview is fit within (may upscale)
const MIN_CROP = 4 // smallest allowed crop side, in source pixels

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'

interface DragState {
  mode: DragMode
  startX: number
  startY: number
  startRect: Rect
  scale: number
  imgW: number
  imgH: number
  aspect: number // target aspect to lock to, 0 = free
}

/** Constrain a crop rect to the image bounds, enforcing a minimum size and an
 *  optional target aspect (anchored at the corner being dragged). */
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
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  }
}

/** Pre-commit editor: pick a crop region of the uploaded image and a fit mode,
 *  producing a PNG sized exactly to the target cell (targetW × targetH). */
export function ImageEditorDialog({
  file,
  targetW,
  targetH,
  onCommit,
  onCancel,
}: {
  file: File
  targetW: number
  targetH: number
  onCommit: (dataUrl: string) => void
  onCancel: () => void
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [fitMode, setFitMode] = useState<FitMode>('stretch')
  const [aspectLock, setAspectLock] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<DragState | null>(null)

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

  // Live preview of the committed result.
  useEffect(() => {
    if (!src || !rect || rect.w < 1 || rect.h < 1) return
    let live = true
    ;(async () => {
      const cropped = await cropImage(src, rect)
      const fitted = await fitInto(cropped, targetW, targetH, fitMode)
      if (live) setPreview(fitted)
    })()
    return () => {
      live = false
    }
  }, [src, rect, fitMode, targetW, targetH])

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

  const beginDrag = (mode: DragMode) => (e: React.PointerEvent) => {
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
      aspect: aspectLock ? targetW / targetH : 0,
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const commit = async () => {
    if (!src || !rect) return
    setBusy(true)
    try {
      const cropped = await cropImage(src, rect)
      const fitted = await fitInto(cropped, targetW, targetH, fitMode)
      onCommit(fitted)
    } finally {
      setBusy(false)
    }
  }

  const dispW = imgSize ? imgSize.w * scale : 0
  const dispH = imgSize ? imgSize.h * scale : 0
  const previewScale = Math.max(1, Math.floor(140 / Math.max(targetW, targetH)))

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
    >
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Edit image</DialogTitle>
        </DialogHeader>

        <div className='flex flex-wrap gap-6'>
          {/* crop stage */}
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

          {/* controls + preview */}
          <div className='flex flex-1 flex-col gap-4'>
            <div className='space-y-1'>
              <Label>Fit</Label>
              <Select
                value={fitMode}
                onValueChange={(v) => setFitMode(v as FitMode)}
              >
                <SelectTrigger className='w-48'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='stretch'>Stretch (squish)</SelectItem>
                  <SelectItem value='contain'>Contain (letterbox)</SelectItem>
                  <SelectItem value='cover'>Cover (crop)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='flex items-center gap-2'>
              <Switch
                id='aspect-lock'
                checked={aspectLock}
                onCheckedChange={setAspectLock}
              />
              <Label htmlFor='aspect-lock'>Lock crop to card shape</Label>
            </div>

            <div className='space-y-1'>
              <Label>
                Preview ({targetW}×{targetH})
              </Label>
              <div className='inline-block bg-[length:12px_12px] bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)]'>
                {preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview}
                    alt='preview'
                    style={{
                      width: targetW * previewScale,
                      height: targetH * previewScale,
                      imageRendering: 'pixelated',
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={busy || !rect}>
            {busy ? 'Working…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
