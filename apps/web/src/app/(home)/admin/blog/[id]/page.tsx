'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { BlogPostEditor } from '@/components/admin/blog/blog-post-editor'
import type { BlogPost } from '@/components/admin/blog/blog-types'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export default function EditBlogPostPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const canAccess = isAdmin || isModerator
  const params = useParams()
  const id = params.id as string

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const postQ = useQuery<{ post: BlogPost }>({
    queryKey: ['admin-blog-post', id],
    queryFn: () => apiFetch(`/webadmin/blog/posts/${id}`),
    enabled: canAccess,
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  return (
    <div className='container max-w-6xl space-y-8 py-8'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>Edit post</h1>
      </div>

      {postQ.isLoading && <p className='text-muted-foreground'>Loading…</p>}
      {postQ.isError && (
        <p className='text-destructive'>Failed to load post.</p>
      )}
      {postQ.data?.post && (
        <BlogPostEditor key={postQ.data.post.id} post={postQ.data.post} />
      )}
    </div>
  )
}
