'use client'

import { useMemo } from 'react'
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
import { buildCardRegistries } from '../lib/build-card-registries'
import { decodePlayerLogs } from '../lib/decode-player-logs'
import { formatElapsedMs } from '../lib/format'
import { findMatchInfo, findPlayerOutcomeArgs } from '../lib/manifest'
import { getDeckInfo, getRulesetInfo } from '../lib/ruleset-info'
import { computePlayerSpending } from '../lib/spending'
import { buildTimeline, FRAMING_OPCODES } from '../lib/timeline'
import type { PlayerLogRow } from '../lib/types'
import { EventDetail } from './event-detail'
import { InfoTooltipLabel } from './info-tooltip-label'
import { KeyValueGrid } from './key-value-grid'
import { OpcodeBadge } from './opcode-badge'
import { PlayerLabel } from './player-label'

// The technical event timeline. Only moderators and admins are shown this.
export function MatchTimeline({
  logs,
  viewerId,
}: {
  logs: readonly PlayerLogRow[]
  viewerId: string | null
}) {
  const names = useMemo(
    () => new Map(logs.map((l) => [l.playerId, l.displayName])),
    [logs]
  )
  const { decoded, failures } = useMemo(() => decodePlayerLogs(logs), [logs])
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
      logs.map((log) => ({
        playerId: log.playerId,
        outcome: findPlayerOutcomeArgs(timeline, log.playerId),
      })),
    [logs, timeline]
  )

  return (
    <div className='space-y-6'>
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
                Player{' '}
                {names.get(failure.playerId) ?? failure.playerId.slice(0, 8)}:{' '}
                {failure.error}
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
                  <InfoTooltipLabel
                    label={value}
                    description={info.description}
                  />
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
                    <PlayerLabel
                      playerId={p.playerId}
                      displayName={names.get(p.playerId)}
                      viewerId={viewerId}
                    />
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
                <PlayerLabel
                  playerId={log.playerId}
                  displayName={log.displayName}
                  viewerId={viewerId}
                />
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
                          displayName={names.get(s.playerId)}
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
              interest, joker triggers, ...), not shop purchases alone -- expect
              it to run higher than Itemized Purchases, that's not by itself a
              sign of anything wrong.
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
                          displayName={names.get(entry.playerId)}
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
