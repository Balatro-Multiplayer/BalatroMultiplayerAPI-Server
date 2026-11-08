'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import {
  EmptyLine,
  KeyValues,
  PageHeader,
  PageShell,
  SideCard,
} from '@/components/page-kit'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { ContestButton } from '../components/contest-button'
import { GameLogView } from '../components/game-log/game-log-view'
import { PlayerLabel } from '../components/player-label'
import { StaffMatchView } from '../components/staff-match-view'
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
    <div className='flex items-center gap-2'>
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
  const { pending, player, isLoggedIn } = useAuth()
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
              Player {names.get(f.playerId) ?? f.playerId.slice(0, 8)}:{' '}
              {f.error}
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

  const run = data.run
  return (
    <PageShell>
      <PageHeader
        back={
          isLoggedIn
            ? { href: '/matches', label: 'Back to My Matches' }
            : undefined
        }
        title={`${run.modId.replace('Multiplayer', '')} match`}
        badges={<RunStatusBadge status={run.status} />}
        actions={
          <>
            {data.viewer.role === 'participant' && (
              <ContestButton runId={runId} />
            )}
            {share && (
              <ShareButtons
                runId={runId}
                shared={share.shared}
                busy={shareMutation.isPending}
                onToggle={() => shareMutation.mutate(!share.shared)}
              />
            )}
          </>
        }
        meta={`Started ${new Date(run.startedAt).toLocaleString()}`}
      />

      {shareMutation.isError && (
        <p className='text-destructive text-sm'>
          Could not change sharing. Please try again.
        </p>
      )}

      {/* The game log is the page's main content and needs the full width,
          so the match facts sit in a row above it. */}
      <div className='grid items-start gap-4 md:grid-cols-3'>
        <SideCard title='Match'>
          <KeyValues
            rows={[
              ['Mod', run.modId.replace('Multiplayer', '')],
              ...(run.lobbyCode
                ? ([
                    [
                      'Lobby',
                      <span key='l' className='font-mono text-xs'>
                        {run.lobbyCode}
                      </span>,
                    ],
                  ] as [string, ReactNode][])
                : []),
              ['Started', new Date(run.startedAt).toLocaleString()],
              ...(run.finalizedAt
                ? ([['Ended', new Date(run.finalizedAt).toLocaleString()]] as [
                    string,
                    ReactNode,
                  ][])
                : []),
            ]}
          />
        </SideCard>
        {data.logs.length > 0 && (
          <SideCard title='Players'>
            <ul className='space-y-1 text-sm'>
              {data.logs.map((l) => (
                <li key={l.playerId}>
                  <Link
                    href={`/players/${l.playerId}`}
                    className='text-bal-blue hover:underline'
                  >
                    {l.displayName}
                  </Link>
                  {l.playerId === viewerId && (
                    <span className='text-muted-foreground text-xs'>
                      {' '}
                      (you)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </SideCard>
        )}
        {share && (
          <SideCard title='Sharing'>
            <p className='text-muted-foreground text-sm'>
              {share.shared
                ? 'Your side is shared. Anyone with the link can see it.'
                : 'Only you and your opponents can see your side. Share it to let anyone with the link see it.'}
            </p>
          </SideCard>
        )}
      </div>

      {failureNotes}
      {gameLog.players.length === 0 ? (
        <EmptyLine>No player logs were recorded for this match.</EmptyLine>
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
    </PageShell>
  )
}
