'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface ReportedLobbyMessage {
  id: number
  playerId: string
  displayName: string
  message: string
  sentAt: string
}

interface ReportDetail {
  id: number
  lobbyCode: string
  runId: string | null
  reporterId: string
  reporterName: string
  reportedId: string
  reportedName: string
  type: string
  status: 'open' | 'resolved'
  message: string | null
  additionalDetail: string | null
  createdAt: string
  messages: ReportedLobbyMessage[]
}

const TYPE_LABELS: Record<string, string> = {
  cheating: 'Cheating',
  chat_abuse: 'Chat Abuse',
  griefing: 'Griefing',
  inappropriate_username: 'Inappropriate Username',
  other: 'Other',
}

// The replay endpoint requires the same Bearer auth as everything else, so a
// plain <a href> can't hit it directly -- fetch it via apiFetch, then trigger
// a client-side download the same way apps/(home)/reskin's asset export does
// (Blob + temporary anchor + revokeObjectURL).
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

export default function AdminModerationReportDetailPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const canAccess = isAdmin || isModerator
  const params = useParams()
  const reportId = params.reportId as string
  const qc = useQueryClient()

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data } = useQuery<{ report: ReportDetail }>({
    queryKey: ['admin-report', reportId],
    queryFn: () => apiFetch(`/webadmin/reports/${reportId}`),
    enabled: canAccess,
  })

  const resolveMutation = useMutation({
    mutationFn: () => apiFetch(`/webadmin/reports/${reportId}/resolve`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-report', reportId] }),
  })

  if (pending) return <div className='container py-8'>Loading…</div>
  if (!canAccess) return null

  const report = data?.report

  return (
    <div className='container max-w-3xl py-8 space-y-6'>
      <div>
        <a href='/admin/moderation' className='text-sm text-bal-blue hover:underline'>
          ← Back to reports
        </a>
        <h1 className='text-2xl font-bold tracking-tight'>Report #{reportId}</h1>
      </div>

      {!report ? (
        <p className='text-muted-foreground'>Loading…</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center justify-between'>
                <span>Details</span>
                <Badge variant={report.status === 'open' ? 'destructive' : 'secondary'}>
                  {report.status === 'open' ? 'Open' : 'Resolved'}
                </Badge>
              </CardTitle>
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
              <div>
                <span className='text-muted-foreground'>Filed: </span>
                {new Date(report.createdAt).toLocaleString()}
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
                {report.status === 'open' && (
                  <Button size='sm' onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}>
                    Mark Resolved
                  </Button>
                )}
              </div>
              {!report.runId && (
                <p className='text-xs text-muted-foreground'>
                  No match was found for this lobby at the time of the report — nothing to replay.
                </p>
              )}
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
        </>
      )}
    </div>
  )
}
