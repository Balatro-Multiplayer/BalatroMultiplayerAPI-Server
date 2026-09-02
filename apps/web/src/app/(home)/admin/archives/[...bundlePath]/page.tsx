'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { archiveDetailHref, encodeBundlePathForApi } from '../lib/archive-path'
import './archive-content.css'
import {
  type ArchivedMessage,
  MessageList,
  type ThreadSummary,
} from './components/message-list'
import { ThreadsSection } from './components/threads-section'
import { EMPTY_MENTIONS, type MentionLookups } from './lib/render-content'

interface ArchiveDetailResponse {
  meta: { channelName: string; exportedAt: string; threadOnlyChannel?: boolean }
  messages: ArchivedMessage[]
  total: number
  page: number
  pages: number
  mentions: MentionLookups
  threads: ThreadSummary[]
}

export default function AdminArchiveDetailPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const canAccess = isAdmin || isModerator
  const params = useParams()
  // A catch-all route ([...bundlePath]) rather than a single [bundlePath]
  // segment -- Next.js's router was silently failing to navigate at all for
  // a single segment containing an encoded slash (%2F), which is exactly
  // what a nested thread path needs. A catch-all gives each real path
  // component as its own array entry instead, decoded normally, with no
  // manual encodeURIComponent/decodeURIComponent needed for the whole path.
  const bundlePathSegments = (params.bundlePath as string[]) ?? []
  const bundlePath = bundlePathSegments.join('/')

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data, isLoading, error } = useQuery<ArchiveDetailResponse>({
    queryKey: ['admin-archive-detail', bundlePath, page, search],
    queryFn: () =>
      apiFetch(
        `/webadmin/archives/${encodeBundlePathForApi(bundlePath)}?page=${page}&limit=200${
          search ? `&q=${encodeURIComponent(search)}` : ''
        }`
      ),
    enabled: canAccess && bundlePath.length > 0,
  })

  if (pending) return <div className='container py-8'>Loading…</div>
  if (!canAccess) return null

  const isThread = bundlePathSegments.includes('threads')
  const parentSegments = isThread
    ? bundlePathSegments.slice(0, bundlePathSegments.indexOf('threads'))
    : bundlePathSegments

  return (
    <div className='container max-w-3xl space-y-6 py-8'>
      <div>
        {isThread ? (
          <a
            href={archiveDetailHref(parentSegments.join('/'))}
            className='text-bal-blue text-sm hover:underline'
          >
            ← Back to parent channel
          </a>
        ) : (
          <a
            href='/admin/archives'
            className='text-bal-blue text-sm hover:underline'
          >
            ← Back to archives
          </a>
        )}
        <h1 className='font-bold text-2xl tracking-tight'>
          #{data?.meta.channelName ?? '…'}
        </h1>
        {data && (
          <p className='text-muted-foreground text-sm'>
            {data.meta.threadOnlyChannel
              ? `${data.threads.length} posts`
              : `${data.total} messages`}{' '}
            · exported {new Date(data.meta.exportedAt).toLocaleString()}
          </p>
        )}
      </div>

      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(searchInput)
          setPage(1)
        }}
      >
        <Input
          placeholder='Search message content…'
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <Button type='submit' variant='outline'>
          Search
        </Button>
      </form>

      {error ? (
        <p className='text-destructive'>
          Failed to load:{' '}
          {error instanceof Error ? error.message : String(error)}
        </p>
      ) : isLoading || !data ? (
        <p className='text-muted-foreground'>Loading…</p>
      ) : (
        <>
          <ThreadsSection bundlePath={bundlePath} threads={data.threads} />
          <MessageList
            bundlePath={bundlePath}
            messages={data.messages}
            threads={data.threads}
            mentions={data.mentions ?? EMPTY_MENTIONS}
          />

          <div className='flex items-center justify-between'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <span className='text-muted-foreground text-sm'>
              Page {page} of {data.pages}
            </span>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= data.pages}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
