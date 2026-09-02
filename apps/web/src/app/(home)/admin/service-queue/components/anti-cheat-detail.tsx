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

interface RunRow {
  id: string
  lobbyCode: string
  modId: string
  status: string
  startedAt: string
  finalizedAt: string | null
}

interface PlayerLogRow {
  playerId: string
  carbonHash: string | null
  eventCount: number
  status: string
  flagReason: 'hash_mismatch' | 'elapsed_time_gate' | null
}

interface IntegrityEvent {
  id: number
  kind: string
  reason: string
  occurredAt: string
}

interface HardwareFingerprint {
  id: number
  platform: string
  componentName: string
  componentHash: string
  lastSeenAt: string
}

interface AntiCheatDetailShape {
  run: RunRow | null
  playerLog: PlayerLogRow | null
  integrityEvents: IntegrityEvent[]
  hardware: HardwareFingerprint[]
}

const FLAG_LABELS: Record<string, string> = {
  hash_mismatch: 'Replay hash mismatch',
  elapsed_time_gate: 'Implausible elapsed time',
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

export function AntiCheatDetail({ item, detail }: { item: QueueItemEnvelope; detail: unknown }) {
  const data = detail as AntiCheatDetailShape
  const qc = useQueryClient()
  const [banDialogOpen, setBanDialogOpen] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-service-queue-item', String(item.id)] })

  const dismissMutation = useMutation({
    mutationFn: () => apiFetch(`/webadmin/service-queue/${item.id}/actions/dismiss`, { method: 'PATCH' }),
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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Run &amp; Log</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          {data.playerLog?.flagReason && (
            <div>
              <span className='text-muted-foreground'>Flag reason: </span>
              {FLAG_LABELS[data.playerLog.flagReason] ?? data.playerLog.flagReason}
            </div>
          )}
          {data.run && (
            <>
              <div>
                <span className='text-muted-foreground'>Lobby code: </span>
                {data.run.lobbyCode}
              </div>
              <div>
                <span className='text-muted-foreground'>Mod: </span>
                {data.run.modId}
              </div>
              <div>
                <span className='text-muted-foreground'>Started: </span>
                {new Date(data.run.startedAt).toLocaleString()}
              </div>
            </>
          )}
          {data.playerLog && (
            <>
              <div>
                <span className='text-muted-foreground'>Carbon hash: </span>
                <span className='font-mono text-xs'>{data.playerLog.carbonHash ?? 'none'}</span>
              </div>
              <div>
                <span className='text-muted-foreground'>Event count: </span>
                {data.playerLog.eventCount}
              </div>
            </>
          )}
          {!data.run && <p className='text-xs text-muted-foreground'>Run no longer available.</p>}

          <div className='flex gap-2 pt-2'>
            {data.run && (
              <Button variant='outline' size='sm' onClick={() => downloadReplay(data.run!.id)}>
                Download Replay
              </Button>
            )}
            {item.status === 'open' && (
              <>
                <Button size='sm' onClick={() => dismissMutation.mutate()} disabled={dismissMutation.isPending}>
                  Dismiss
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
          <CardTitle>Launcher Integrity Events</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.integrityEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className='text-muted-foreground'>No integrity events.</TableCell>
                </TableRow>
              ) : (
                data.integrityEvents.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className='whitespace-nowrap text-xs text-muted-foreground'>
                      {new Date(e.occurredAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{e.kind}</TableCell>
                    <TableCell>{e.reason}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hardware Fingerprints</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Hash</TableHead>
                <TableHead>Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.hardware.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className='text-muted-foreground'>No hardware fingerprints.</TableCell>
                </TableRow>
              ) : (
                data.hardware.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{h.componentName}</TableCell>
                    <TableCell className='font-mono text-xs'>{h.componentHash.slice(0, 16)}…</TableCell>
                    <TableCell className='whitespace-nowrap text-xs text-muted-foreground'>
                      {new Date(h.lastSeenAt).toLocaleString()}
                    </TableCell>
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
