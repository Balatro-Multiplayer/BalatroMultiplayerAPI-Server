'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BLOG_POST_KIND_LABELS, type BlogPost } from './blog-types'

export function BlogPostsTable({
  posts,
  isLoading,
  pendingPostId,
  onTogglePublish,
  onDelete,
}: {
  posts: BlogPost[]
  isLoading: boolean
  pendingPostId: number | null
  onTogglePublish: (post: BlogPost) => void
  onDelete: (post: BlogPost) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kind</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead>Author</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && (
          <TableRow>
            <TableCell
              colSpan={6}
              className='text-center text-muted-foreground'
            >
              Loading…
            </TableCell>
          </TableRow>
        )}
        {!isLoading && posts.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={6}
              className='text-center text-muted-foreground'
            >
              No posts yet.
            </TableCell>
          </TableRow>
        )}
        {posts.map((post) => {
          const isPending = pendingPostId === post.id
          return (
            <TableRow key={post.id}>
              <TableCell>
                <Badge variant='outline'>
                  {BLOG_POST_KIND_LABELS[post.kind]}
                </Badge>
              </TableCell>
              <TableCell>
                <Link
                  href={`/admin/blog/${post.id}`}
                  className='font-medium hover:underline'
                >
                  {post.title || (
                    <span className='text-muted-foreground'>Untitled</span>
                  )}
                </Link>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    post.status === 'published' ? 'default' : 'secondary'
                  }
                >
                  {post.status === 'published' ? 'Published' : 'Draft'}
                </Badge>
              </TableCell>
              <TableCell className='text-muted-foreground text-sm'>
                {new Date(post.updatedAt).toLocaleString()}
              </TableCell>
              <TableCell className='text-muted-foreground text-sm'>
                {post.authorPlayerId}
              </TableCell>
              <TableCell>
                <div className='flex justify-end gap-1'>
                  <Button variant='ghost' size='sm' asChild>
                    <Link href={`/admin/blog/${post.id}`}>Edit</Link>
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={isPending}
                    onClick={() => onTogglePublish(post)}
                  >
                    {post.status === 'published' ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='text-destructive hover:text-destructive'
                    disabled={isPending}
                    onClick={() => onDelete(post)}
                  >
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
