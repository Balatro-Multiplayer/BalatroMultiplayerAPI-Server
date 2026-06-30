'use client'

import { X } from 'lucide-react'
import { useRef } from 'react'
import { cn } from '@/lib/utils'

/** A square click-to-upload tile that previews the user's own image. */
export function UploadTile({
  label,
  sublabel,
  preview,
  accept = 'image/png,image/*',
  ratio = 71 / 95,
  small = false,
  onFile,
  onClear,
}: {
  label: string
  sublabel?: string
  preview?: string
  accept?: string
  ratio?: number
  small?: boolean
  onFile: (file: File) => void
  onClear?: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className={cn('group relative', small ? 'w-10' : 'w-full')}>
      <input
        ref={ref}
        type='file'
        accept={accept}
        className='hidden'
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          if (ref.current) ref.current.value = ''
        }}
      />
      <button
        type='button'
        onClick={() => ref.current?.click()}
        title={label}
        style={{ aspectRatio: String(ratio) }}
        className={cn(
          'flex w-full items-center justify-center overflow-hidden rounded border bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)] bg-[length:12px_12px] transition hover:border-primary',
          preview ? 'border-primary' : 'border-dashed'
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={label}
            className='max-h-full max-w-full object-contain'
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <span className='px-1 text-center text-[10px] text-muted-foreground'>
            {small ? '+' : 'Upload'}
          </span>
        )}
      </button>
      {preview && onClear && (
        <button
          type='button'
          onClick={onClear}
          className='-right-1 -top-1 absolute hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block'
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
