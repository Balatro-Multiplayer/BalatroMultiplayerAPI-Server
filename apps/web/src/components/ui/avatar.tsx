'use client'

import * as AvatarPrimitive from '@radix-ui/react-avatar'
import type * as React from 'react'

import { env } from '@/env'
import { cn } from '@/lib/utils'
import { CDN_URL } from '@/shared/constants'

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot='avatar'
      className={cn(
        'relative flex size-8 shrink-0 overflow-hidden rounded-full',
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  src,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  const isDev = env.NODE_ENV === 'development'
  let finalSrc = src
  if (typeof src === 'string' && src.startsWith('/') && !isDev) {
    finalSrc = `${CDN_URL}${src}`
  }
  return (
    <AvatarPrimitive.Image
      data-slot='avatar-image'
      className={cn('aspect-square size-full object-cover!', className)}
      src={finalSrc}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot='avatar-fallback'
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted',
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
