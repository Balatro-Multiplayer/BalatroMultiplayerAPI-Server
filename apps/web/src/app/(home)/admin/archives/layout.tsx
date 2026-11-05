'use client'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import {
  archiveDetailHref,
  archiveSegments,
  listedBundlePath,
} from './lib/archive-path'

interface ArchiveListEntry {
  bundlePath: string
  guildId: string
  channelId: string
  channelName: string
  exportedAt: string
  messageCount: number
  attachmentCount: number
  threadCount: number
  threadOnlyChannel: boolean
}

// Short form of a long Discord id, as in "98712..4420".
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 5)}..${id.slice(-4)}` : id
}

export default function ArchivesLayout({ children }: { children: ReactNode }) {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const canAccess = isAdmin || isModerator
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data } = useQuery<{ archives: ArchiveListEntry[] }>({
    queryKey: ['admin-archives', search],
    queryFn: () =>
      apiFetch(
        `/webadmin/archives${search ? `?search=${encodeURIComponent(search)}` : ''}`
      ),
    enabled: canAccess,
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  const archives = data?.archives ?? []
  const selected = listedBundlePath(archiveSegments(pathname))

  return (
    <div className='w-full space-y-4 px-4 py-6'>
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <div>
          <h1 className='font-bold text-3xl tracking-tight'>Discord Archives</h1>
          <p className='text-muted-foreground text-sm'>
            Channel and forum exports copied onto the server by the archiver
            bot.
          </p>
        </div>
        <p className='text-muted-foreground text-sm'>
          {archives.length} archives
        </p>
      </div>

      <div className='grid grid-cols-1 gap-4 lg:h-[calc(100dvh-12rem)] lg:grid-cols-[minmax(300px,400px)_1fr]'>
        <div
          className={cn(
            'flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card/80',
            selected && 'max-lg:hidden'
          )}
        >
          <div className='border-border border-b p-3'>
            <Input
              placeholder='Search by channel name, channel id or guild id'
              aria-label='Search archives'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {archives.length === 0 ? (
              <p className='p-4 text-muted-foreground text-sm'>
                No archives found. Archives must be copied onto the server
                under ARCHIVE_DIR.
              </p>
            ) : (
              archives.map((a) => (
                <Link
                  key={a.bundlePath}
                  href={archiveDetailHref(a.bundlePath)}
                  aria-current={selected === a.bundlePath}
                  className={cn(
                    'flex flex-col gap-1 border-border border-b px-4 py-3 transition-colors',
                    selected === a.bundlePath
                      ? 'border-l-2 border-l-destructive bg-destructive/10'
                      : 'hover:bg-muted'
                  )}
                >
                  <span className='flex items-center gap-2'>
                    <span className='font-semibold'>#{a.channelName}</span>
                    <Badge variant='outline'>
                      {a.threadOnlyChannel ? 'forum' : 'channel'}
                    </Badge>
                  </span>
                  <span className='flex flex-wrap gap-x-3 text-sm'>
                    {a.threadOnlyChannel && (
                      <span>
                        <b>{a.threadCount}</b>{' '}
                        <span className='text-muted-foreground'>posts</span>
                      </span>
                    )}
                    <span>
                      <b>{a.messageCount}</b>{' '}
                      <span className='text-muted-foreground'>messages</span>
                    </span>
                    <span>
                      <b>{a.attachmentCount}</b>{' '}
                      <span className='text-muted-foreground'>files</span>
                    </span>
                    {!a.threadOnlyChannel && (
                      <span>
                        <b>{a.threadCount || '-'}</b>{' '}
                        <span className='text-muted-foreground'>threads</span>
                      </span>
                    )}
                  </span>
                  <span className='font-mono text-muted-foreground text-xs'>
                    exported {new Date(a.exportedAt).toLocaleString()} · guild{' '}
                    <span title={a.guildId}>{shortId(a.guildId)}</span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div
          className={cn(
            'flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card/80',
            !selected && 'max-lg:hidden'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
