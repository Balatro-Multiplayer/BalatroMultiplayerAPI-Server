'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { GameLogView } from '../components/game-log/game-log-view'
import { StaffMatchView } from '../components/staff-match-view'
import { PlayerLabel } from '../components/player-label'
import { RunStatusBadge } from '../components/status-badge'
import { decodePlayerLogs } from '../lib/decode-player-logs'
import { buildGameLog } from '../lib/game-log/build-game-log'
import {
  hiddenPlayerIds,
  matchLink,
  shareControl,
  withOwnSideShared,
} from '../lib/match-view'
import type { RunReplayResponse } from '../lib/types'

function BackLink() {
  const { isLoggedIn } = useAuth()
  if (!isLoggedIn) return null
  return (
    <Link href='/matches' className='text-bal-blue text-sm hover:underline'>
      ← Back to My Matches
    </Link>
  )
}

function ShareButtons({
  runId,
  shared,
  busy,
  onToggle,
}: {
  runId: string
  shared: boolean
  busy: boolean
  onToggle: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(
      matchLink(window.location.origin, runId)
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className='ml-auto flex items-center gap-2'>
      {shared && (
        <Button size='sm' variant='outline' onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      )}
      <Button
        size='sm'
        variant={shared ? 'outline' : 'default'}
        disabled={busy}
        onClick={onToggle}
      >
        {shared ? 'Unshare' : 'Share'}
      </Button>
    </div>
  )
}

export default function MatchPage() {
  const { pending, player } = useAuth()
  const runId = useParams().runId as string
  const queryClient = useQueryClient()
  const fromItem = Number.parseInt(useSearchParams().get('item') ?? '', 10)
  const queryKey = ['match-replay', runId, player?.id ?? null]

  // No login needed: the API decides what this viewer may see.
  const { data, error, isLoading } = useQuery<RunReplayResponse>({
    queryKey,
    queryFn: () => apiFetch(`/runs/${runId}/replay`),
    enabled: !pending,
    retry: false,
  })

  const shareMutation = useMutation({
    mutationFn: (share: boolean) =>
      apiFetch<{ shared: boolean }>(`/runs/${runId}/share`, {
        method: share ? 'POST' : 'DELETE',
      }),
    onSuccess: ({ shared }) =>
      queryClient.setQueryData<RunReplayResponse>(queryKey, (old) =>
        old ? withOwnSideShared(old, shared) : old
      ),
  })

  const { decoded, failures } = useMemo(
    () => decodePlayerLogs(data?.logs ?? []),
    [data]
  )
  const gameLog = useMemo(() => buildGameLog(decoded), [decoded])
  const hidden = useMemo(() => hiddenPlayerIds(data?.logs ?? []), [data])
  const names = useMemo(
    () => new Map((data?.logs ?? []).map((l) => [l.playerId, l.displayName])),
    [data]
  )

  const message =
    error instanceof ApiError && error.status === 404
      ? 'Match not found.'
      : error
        ? 'Failed to load this match. Please try again later.'
        : pending || isLoading || !data
          ? 'Loading…'
          : null

  if (message || !data) {
    return (
      <div className='container max-w-lg space-y-4 py-8'>
        <BackLink />
        <p className='text-muted-foreground'>{message}</p>
      </div>
    )
  }

  const viewerId = data.viewer.playerId ?? null
  const share = shareControl(data)
  const isModerator = data.viewer.role === 'moderator'

  const failureNotes =
    failures.length > 0 ? (
      <Card className='border-destructive/40'>
        <CardContent className='space-y-1 pt-6 text-destructive text-sm'>
          {failures.map((f) => (
            <p key={f.playerId}>
              Player {names.get(f.playerId) ?? f.playerId.slice(0, 8)}: {f.error}
            </p>
          ))}
        </CardContent>
      </Card>
    ) : null

  if (isModerator) {
    return (
      <StaffMatchView
        runId={runId}
        data={data}
        gameLog={gameLog}
        names={names}
        hidden={hidden}
        failureNotes={failureNotes}
        fromItem={Number.isInteger(fromItem) ? fromItem : null}
        shareSlot={
          share && (
            <ShareButtons
              runId={runId}
              shared={share.shared}
              busy={shareMutation.isPending}
              onToggle={() => shareMutation.mutate(!share.shared)}
            />
          )
        }
      />
    )
  }

  return (
    <div className='container max-w-6xl space-y-6 py-8'>
      <div className='space-y-1'>
        <BackLink />
        <div className='flex flex-wrap items-center gap-3'>
          <h1 className='font-bold text-2xl tracking-tight'>Match Log</h1>
          <RunStatusBadge status={data.run.status} />
          {share && (
            <ShareButtons
              runId={runId}
              shared={share.shared}
              busy={shareMutation.isPending}
              onToggle={() => shareMutation.mutate(!share.shared)}
            />
          )}
        </div>
        <p className='text-muted-foreground text-sm'>
          {data.run.modId}
          {data.run.lobbyCode && ` · Lobby ${data.run.lobbyCode}`} · Started{' '}
          {new Date(data.run.startedAt).toLocaleString()}
        </p>
        {share && (
          <p className='text-muted-foreground text-xs'>
            {share.shared
              ? 'Your side is shared. Anyone with the link can see it.'
              : 'Only you and your opponents can see your side. Share it to let anyone with the link see it.'}
          </p>
        )}
        {shareMutation.isError && (
          <p className='text-destructive text-sm'>
            Could not change sharing. Please try again.
          </p>
        )}
      </div>

      {failureNotes}

      {gameLog.players.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          No player logs were recorded for this match.
        </p>
      ) : (
        <GameLogView
          log={gameLog}
          hiddenPlayerIds={hidden}
          playerLabel={(id) => (
            <PlayerLabel
              playerId={id}
              displayName={names.get(id)}
              viewerId={viewerId}
            />
          )}
        />
      )}
    </div>
  )
}
