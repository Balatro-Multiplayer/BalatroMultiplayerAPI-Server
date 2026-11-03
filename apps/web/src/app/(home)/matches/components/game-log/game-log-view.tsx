'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatElapsedMs } from '../../lib/format'
import { formatScore } from '../../lib/game-log/score'
import type {
  GameEvent,
  GameLog,
  PlayerGameLog,
  RoundLog,
} from '../../lib/game-log/types'
import { getDeckInfo, getRulesetInfo } from '../../lib/ruleset-info'
import { ArgsView } from '../args-view'
import { CardChip } from '../card-chip'
import { InfoTooltipLabel } from '../info-tooltip-label'
import { OpcodeBadge } from '../opcode-badge'
import { DeckPanel } from './deck-panel'
import { EconomyChart } from './economy-chart'
import { HandRow } from './hand-row'
import { IdolTrack } from './idol-track'

const ACTION_VERB = {
  buy: 'Bought',
  open_pack: 'Opened',
  voucher: 'Redeemed',
  sell: 'Sold',
  reroll: 'Rerolled the shop',
  use: 'Used',
  pack_pick: 'Picked',
  pack_skip: 'Skipped the pack',
} as const

function Money({ amount }: { amount: number | null }) {
  if (amount === null) return null
  return <span className='font-mono text-xs'>(${amount})</span>
}

function EventLine({ event }: { event: GameEvent }) {
  const time = (
    <span className='w-14 shrink-0 font-mono text-[11px] text-muted-foreground'>
      {formatElapsedMs(event.t)}
    </span>
  )
  switch (event.type) {
    case 'hand':
      return (
        <div className='flex items-start gap-2'>
          {time}
          <div className='min-w-0 flex-1'>
            <HandRow event={event} />
          </div>
        </div>
      )
    case 'idol':
      return (
        <div className='flex items-start gap-2'>
          {time}
          <div className='min-w-0 flex-1 space-y-1'>
            {event.appliesTo && (
              <p className='text-muted-foreground text-xs'>
                Idol roll for{' '}
                <span className='text-foreground'>{event.appliesTo}</span>
              </p>
            )}
            {event.jokers.length > 0 && (
              <div className='flex flex-wrap gap-1.5'>
                {event.jokers.map((joker, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
                  <CardChip key={i} card={joker} artOnly />
                ))}
              </div>
            )}
            <IdolTrack roll={event} />
          </div>
        </div>
      )
    case 'shop':
      return (
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
          {time}
          <span>{ACTION_VERB[event.action]}</span>
          {event.card && <CardChip card={event.card} />}
          {event.targets.length > 0 && (
            <>
              <span className='text-muted-foreground text-xs'>on</span>
              {event.targets.map((card, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
                <CardChip key={i} card={card} />
              ))}
            </>
          )}
          <Money amount={event.cost} />
        </div>
      )
    case 'money':
      return (
        <div className='flex items-center gap-2 text-muted-foreground text-xs'>
          {time}
          <span className='font-mono'>
            {event.delta >= 0 ? '+' : '-'}${Math.abs(event.delta)}
          </span>
        </div>
      )
    case 'leave_shop':
      return (
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          {time}
          <span>Left the shop</span>
        </div>
      )
    case 'cashout':
      return (
        <div className='flex items-center gap-2 text-sm'>
          {time}
          <span>Cashed out</span>
          {event.dollars !== null && (
            <span className='font-mono text-xs'>${event.dollars}</span>
          )}
        </div>
      )
    case 'life_lost':
      return (
        <div className='flex items-center gap-2 text-destructive text-sm'>
          {time}
          <span>
            Lost {event.lost === 1 ? 'a life' : `${event.lost} lives`}
            {event.lives !== null && ` (${event.lives} left)`}
          </span>
        </div>
      )
    case 'ready':
      return (
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          {time}
          <span>{event.ready ? 'Ready' : 'Unready'}</span>
        </div>
      )
    case 'other':
      return (
        <div className='flex items-center gap-2 text-sm'>
          {time}
          <OpcodeBadge opcode={event.opcode} />
          <ArgsView args={event.args} />
        </div>
      )
  }
}

function RoundColumn({
  round,
  showMoney,
}: {
  round: RoundLog | undefined
  showMoney: boolean
}) {
  if (!round) {
    return (
      <p className='text-muted-foreground text-sm'>Did not reach this blind.</p>
    )
  }
  const events = round.events.filter((e) => showMoney || e.type !== 'money')
  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs'>
        {round.kind === 'shop' && (
          <span className='font-mono text-foreground'>
            Spent ${round.shopSpent}
            {round.shopRerolls > 0 &&
              ` · ${round.shopRerolls} reroll${round.shopRerolls === 1 ? '' : 's'}`}
          </span>
        )}
        {round.handsPlayed > 0 && (
          <span>
            {round.handsPlayed} hand{round.handsPlayed === 1 ? '' : 's'}
          </span>
        )}
        {round.discards > 0 && (
          <span>
            {round.discards} discard{round.discards === 1 ? '' : 's'}
          </span>
        )}
        {round.finalScore !== null && (
          <span className='font-mono text-foreground'>
            Score {formatScore(round.finalScore)}
          </span>
        )}
        {round.kind === 'blind' &&
          (round.moneyGained > 0 || round.moneySpent > 0) && (
            <span className='font-mono'>
              +${round.moneyGained} / -${round.moneySpent}
            </span>
          )}
      </div>
      <div className='space-y-1.5'>
        {events.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No actions.</p>
        ) : (
          events.map((event, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
            <EventLine key={i} event={event} />
          ))
        )}
      </div>
    </div>
  )
}

function PlayerSummary({
  player,
  label,
}: {
  player: PlayerGameLog
  label: ReactNode
}) {
  return (
    <div className='space-y-2 rounded-md border p-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium text-sm'>{label}</span>
        {player.result && (
          <Badge variant={player.result === 'win' ? 'default' : 'secondary'}>
            {player.result}
          </Badge>
        )}
      </div>
      <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-xs'>
        <dt className='text-muted-foreground'>Blinds reached</dt>
        <dd>
          {
            player.rounds.filter(
              (r) => r.kind === 'blind' && r.entry !== 'setup'
            ).length
          }
        </dd>
        <dt className='text-muted-foreground'>Lives lost</dt>
        <dd>{player.livesLost}</dd>
        <dt className='text-muted-foreground'>Rerolls</dt>
        <dd>{player.rerolls}</dd>
        <dt className='text-muted-foreground'>Shop purchases</dt>
        <dd>${player.itemizedPurchases}</dd>
      </dl>
      {player.finalJokers.length > 0 && (
        <div>
          <p className='mb-1 text-muted-foreground text-xs'>
            Final jokers{player.reconstructed && ' (reconstructed)'}
          </p>
          <div className='flex flex-wrap gap-x-3 gap-y-1'>
            {player.finalJokers.map((joker, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
              <CardChip key={i} card={joker} artOnly />
            ))}
          </div>
        </div>
      )}
      <DeckPanel cards={player.finalDeck} />
      {player.vouchers.length > 0 && (
        <div>
          <p className='mb-1 text-muted-foreground text-xs'>Vouchers</p>
          <div className='flex flex-wrap gap-x-3 gap-y-1'>
            {player.vouchers.map((voucher, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
              <CardChip key={i} card={voucher} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function GameLogView({
  log,
  playerLabel,
}: {
  log: GameLog
  playerLabel: (playerId: string) => ReactNode
}) {
  const [filter, setFilter] = useState<string>('all')
  const [showMoney, setShowMoney] = useState(false)

  const visible = useMemo(
    () => log.players.filter((p) => filter === 'all' || p.playerId === filter),
    [log.players, filter]
  )
  // Blinds are whole numbers and their shops sit at +0.5 between them.
  const roundIndexes = [
    ...new Set(log.players.flatMap((p) => p.rounds.map((r) => r.index))),
  ].sort((a, b) => a - b)

  const first = log.players[0]
  const deckInfo = getDeckInfo(first?.deck)
  const rulesetInfo = getRulesetInfo(log.match?.ruleset)

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>Game</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <dl className='grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4'>
            {first?.deck && (
              <div>
                <dt className='text-muted-foreground text-xs'>Deck</dt>
                <dd>
                  {deckInfo ? (
                    <InfoTooltipLabel
                      label={first.deck}
                      description={deckInfo.description}
                    />
                  ) : (
                    first.deck
                  )}
                </dd>
              </div>
            )}
            {typeof log.match?.ruleset === 'string' && (
              <div>
                <dt className='text-muted-foreground text-xs'>Ruleset</dt>
                <dd>
                  {rulesetInfo ? (
                    <InfoTooltipLabel
                      label={log.match.ruleset}
                      description={rulesetInfo.description}
                    />
                  ) : (
                    log.match.ruleset
                  )}
                </dd>
              </div>
            )}
            {first?.seed && (
              <div>
                <dt className='text-muted-foreground text-xs'>Seed</dt>
                <dd className='font-mono'>{first.seed}</dd>
              </div>
            )}
            {first?.stake !== null && first?.stake !== undefined && (
              <div>
                <dt className='text-muted-foreground text-xs'>Stake</dt>
                <dd>{first.stake}</dd>
              </div>
            )}
          </dl>
          <div className='grid gap-3 md:grid-cols-2'>
            {log.players.map((player) => (
              <PlayerSummary
                key={player.playerId}
                player={player}
                label={playerLabel(player.playerId)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {log.pvp.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>PvP Blinds</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {log.pvp.map((result) => (
              <div
                key={result.roundIndex}
                className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'
              >
                <span className='w-44 text-muted-foreground'>
                  {result.label}
                </span>
                {log.players.map((p) => (
                  <span
                    key={p.playerId}
                    className={cn(
                      'font-mono',
                      result.winnerId === p.playerId &&
                        'font-bold text-green-500'
                    )}
                  >
                    {playerLabel(p.playerId)}{' '}
                    {result.scores[p.playerId]
                      ? formatScore(result.scores[p.playerId] ?? null)
                      : '-'}
                  </span>
                ))}
                {result.winnerId === null && (
                  <Badge variant='outline'>tie</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-muted-foreground text-sm'>Show:</span>
        <Button
          size='sm'
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          Both
        </Button>
        {log.players.map((p) => (
          <Button
            key={p.playerId}
            size='sm'
            variant={filter === p.playerId ? 'default' : 'outline'}
            onClick={() => setFilter(p.playerId)}
          >
            {playerLabel(p.playerId)}
          </Button>
        ))}
        <Button
          size='sm'
          variant={showMoney ? 'default' : 'outline'}
          className='ml-auto'
          onClick={() => setShowMoney((v) => !v)}
          title='Also list every individual money change (payouts, interest, spending) as its own line'
        >
          Money changes
        </Button>
      </div>

      <EconomyChart log={log} players={visible} playerLabel={playerLabel} />

      {roundIndexes.map((index) => {
        const first = log.players
          .flatMap((p) => p.rounds)
          .find((r) => r.index === index)
        const label = first?.label ?? ''
        return (
          <Card
            key={index}
            className={cn(first?.kind === 'shop' && 'ml-4 border-dashed')}
          >
            <CardHeader>
              <CardTitle className='text-base'>{label}</CardTitle>
            </CardHeader>
            <CardContent
              className={cn(
                'grid gap-6',
                visible.length > 1 && 'md:grid-cols-2'
              )}
            >
              {visible.map((player) => (
                <div key={player.playerId} className='min-w-0 space-y-2'>
                  {visible.length > 1 && (
                    <p className='font-medium text-sm'>
                      {playerLabel(player.playerId)}
                    </p>
                  )}
                  <RoundColumn
                    round={player.rounds.find((r) => r.index === index)}
                    showMoney={showMoney}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
