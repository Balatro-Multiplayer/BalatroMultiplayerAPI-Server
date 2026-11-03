'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { GameLogView } from '../../components/game-log/game-log-view'
import { PlayerLabel } from '../../components/player-label'
import { RunStatusBadge } from '../../components/status-badge'
import { decodePlayerLogs } from '../../lib/decode-player-logs'
import { buildGameLog } from '../../lib/game-log/build-game-log'
import type { RunReplayResponse } from '../../lib/types'

export default function MatchLogPage() {
  const { pending, isLoggedIn, player } = useAuth()
  const router = useRouter()
  const runId = useParams().runId as string

  useEffect(() => {
    if (!pending && !isLoggedIn) router.replace('/login')
  }, [pending, isLoggedIn, router])

  const { data, error, isLoading } = useQuery<RunReplayResponse>({
    queryKey: ['match-replay', runId],
    queryFn: () => apiFetch(`/runs/${runId}/replay`),
    enabled: isLoggedIn,
    retry: false,
  })

  const { decoded, failures } = useMemo(
    () => decodePlayerLogs(data?.logs ?? []),
    [data]
  )
  const gameLog = useMemo(() => buildGameLog(decoded), [decoded])

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!isLoggedIn) return null

  const message =
    error instanceof ApiError && error.status === 403
      ? "You don't have access to this replay."
      : error instanceof ApiError && error.status === 404
        ? 'Match not found.'
        : error
          ? 'Failed to load this replay. Please try again later.'
          : isLoading || !data
            ? 'Loading…'
            : null

  if (message) {
    return (
      <div className='container max-w-lg space-y-4 py-8'>
        <Link href='/matches' className='text-bal-blue text-sm hover:underline'>
          ← Back to My Matches
        </Link>
        <p className='text-muted-foreground'>{message}</p>
      </div>
    )
  }
  if (!data) return null

  const viewerId = player?.id ?? null

  return (
    <div className='container max-w-6xl space-y-6 py-8'>
      <div className='space-y-1'>
        <Link href='/matches' className='text-bal-blue text-sm hover:underline'>
          ← Back to My Matches
        </Link>
        <div className='flex items-center gap-3'>
          <h1 className='font-bold text-2xl tracking-tight'>Match Log</h1>
          <RunStatusBadge status={data.run.status} />
          <Link
            href={`/matches/${runId}`}
            className='ml-auto text-bal-blue text-sm hover:underline'
          >
            Raw events →
          </Link>
        </div>
        <p className='text-muted-foreground text-sm'>
          {data.run.modId} · Lobby {data.run.lobbyCode} · Started{' '}
          {new Date(data.run.startedAt).toLocaleString()}
        </p>
      </div>

      {failures.length > 0 && (
        <Card className='border-destructive/40'>
          <CardContent className='space-y-1 pt-6 text-destructive text-sm'>
            {failures.map((f) => (
              <p key={f.playerId}>
                Player {f.playerId.slice(0, 8)}: {f.error}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {gameLog.players.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          No player logs were recorded for this match.
        </p>
      ) : (
        <GameLogView
          log={gameLog}
          playerLabel={(id) => (
            <PlayerLabel playerId={id} viewerId={viewerId} />
          )}
        />
      )}
    </div>
  )
}
