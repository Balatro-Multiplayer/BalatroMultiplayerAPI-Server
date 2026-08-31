'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError, apiFetch } from '@/lib/api'
import { BlogPreviewCard } from './blog-preview-card'
import { BlogTiptapEditor } from './blog-tiptap-editor'
import {
  BLOG_POST_KIND_LABELS,
  type BlogPost,
  type BlogPostForm,
  type BlogPostKind,
} from './blog-types'

function onErr(e: unknown) {
  toast.error(
    e instanceof ApiError
      ? e.message
      : e instanceof Error
        ? e.message
        : 'Request failed'
  )
}

// Shared by /admin/blog/new (post === undefined, kind picked up-front) and
// /admin/blog/[id] (post already loaded by the caller) -- the two pages only
// differ in how they get here and what happens right after create.
export function BlogPostEditor({
  post,
  initialKind = 'news',
}: {
  post?: BlogPost
  initialKind?: BlogPostKind
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const isEdit = post !== undefined

  const [form, setForm] = useState<BlogPostForm>(() => ({
    kind: post?.kind ?? initialKind,
    title: post?.title ?? '',
    bodyHtml: post?.bodyHtml ?? '',
  }))

  const invalidateList = () =>
    qc.invalidateQueries({ queryKey: ['admin-blog-posts'] })
  const invalidateDetail = () =>
    post &&
    qc.invalidateQueries({ queryKey: ['admin-blog-post', String(post.id)] })

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit && post
        ? apiFetch<{ post: BlogPost }>(`/webadmin/blog/posts/${post.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              title: form.title,
              bodyHtml: form.bodyHtml,
            }),
          })
        : apiFetch<{ post: BlogPost }>('/webadmin/blog/posts', {
            method: 'POST',
            body: JSON.stringify(form),
          }),
    onSuccess: (data) => {
      toast.success(isEdit ? 'Post saved' : 'Draft created')
      invalidateList()
      if (isEdit) {
        invalidateDetail()
      } else {
        // Straight to the edit page for the new draft, so the user can hit
        // Publish immediately instead of having to find it in the list.
        router.push(`/admin/blog/${data.post.id}`)
      }
    },
    onError: onErr,
  })

  const publishMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ post: BlogPost }>(`/webadmin/blog/posts/${post?.id}/publish`, {
        method: 'POST',
      }),
    onSuccess: () => {
      toast.success('Post published')
      invalidateList()
      invalidateDetail()
    },
    onError: onErr,
  })

  const unpublishMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ post: BlogPost }>(
        `/webadmin/blog/posts/${post?.id}/unpublish`,
        {
          method: 'POST',
        }
      ),
    onSuccess: () => {
      toast.success('Post unpublished')
      invalidateList()
      invalidateDetail()
    },
    onError: onErr,
  })

  return (
    <div className='grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_500px]'>
      <div className='space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='post-title'>Title</Label>
          <Input
            id='post-title'
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='post-kind'>Kind</Label>
          {isEdit ? (
            <div>
              <Badge variant='outline'>
                {BLOG_POST_KIND_LABELS[post.kind]}
              </Badge>
              <p className='mt-1 text-muted-foreground text-xs'>
                Kind can't be changed after a post is created.
              </p>
            </div>
          ) : (
            <Select
              value={form.kind}
              onValueChange={(v) =>
                setForm({ ...form, kind: v as BlogPostKind })
              }
            >
              <SelectTrigger id='post-kind' className='w-full max-w-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='news'>News</SelectItem>
                <SelectItem value='patch_notes'>Patch Notes</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <div className='space-y-2'>
          <Label>Body</Label>
          <BlogTiptapEditor
            value={form.bodyHtml}
            onChange={(bodyHtml) => setForm({ ...form, bodyHtml })}
          />
        </div>

        <div className='flex items-center gap-2 pt-2'>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.title.trim()}
          >
            {saveMutation.isPending
              ? 'Saving…'
              : isEdit
                ? 'Save changes'
                : 'Create draft'}
          </Button>

          {isEdit && post.status === 'draft' && (
            <Button
              type='button'
              variant='secondary'
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
            >
              {publishMutation.isPending ? 'Publishing…' : 'Publish'}
            </Button>
          )}
          {isEdit && post.status === 'published' && (
            <Button
              type='button'
              variant='secondary'
              onClick={() => unpublishMutation.mutate()}
              disabled={unpublishMutation.isPending}
            >
              {unpublishMutation.isPending ? 'Unpublishing…' : 'Unpublish'}
            </Button>
          )}

          {isEdit && (
            <Badge
              variant={post.status === 'published' ? 'default' : 'secondary'}
              className='ml-auto'
            >
              {post.status === 'published' ? 'Published' : 'Draft'}
            </Badge>
          )}
        </div>
      </div>

      <div className='lg:sticky lg:top-8'>
        <BlogPreviewCard bodyHtml={form.bodyHtml} />
      </div>
    </div>
  )
}
