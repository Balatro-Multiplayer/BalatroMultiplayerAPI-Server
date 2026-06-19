import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { formatDate } from '@/lib/utils'
import { api } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'

type Props = {
  params: Promise<{
    slug: string
  }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params

  try {
    const post = await api.blog.getBySlug({ slug })
    return createMetadata({
      title: post.title,
      description: post.excerpt || `${post.content.substring(0, 160)}...`,
      path: `/blog/${slug}`,
      type: 'article',
    })
  } catch (_error) {
    return createMetadata({
      title: 'Blog Post Not Found',
      description: 'The requested blog post could not be found.',
      path: `/blog/${slug}`,
      noIndex: true,
    })
  }
}

export default async function BlogPostPage({ params }: Props) {
  try {
    const post = await api.blog.getBySlug({ slug: (await params).slug })

    return (
      <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-1 flex-col py-8'>
        <article className='prose prose-lg dark:prose-invert w-full max-w-3xl self-center'>
          <h1>{post.title}</h1>

          <div className='flex items-center gap-2 text-muted-foreground text-sm'>
            <span>
              {post.author?.name || 'Anonymous'} • {formatDate(post.createdAt)}
            </span>
          </div>

          <div className='mt-8'>
            <ReactMarkdown>{post.content}</ReactMarkdown>
          </div>
        </article>
      </div>
    )
  } catch (_error) {
    notFound()
  }
}
