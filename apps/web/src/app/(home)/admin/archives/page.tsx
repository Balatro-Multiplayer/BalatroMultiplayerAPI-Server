'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { archiveDetailHref } from './lib/archive-path'

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

export default function AdminArchivesPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
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

  const archives = data?.archives ?? []

  if (pending) return <div className='container py-8'>Loading…</div>
  if (!canAccess) return null

  return (
    <div className='container max-w-5xl space-y-6 py-8'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>Channel Archives</h1>
        <p className='text-muted-foreground text-sm'>
          Discord channel/forum archives, manually copied onto the server by an
          operator running the discord-channel-archiver bot. Search by channel
          name, channel ID, or guild ID.
        </p>
      </div>

      <Input
        placeholder='Search archives…'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className='max-w-sm'
      />

      <div className='overflow-x-auto rounded-lg border border-border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Guild ID</TableHead>
              <TableHead>Messages</TableHead>
              <TableHead>Attachments</TableHead>
              <TableHead>Threads</TableHead>
              <TableHead>Exported</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {archives.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className='text-muted-foreground'>
                  No archives found. Archives must be manually copied onto the
                  server under ARCHIVE_DIR.
                </TableCell>
              </TableRow>
            ) : (
              archives.map((a) => (
                <TableRow key={a.bundlePath}>
                  <TableCell className='font-medium'>
                    #{a.channelName}
                    {a.threadOnlyChannel && (
                      <span className='ml-1.5 text-muted-foreground text-xs'>
                        (forum)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className='text-muted-foreground text-xs'>
                    {a.guildId}
                  </TableCell>
                  <TableCell>{a.messageCount}</TableCell>
                  <TableCell>{a.attachmentCount}</TableCell>
                  <TableCell>{a.threadCount || '—'}</TableCell>
                  <TableCell className='whitespace-nowrap text-muted-foreground text-xs'>
                    {new Date(a.exportedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <a
                      href={archiveDetailHref(a.bundlePath)}
                      className='text-bal-blue hover:underline'
                    >
                      View
                    </a>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
