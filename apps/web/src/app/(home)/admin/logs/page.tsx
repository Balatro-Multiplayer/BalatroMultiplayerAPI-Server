'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface ChatLog {
  id: number
  playerId: string
  message: string
  flagged: boolean
  sentAt: string
}

interface ChatLogsResponse {
  logs: ChatLog[]
  total: number
  page: number
}

export default function AdminLogsPage() {
  const { isAdmin, isModerator } = useAuth()
  const [page, setPage] = useState(1)
  const [flaggedOnly, setFlaggedOnly] = useState(false)

  const { data } = useQuery<ChatLogsResponse>({
    queryKey: ['admin-chat-logs', page, flaggedOnly],
    queryFn: () =>
      apiFetch(`/webadmin/chat-logs?page=${page}&limit=100${flaggedOnly ? '&flagged=true' : ''}`),
    enabled: isAdmin || isModerator,
  })

  const logs = data?.logs ?? []

  return (
    <div className='container max-w-5xl py-8 space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Chat Logs</h1>
          <p className='text-sm text-muted-foreground'>Recent chat messages for moderation.</p>
        </div>
        <Label className='flex cursor-pointer items-center gap-2 text-sm'>
          <Checkbox
            checked={flaggedOnly}
            onCheckedChange={(c) => {
              setFlaggedOnly(c === true)
              setPage(1)
            }}
          />
          Flagged only
        </Label>
      </div>

      <div className='overflow-x-auto rounded-lg border border-border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Message</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className='text-muted-foreground'>No logs found.</TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id} className={log.flagged ? 'bg-bal-red/5' : undefined}>
                  <TableCell className='whitespace-nowrap text-xs text-muted-foreground'>
                    {new Date(log.sentAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <a href={`/players/${log.playerId}`} className='font-mono text-xs text-bal-blue hover:underline'>
                      {log.playerId.slice(0, 8)}…
                    </a>
                  </TableCell>
                  <TableCell className='max-w-[480px] break-words'>{log.message}</TableCell>
                  <TableCell>
                    {log.flagged && <Badge variant='destructive'>Flagged</Badge>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-end gap-2'>
        <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          Previous
        </Button>
        <span className='text-sm text-muted-foreground'>Page {page}</span>
        <Button variant='outline' size='sm' onClick={() => setPage((p) => p + 1)} disabled={logs.length < 100}>
          Next
        </Button>
      </div>
    </div>
  )
}
