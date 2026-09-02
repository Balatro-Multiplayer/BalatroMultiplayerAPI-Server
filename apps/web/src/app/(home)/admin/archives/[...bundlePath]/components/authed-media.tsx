'use client'

import { useEffect, useState } from 'react'
import { apiFetchBlob } from '@/lib/api'

// Bearer-token auth means a plain <img>/<video> src can't hit an
// authenticated endpoint directly -- fetch the bytes as a Blob (with the
// auth header apiFetch normally attaches) and point the element at a local
// object URL instead. Revokes the previous object URL on every src change
// and on unmount so archives with hundreds of attachments don't leak memory.
function useAuthedObjectUrl(apiPath: string): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    apiFetchBlob(apiPath)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [apiPath])

  return url
}

export function AuthedImage({
  apiPath,
  alt,
}: {
  apiPath: string
  alt: string
}) {
  const url = useAuthedObjectUrl(apiPath)
  if (!url) return <div className='h-20 w-20 animate-pulse rounded bg-muted' />
  return (
    // biome-ignore lint/performance/noImgElement: src is a client-generated blob: URL (see useAuthedObjectUrl) -- next/image's remote-optimization pipeline doesn't apply to it
    <img
      src={url}
      alt={alt}
      loading='lazy'
      className='max-h-80 max-w-80 rounded-lg'
    />
  )
}

export function AuthedVideo({ apiPath }: { apiPath: string }) {
  const url = useAuthedObjectUrl(apiPath)
  if (!url) return <div className='h-20 w-40 animate-pulse rounded bg-muted' />
  // biome-ignore lint/a11y/useMediaCaption: archived content has no captions to attach
  return <video src={url} controls className='max-w-md rounded-lg' />
}
