'use client'

import type { BanType } from '@bmp/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { QueueItemEnvelope } from '../types'
import { BanDialog } from './ban-dialog'

interface ReportedLobbyMessage {
  id: number
  playerId: string
  displayName: string
  message: string
  sentAt: string
}

interface ReportDetailShape {
  lobbyCode: string
  runId: string | null
  reporterId: string
  reporterName: string
  reportedId: string
  reportedName: string
  type: string
  message: string | null
  additionalDetail: string | null
  messages: ReportedLobbyMessage[]
}

const TYPE_LABELS: Record<string, string> = {
  cheating: 'Cheating',
  chat_abuse: 'Chat Abuse',
  griefing: 'Griefing',
  inappropriate_username: 'Inappropriate Username',
  other: 'Other',
}

async function downloadReplay(runId: string) {
  const data = await apiFetch(`/runs/${runId}/replay`)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `replay-${runId}.json`
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ReportDetail({ item, detail }: { item: QueueItemEnvelope; detail: unknown }) {
  const report = detail as ReportDetailShape | null
  const qc = useQueryClient()
  const [banDialogOpen, setBanDialogOpen] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-service-queue-item', String(item.id)] })

  const resolveMutation = useMutation({
    mutationFn: () => apiFetch(`/webadmin/service-queue/${item.id}/actions/resolve`, { method: 'PATCH' }),
    onSuccess: invalidate,
  })

  const banMutation = useMutation({
    mutationFn: (params: { banType: BanType; reason: string; expiresAt: string | null }) =>
      apiFetch(`/webadmin/service-queue/${item.id}/actions/ban`, { method: 'PATCH', body: JSON.stringify(params) }),
    onSuccess: () => {
      setBanDialogOpen(false)
      invalidate()
    },
  })

  if (!report) return <p className='text-muted-foreground'>Report not found.</p>

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          <div>
            <span className='text-muted-foreground'>Reporter: </span>
            <a href={`/players/${report.reporterId}`} className='text-bal-blue hover:underline'>
              {report.reporterName}
            </a>
          </div>
          <div>
            <span className='text-muted-foreground'>Reported: </span>
            <a href={`/players/${report.reportedId}`} className='text-bal-blue hover:underline'>
              {report.reportedName}
            </a>
          </div>
          <div>
            <span className='text-muted-foreground'>Type: </span>
            {TYPE_LABELS[report.type] ?? report.type}
          </div>
          <div>
            <span className='text-muted-foreground'>Lobby code: </span>
            {report.lobbyCode}
          </div>
          {report.message && (
            <div>
              <span className='text-muted-foreground'>Message: </span>
              {report.message}
            </div>
          )}
          {report.additionalDetail && (
            <div>
              <span className='text-muted-foreground'>Reporter's added detail: </span>
              {report.additionalDetail}
            </div>
          )}

          <div className='flex gap-2 pt-2'>
            {report.runId && (
              <Button variant='outline' size='sm' onClick={() => downloadReplay(report.runId!)}>
                Download Replay
              </Button>
            )}
            {item.status === 'open' && (
              <>
                <Button size='sm' onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}>
                  Mark Resolved
                </Button>
                <Button
                  size='sm'
                  variant='destructive'
                  onClick={() => setBanDialogOpen(true)}
                  disabled={banMutation.isPending}
                >
                  Ban
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chat History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.messages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className='text-muted-foreground'>No chat history.</TableCell>
                </TableRow>
              ) : (
                report.messages.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className='whitespace-nowrap text-xs text-muted-foreground'>
                      {new Date(m.sentAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{m.displayName}</TableCell>
                    <TableCell className='max-w-[480px] break-words'>{m.message}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BanDialog
        open={banDialogOpen}
        isPending={banMutation.isPending}
        onConfirm={(params) => banMutation.mutate(params)}
        onClose={() => setBanDialogOpen(false)}
      />
    </>
  )
}
