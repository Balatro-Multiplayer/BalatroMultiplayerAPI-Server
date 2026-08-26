'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BlogPostDeleteDialog } from '@/components/admin/blog/blog-post-delete-dialog'
import { BlogPostsTable } from '@/components/admin/blog/blog-posts-table'
import type { BlogPost, BlogPostKind } from '@/components/admin/blog/blog-types'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface PostsResponse {
  posts: BlogPost[]
}

// Admin surface for the launcher's blog/news feed -- see this server's
// features/blog/blog.route.ts (webadmin routes) for the API this consumes.
// Drafts are only ever visible here; the launcher itself only ever sees
// published posts.
export default function AdminBlogPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const canAccess = isAdmin || isModerator

  const [deleteTarget, setDeleteTarget] = useState<BlogPost | null>(null)
  const [pendingPostId, setPendingPostId] = useState<number | null>(null)
  const [newKind, setNewKind] = useState<BlogPostKind>('news')

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const postsQ = useQuery<PostsResponse>({
    queryKey: ['admin-blog-posts'],
    queryFn: () => apiFetch('/webadmin/blog/posts'),
    enabled: canAccess,
  })
  const posts = postsQ.data?.posts ?? []

  const onErr = (e: unknown) =>
    toast.error(
      e instanceof ApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Request failed'
    )
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['admin-blog-posts'] })

  const togglePublishMutation = useMutation({
    mutationFn: (post: BlogPost) => {
      setPendingPostId(post.id)
      const action = post.status === 'published' ? 'unpublish' : 'publish'
      return apiFetch(`/webadmin/blog/posts/${post.id}/${action}`, {
        method: 'POST',
      })
    },
    onSuccess: (_data, post) => {
      toast.success(
        post.status === 'published' ? 'Post unpublished' : 'Post published'
      )
      invalidate()
    },
    onError: onErr,
    onSettled: () => setPendingPostId(null),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/webadmin/blog/posts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Post deleted')
      setDeleteTarget(null)
      invalidate()
    },
    onError: onErr,
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  return (
    <div className='container max-w-6xl space-y-8 py-8'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h1 className='font-bold text-2xl tracking-tight'>Blog</h1>
          <p className='text-muted-foreground text-sm'>
            News and patch notes shown in the launcher. Posts start as drafts —
            nothing is visible to players until you hit Publish.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Select
            value={newKind}
            onValueChange={(v) => setNewKind(v as BlogPostKind)}
          >
            <SelectTrigger className='w-[140px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='news'>News</SelectItem>
              <SelectItem value='patch_notes'>Patch Notes</SelectItem>
            </SelectContent>
          </Select>
          <Button asChild>
            <Link href={`/admin/blog/new?kind=${newKind}`}>New Post</Link>
          </Button>
        </div>
      </div>

      <BlogPostsTable
        posts={posts}
        isLoading={postsQ.isLoading}
        pendingPostId={pendingPostId}
        onTogglePublish={(post) => togglePublishMutation.mutate(post)}
        onDelete={setDeleteTarget}
      />

      <BlogPostDeleteDialog
        target={deleteTarget}
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
