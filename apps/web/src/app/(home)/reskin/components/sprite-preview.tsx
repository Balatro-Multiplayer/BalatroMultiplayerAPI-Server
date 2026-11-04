'use client'

import { cn } from '@/lib/utils'
import type { GameArchive } from '../lib/gameArchive'
import { ShaderCanvas } from './shader-canvas'

export type PreviewLayer = 'combined' | 'base' | 'soul'

/** Keep original and replacement layers independent: replacing a background
 * must not discard a floating portrait, and overlay-only edits keep the base. */
export function SpritePreview({
  label,
  preview,
  defaultPreview,
  overlay,
  defaultOverlay,
  overlayHidden,
  layer = 'combined',
  shaderOption,
  overlayShader,
  exeBuf,
}: {
  label: string
  preview?: string
  defaultPreview?: string
  overlay?: string
  defaultOverlay?: string
  overlayHidden?: boolean
  layer?: PreviewLayer
  shaderOption?: string
  overlayShader?: string
  exeBuf?: GameArchive | null
}) {
  const base = preview ?? defaultPreview
  const soul = overlayHidden ? undefined : (overlay ?? defaultOverlay)
  return (
    <>
      {base && layer !== 'soul' && (
        <div className={cn('absolute inset-0', !preview && 'opacity-40')}>
          {/* Local data URLs: Next image optimization must not upload game art. */}
          {/* biome-ignore lint/performance/noImgElement: local browser-only sprite */}
          <img
            draggable={false}
            src={base}
            alt={`${label} background${preview ? '' : ' (original)'}`}
            className='absolute inset-0 h-full w-full object-contain'
            style={{ imageRendering: 'pixelated' }}
          />
          {shaderOption && exeBuf && (
            <ShaderCanvas sprite={base} option={shaderOption} exeBuf={exeBuf} />
          )}
        </div>
      )}
      {soul && layer !== 'base' && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0',
            !overlay && 'opacity-40'
          )}
        >
          {/* biome-ignore lint/performance/noImgElement: local browser-only sprite */}
          <img
            draggable={false}
            src={soul}
            alt={`${label} overlay${overlay ? '' : ' (original)'}`}
            className='absolute inset-0 h-full w-full object-contain'
            style={{ imageRendering: 'pixelated' }}
          />
          {overlayShader && exeBuf && (
            <ShaderCanvas
              sprite={soul}
              option={overlayShader}
              exeBuf={exeBuf}
            />
          )}
        </div>
      )}
    </>
  )
}
