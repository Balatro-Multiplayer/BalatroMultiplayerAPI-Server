'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ShaderCanvas } from './shader-canvas'

/** A click-to-edit tile that previews the user's own image (or faded vanilla
 *  art). Clicking opens the shared asset modal; the hover-X quick-clears. When a
 *  shader + exe are given, the real edition shader animates over the art. */
export function UploadTile({
  label,
  sublabel,
  preview,
  defaultPreview,
  ratio = 71 / 95,
  small = false,
  shaderOption,
  shaderExe,
  onOpen,
  onClear,
}: {
  label: string
  sublabel?: string
  preview?: string
  defaultPreview?: string // vanilla art shown faded when there's no upload
  ratio?: number
  small?: boolean
  shaderOption?: string
  shaderExe?: Uint8Array | null
  onOpen: () => void
  onClear?: () => void
}) {
  const art = preview ?? defaultPreview
  return (
    <div className={cn('group relative', small ? 'w-10' : 'w-full')}>
      <button
        type='button'
        onClick={onOpen}
        title={label}
        style={{ aspectRatio: String(ratio) }}
        className={cn(
          'flex w-full items-center justify-center overflow-hidden rounded border bg-[length:12px_12px] bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)] transition hover:border-primary',
          preview ? 'border-primary' : 'border-dashed'
        )}
      >
        {art ? (
          <div className='relative h-[95%] w-[95%]'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={art}
              alt={label}
              className={cn(
                'absolute inset-0 h-full w-full object-contain',
                !preview && 'opacity-40'
              )}
              style={{ imageRendering: 'pixelated' }}
            />
            {shaderOption && shaderExe && (
              <ShaderCanvas sprite={art} option={shaderOption} exeBuf={shaderExe} />
            )}
          </div>
        ) : (
          <span className='px-1 text-center text-[10px] text-muted-foreground'>
            {small ? '+' : 'Edit'}
          </span>
        )}
      </button>
      {preview && onClear && (
        <button
          type='button'
          onClick={onClear}
          className='absolute -top-1 -right-1 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block'
          title='Clear'
        >
          <X className='size-3' />
        </button>
      )}
      {!small && (
        <div className='mt-1 truncate text-center text-xs' title={label}>
          {label}
        </div>
      )}
      {!small && sublabel && (
        <div className='truncate text-center text-[10px] text-muted-foreground'>
          {sublabel}
        </div>
      )}
    </div>
  )
}
