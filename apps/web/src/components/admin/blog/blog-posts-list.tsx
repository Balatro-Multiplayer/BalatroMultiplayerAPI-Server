'use client'

import Link from 'next/link'
import {
  filterPosts,
  type PostFilter,
  postCounts,
} from '@/app/(home)/admin/blog/lib/posts'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  BLOG_POST_KIND_LABELS,
  type BlogPost,
  type BlogPostKind,
} from './blog-types'

const FILTERS: { key: PostFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'published', label: 'Published' },
]

export function BlogPostsList({
  posts,
  isLoading,
  filter,
  onFilter,
  selectedId,
  onSelect,
  onNew,
}: {
  posts: BlogPost[]
  isLoading: boolean
  filter: PostFilter
  onFilter: (f: PostFilter) => void
  selectedId: number | null
  onSelect: (post: BlogPost) => void
  onNew: (kind: BlogPostKind) => void
}) {
  const counts = postCounts(posts)
  const shown = filterPosts(posts, filter)

  return (
    <aside className='rounded-xl border border-border bg-card'>
      <div className='space-y-3 p-4'>
        <div className='flex flex-wrap gap-2'>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type='button'
              aria-pressed={filter === f.key}
              onClick={() => onFilter(f.key)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                filter === f.key
                  ? 'border-primary bg-primary font-semibold text-primary-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {f.label} <span className='font-semibold'>{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className='grid grid-cols-2 gap-2'>
          <button
            type='button'
            onClick={() => onNew('news')}
            className='rounded-md bg-primary px-2 py-1.5 font-semibold text-primary-foreground text-sm hover:opacity-90'
          >
            New news post
          </button>
          <button
            type='button'
            onClick={() => onNew('patch_notes')}
            className='rounded-md border border-border px-2 py-1.5 font-semibold text-sm hover:bg-accent'
          >
            New patch notes
          </button>
        </div>
      </div>
      <ul className='border-border border-t'>
        {isLoading && (
          <li className='p-4 text-muted-foreground text-sm'>Loading…</li>
        )}
        {!isLoading && shown.length === 0 && (
          <li className='p-4 text-muted-foreground text-sm'>No posts here.</li>
        )}
        {shown.map((post) => (
          <li key={post.id} className='border-border border-b last:border-b-0'>
            <button
              type='button'
              onClick={() => onSelect(post)}
              aria-current={post.id === selectedId}
              className={cn(
                'w-full space-y-1 border-l-2 px-4 py-3 text-left hover:bg-accent/40',
                post.id === selectedId
                  ? 'border-l-primary bg-primary/10'
                  : 'border-l-transparent'
              )}
            >
              <div className='font-semibold text-sm'>
                {post.title || (
                  <span className='text-muted-foreground'>Untitled</span>
                )}
              </div>
              <div className='flex flex-wrap items-center gap-2 text-muted-foreground text-xs'>
                <Badge
                  variant={
                    post.status === 'published' ? 'default' : 'secondary'
                  }
                >
                  {post.status === 'published' ? 'Published' : 'Draft'}
                </Badge>
                <Badge variant='outline'>
                  {BLOG_POST_KIND_LABELS[post.kind]}
                </Badge>
                <span>{new Date(post.updatedAt).toLocaleDateString()}</span>
              </div>
            </button>
            <div className='px-4 pb-2 text-xs'>
              <Link
                href={`/admin/players/${post.authorPlayerId}`}
                className='font-mono text-muted-foreground hover:text-primary hover:underline'
              >
                {post.authorPlayerId}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
