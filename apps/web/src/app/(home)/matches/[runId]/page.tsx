'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { EventDetail } from '../components/event-detail'
import { InfoTooltipLabel } from '../components/info-tooltip-label'
import { KeyValueGrid } from '../components/key-value-grid'
import { OpcodeBadge } from '../components/opcode-badge'
import { PlayerLabel } from '../components/player-label'
import { RunStatusBadge } from '../components/status-badge'
import { buildCardRegistries } from '../lib/build-card-registries'
import { decodePlayerLogs } from '../lib/decode-player-logs'
import { getDeckInfo, getRulesetInfo } from '../lib/ruleset-info'
import { computePlayerSpending } from '../lib/spending'
import { formatElapsedMs } from '../lib/format'
import { findMatchInfo, findPlayerOutcomeArgs } from '../lib/manifest'
import { buildTimeline, FRAMING_OPCODES } from '../lib/timeline'
import type { RunReplayResponse } from '../lib/types'

function BackLink() {
  return (
    <Link href='/matches' className='text-bal-blue text-sm hover:underline'>
      ← Back to My Matches
    </Link>
  )
}

export default function MatchReplayPage() {
  const { pending, isLoggedIn, player } = useAuth()
  const router = useRouter()
  const params = useParams()
  const runId = params.runId as string

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
  const timeline = useMemo(() => buildTimeline(decoded), [decoded])
  const cardRegistries = useMemo(() => buildCardRegistries(decoded), [decoded])
  const spending = useMemo(() => computePlayerSpending(decoded), [decoded])
  const gameplayTimeline = useMemo(
    () => timeline.filter((entry) => !FRAMING_OPCODES.has(entry.opcode)),
    [timeline]
  )
  const manifest = useMemo(() => findMatchInfo(timeline), [timeline])
  const playerOutcomes = useMemo(
    () =>
      (data?.logs ?? []).map((log) => ({
        playerId: log.playerId,
        outcome: findPlayerOutcomeArgs(timeline, log.playerId),
      })),
    [data, timeline]
  )

  if (pending)
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  if (!isLoggedIn) return null

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div className='container max-w-lg space-y-4 py-8'>
        <BackLink />
        <p className='text-muted-foreground'>
          You don't have access to this replay.
        </p>
      </div>
    )
  }

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className='container max-w-lg space-y-4 py-8'>
        <BackLink />
        <p className='text-muted-foreground'>Match not found.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className='container max-w-lg space-y-4 py-8'>
        <BackLink />
        <p className='text-muted-foreground'>
          Failed to load this replay. Please try again later.
        </p>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className='container max-w-lg space-y-4 py-8'>
        <BackLink />
        <p className='text-muted-foreground'>Loading…</p>
      </div>
    )
  }

  const { run, logs } = data
  const viewerId = player?.id ?? null

  return (
    <div className='container max-w-5xl space-y-6 py-8'>
      <div className='space-y-1'>
        <BackLink />
        <div className='flex items-center gap-3'>
          <h1 className='font-bold text-2xl tracking-tight'>Match Replay</h1>
          <RunStatusBadge status={run.status} />
        </div>
        <p className='text-muted-foreground text-sm'>
          {run.modId} · Lobby {run.lobbyCode} · Started{' '}
          {new Date(run.startedAt).toLocaleString()}
        </p>
      </div>

      {logs.length === 0 && (
        <Card>
          <CardContent className='pt-6 text-muted-foreground'>
            No player logs were recorded for this match.
          </CardContent>
        </Card>
      )}

      {failures.length > 0 && (
        <Card className='border-destructive/40'>
          <CardHeader>
            <CardTitle className='text-base text-destructive'>
              Some logs failed to decode
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-1 text-muted-foreground text-sm'>
            {failures.map((failure) => (
              <p key={failure.playerId}>
                Player {failure.playerId.slice(0, 8)}: {failure.error}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {manifest && (
        <Card>
          <CardHeader>
            <CardTitle>Match Info</CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValueGrid
              data={manifest}
              renderValue={(key, value) => {
                const info =
                  key === 'ruleset'
                    ? getRulesetInfo(value)
                    : key === 'deck'
                      ? getDeckInfo(value)
                      : null
                if (!info || typeof value !== 'string') return null
                return (
                  <InfoTooltipLabel label={value} description={info.description} />
                )
              }}
            />
          </CardContent>
        </Card>
      )}

      {playerOutcomes.some((p) => p.outcome) && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {playerOutcomes
              .filter(
                (
                  p
                ): p is {
                  playerId: string
                  outcome: Record<string, unknown>
                } => p.outcome !== null
              )
              .map((p) => (
                <div key={p.playerId}>
                  <p className='mb-1 font-medium text-sm'>
                    <PlayerLabel playerId={p.playerId} viewerId={viewerId} />
                  </p>
                  <KeyValueGrid data={p.outcome} />
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Players</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-wrap gap-4 text-sm'>
            {logs.map((log) => (
              <div key={log.playerId} className='flex items-center gap-2'>
                <PlayerLabel playerId={log.playerId} viewerId={viewerId} />
                <span className='text-muted-foreground'>
                  {log.eventCount} events
                </span>
                <Badge
                  variant={log.status === 'complete' ? 'secondary' : 'outline'}
                >
                  {log.status}
                </Badge>
                {log.flagReason && (
                  <Badge variant='destructive'>{log.flagReason}</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {spending.some((s) => s.hasData) && (
        <Card>
          <CardHeader>
            <CardTitle>Spending</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead className='text-right'>
                    Itemized Purchases
                  </TableHead>
                  <TableHead className='text-right'>
                    Observed Balance Decrease
                  </TableHead>
                  <TableHead className='text-right'>
                    Observed Balance Increase
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spending
                  .filter((s) => s.hasData)
                  .map((s) => (
                    <TableRow key={s.playerId}>
                      <TableCell>
                        <PlayerLabel
                          playerId={s.playerId}
                          viewerId={viewerId}
                        />
                      </TableCell>
                      <TableCell className='text-right font-mono text-sm'>
                        ${s.itemizedPurchases}
                      </TableCell>
                      <TableCell className='text-right font-mono text-sm'>
                        ${s.observedSpend}
                      </TableCell>
                      <TableCell className='text-right font-mono text-sm'>
                        ${s.observedGain}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            <p className='px-4 py-3 text-muted-foreground text-xs'>
              Itemized Purchases sums each shop purchase's own recorded cost.
              Observed Balance Decrease/Increase sums every recorded balance
              change for any reason (purchases, rerolls, blind rewards,
              interest, joker triggers, ...), not shop purchases alone --
              expect it to run higher than Itemized Purchases, that's not by
              itself a sign of anything wrong.
            </p>
          </CardContent>
        </Card>
      )}

      {gameplayTimeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <div className='max-h-[600px] overflow-y-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Player</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gameplayTimeline.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className='font-mono text-muted-foreground text-xs'>
                        {formatElapsedMs(entry.t)}
                      </TableCell>
                      <TableCell>
                        <PlayerLabel
                          playerId={entry.playerId}
                          viewerId={viewerId}
                        />
                      </TableCell>
                      <TableCell>
                        <OpcodeBadge opcode={entry.opcode} />
                      </TableCell>
                      <TableCell>
                        <EventDetail
                          opcode={entry.opcode}
                          args={entry.args}
                          registry={cardRegistries.get(entry.playerId)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {logs.length > 0 &&
        gameplayTimeline.length === 0 &&
        failures.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            No gameplay events recorded beyond match framing.
          </p>
        )}
    </div>
  )
}
