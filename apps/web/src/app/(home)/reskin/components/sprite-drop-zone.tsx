'use client'

import { type CSSProperties, type ReactNode, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { spriteUploadFile } from '../lib/spriteDrop'

/** Wrap the existing preview, so dropping follows the same path as the picker. */
export function SpriteDropZone({
  children,
  disabled,
  target,
  style,
  onFile,
  onError,
}: {
  children: ReactNode
  disabled: boolean
  target: 'image' | 'background' | 'overlay'
  style: CSSProperties
  onFile: (file: File) => void
  onError: (message: string) => void
}) {
  const depth = useRef(0)
  const [over, setOver] = useState(false)
  const active = over && !disabled
  return (
    <>
      <section
        aria-label={`Drop a replacement ${target}`}
        aria-disabled={disabled}
        aria-busy={disabled}
        className={cn(
          'relative bg-[length:12px_12px] bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)] transition-shadow',
          active &&
            'rounded-sm ring-2 ring-primary ring-offset-2 ring-offset-background'
        )}
        style={style}
        onDragEnter={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (
            disabled ||
            !Array.from(event.dataTransfer.types).includes('Files')
          )
            return
          depth.current += 1
          setOver(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          event.stopPropagation()
          depth.current = Math.max(0, depth.current - 1)
          if (!depth.current) setOver(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          depth.current = 0
          setOver(false)
          if (disabled) return
          try {
            // Read synchronously: browsers protect DataTransfer after dispatch.
            const file = spriteUploadFile(event.dataTransfer.files)
            onFile(file)
          } catch (error) {
            onError(error instanceof Error ? error.message : String(error))
          }
        }}
      >
        {children}
        {active && (
          <span className='pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80 p-3 text-center font-medium text-sm'>
            Drop to replace {target}
          </span>
        )}
      </section>
      <p className='text-center text-muted-foreground text-xs' role='status'>
        {disabled
          ? 'Processing image…'
          : `Drop an image onto the preview to replace the ${target}.`}
      </p>
    </>
  )
}
