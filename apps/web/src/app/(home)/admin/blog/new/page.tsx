'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { BlogPostEditor } from '@/components/admin/blog/blog-post-editor'
import type { BlogPostKind } from '@/components/admin/blog/blog-types'
import { useAuth } from '@/lib/auth'

export default function NewBlogPostPage() {
  return (
    <Suspense
      fallback={
        <div className='container py-8 text-muted-foreground'>Loading…</div>
      }
    >
      <NewBlogPostContent />
    </Suspense>
  )
}

function NewBlogPostContent() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const canAccess = isAdmin || isModerator
  const searchParams = useSearchParams()
  const kindParam = searchParams.get('kind')
  const initialKind: BlogPostKind =
    kindParam === 'patch_notes' ? 'patch_notes' : 'news'

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  return (
    <div className='container max-w-6xl space-y-8 py-8'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>New post</h1>
        <p className='text-muted-foreground text-sm'>
          Created as a draft — publish it once you're happy with how it looks.
        </p>
      </div>

      <BlogPostEditor initialKind={initialKind} />
    </div>
  )
}
