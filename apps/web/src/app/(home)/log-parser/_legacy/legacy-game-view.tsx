'use client'

import Image from 'next/image'
import { type ReactNode, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { jokers } from '@/shared/jokers'
import { vouchers } from '@/shared/vouchers'
import { IdolTrack } from '../../matches/components/game-log/idol-track'
import { InfoTooltipLabel } from '../../matches/components/info-tooltip-label'
import { getDeckInfo, getRulesetInfo } from '../../matches/lib/ruleset-info'
import { DeckViewsCard } from './deck-view'
import type { IdolHit, LogEvent, ParsedLogGame } from './log-source-parser'
import { PvpBlindsCard } from './pvp-blinds'

const EVENT_COLOR: Record<LogEvent['type'], string> = {
  event: 'text-blue-400',
  status: 'text-green-400',
  system: 'text-purple-400',
  shop: 'text-yellow-400',
  action: 'text-cyan-400',
  info: 'text-gray-400',
  error: 'text-red-500',
}

function boolText(value: string | boolean | null | undefined): string {
  if (value === true || value === 'true') return 'Yes'
  if (value === false || value === 'false') return 'No'
  return 'Unknown'
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'N/A'
  const m = Math.floor(seconds / 60)
  return `${m}m ${Math.round(seconds % 60)}s`
}

function prettyKey(key: string): string {
  return key
    .trim()
    .replace(/^[jv]_(mp_)?/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// A final joker string is "j_key-edition-modifier-rental" (parser output).
function JokerList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className='text-muted-foreground text-sm'>None recorded.</p>
  }
  return (
    <ul className='flex flex-wrap gap-3'>
      {items.map((raw, i) => {
        const [key = '', ...mods] = raw.split('-')
        const info = jokers[key.trim()]
        const tags = mods.filter((m) => m && m !== 'none')
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
            key={i}
            className='flex w-20 flex-col items-center gap-1 text-center'
          >
            {info && (
              <Image
                src={`/cards/${info.file}`}
                alt={info.name}
                width={71}
                height={95}
                className='h-auto w-full'
              />
            )}
            <span className='text-xs leading-tight'>
              {info?.name ?? prettyKey(key)}
            </span>
            {tags.map((tag) => (
              <Badge key={tag} variant='outline' className='text-[10px]'>
                {prettyKey(tag)}
              </Badge>
            ))}
          </li>
        )
      })}
    </ul>
  )
}

function VoucherList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className='text-muted-foreground text-sm'>None recorded.</p>
  }
  return (
    <ul className='flex flex-wrap gap-x-4 gap-y-1 text-sm'>
      {items.map((key, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
        <li key={i}>{vouchers[key.trim()]?.name ?? prettyKey(key)}</li>
      ))}
    </ul>
  )
}

function idolRollOf(hit: IdolHit, index: number) {
  const code = (rank: string) => (rank === '10' ? 'T' : rank)
  return {
    t: index,
    roll: hit.roll,
    winner: `${code(hit.winner.rank)}${hit.winner.suit}`,
    cards: hit.cards.map((c) => ({
      rank: c.rank === 'T' ? '10' : c.rank,
      suit: c.suit,
      count: c.count,
    })),
  }
}

function ShopSpending({
  game,
  ownerLabel,
  opponentLabel,
}: {
  game: ParsedLogGame
  ownerLabel: string
  opponentLabel: string
}) {
  const shops = Math.max(
    game.moneySpentPerShop.length,
    game.moneySpentPerShopOpponent.length
  )
  if (shops === 0 && game.moneySpent === 0 && game.opponentMoneySpent === 0) {
    return (
      <p className='text-muted-foreground text-sm italic'>
        No shop spending data recorded.
      </p>
    )
  }
  const cell = (v: number | null | undefined) =>
    v === null ? 'Skipped' : v === undefined ? '-' : `$${v}`
  const sum = (values: (number | null)[]) =>
    values.filter((v): v is number => v !== null).reduce((a, b) => a + b, 0)
  return (
    <div className='overflow-x-auto rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='text-right'>Shop</TableHead>
            <TableHead className='text-right'>{ownerLabel}</TableHead>
            <TableHead className='text-right'>{opponentLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: shops }, (_, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
            <TableRow key={j}>
              <TableCell className='text-right font-mono'>{j + 1}</TableCell>
              <TableCell className='text-right font-mono'>
                {cell(game.moneySpentPerShop[j])}
              </TableCell>
              <TableCell className='text-right font-mono'>
                {cell(game.moneySpentPerShopOpponent[j])}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className='font-bold'>
            <TableCell>Reported</TableCell>
            <TableCell className='text-right font-mono'>
              ${sum(game.moneySpentPerShop)}
            </TableCell>
            <TableCell className='text-right font-mono'>
              ${sum(game.moneySpentPerShopOpponent)}
            </TableCell>
          </TableRow>
          <TableRow className='border-t-2 font-bold'>
            <TableCell>Actual</TableCell>
            <TableCell className='text-right font-mono'>
              ${game.moneySpent}
            </TableCell>
            <TableCell className='text-right font-mono'>
              ${game.opponentMoneySpent}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p className='px-3 py-2 text-muted-foreground text-xs'>
        Actual: money spent via buy/reroll actions in this log (yours) or
        reported to you over the network (opponent).
      </p>
    </div>
  )
}

function LegacyGame({ game }: { game: ParsedLogGame }) {
  const generic =
    !game.logOwnerName ||
    !game.opponentName ||
    game.logOwnerName === game.opponentName
  const ownerLabel = generic ? 'Log Owner' : (game.logOwnerName as string)
  const opponentLabel = generic ? 'Opponent' : (game.opponentName as string)
  const deckInfo = getDeckInfo(game.deck)
  const ruleset = game.options?.ruleset
  const rulesetInfo = getRulesetInfo(ruleset)

  const details: [string, ReactNode][] = [
    ['Role', game.isHost === null ? 'Unknown' : game.isHost ? 'Host' : 'Guest'],
    [
      'Winner',
      game.winner === null
        ? 'Unknown'
        : game.winner === 'logOwner'
          ? ownerLabel
          : opponentLabel,
    ],
    ['Lobby', game.lobbyCode ?? 'Unknown'],
    [
      'Deck',
      game.deck && deckInfo ? (
        <InfoTooltipLabel
          key='deck'
          label={game.deck}
          description={deckInfo.description}
        />
      ) : (
        (game.deck ?? 'Unknown')
      ),
    ],
    ['Seed', game.seed ?? 'Unknown'],
    [
      'Ruleset',
      ruleset && rulesetInfo ? (
        <InfoTooltipLabel
          key='ruleset'
          label={ruleset}
          description={rulesetInfo.description}
        />
      ) : (
        (ruleset ?? 'Unknown')
      ),
    ],
    ['Stake', game.options?.stake ?? 'Unknown'],
    ['Starting lives', game.options?.starting_lives ?? 'Unknown'],
    ['Different decks', boolText(game.options?.different_decks)],
    ['Different seeds', boolText(game.options?.different_seeds)],
    ['Death on round loss', boolText(game.options?.death_on_round_loss)],
    ['Gold on life loss', boolText(game.options?.gold_on_life_loss)],
    ['No gold on round loss', boolText(game.options?.no_gold_on_round_loss)],
    ['Duration', formatDuration(game.durationSeconds)],
  ]

  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <div className='min-w-0 space-y-4'>
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Game Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-sm'>
              {details.map(([label, value]) => (
                <div key={label} className='contents'>
                  <dt className='text-muted-foreground'>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {(game.hostMods.length > 0 || game.guestMods.length > 0) && (
              <p className='mt-3 text-muted-foreground text-xs'>
                Mods: {[...game.hostMods, ...game.guestMods].join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
        <DeckViewsCard
          logOwnerDeck={game.logOwnerDeck}
          opponentDeck={game.opponentDeck}
          ownerLabel={ownerLabel}
          opponentLabel={opponentLabel}
          winner={game.winner}
        />
        {game.idolHits.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className='text-lg'>
                Idol Rolls ({game.idolHits.length})
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              {game.idolHits.map((hit, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
                <div key={i} className='space-y-1'>
                  <p className='text-muted-foreground text-xs'>Hit {i + 1}</p>
                  <IdolTrack roll={idolRollOf(hit, i)} />
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Events</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className='h-[80vh]'>
              <div className='space-y-2 pr-4'>
                {game.events.map((event, i) => {
                  const theirs = event.text.includes('Opponent')
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
                    <div key={i}>
                      <div
                        className={cn(
                          'flex text-sm',
                          EVENT_COLOR[event.type],
                          theirs && 'flex-row-reverse text-right'
                        )}
                      >
                        <span
                          className={cn('font-mono', theirs ? 'ml-2' : 'mr-2')}
                        >
                          {event.timestamp.toLocaleTimeString()}
                        </span>
                        <span>{event.text}</span>
                      </div>
                      {event.img && (
                        <div className={cn(theirs && 'flex justify-end')}>
                          <Image
                            width={142}
                            height={190}
                            src={event.img}
                            alt={event.img}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
      <div className='min-w-0 space-y-4'>
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Shop Spending</CardTitle>
          </CardHeader>
          <CardContent>
            <ShopSpending
              game={game}
              ownerLabel={ownerLabel}
              opponentLabel={opponentLabel}
            />
          </CardContent>
        </Card>
        <PvpBlindsCard
          game={game}
          ownerLabel={ownerLabel}
          opponentLabel={opponentLabel}
        />
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Final Jokers</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div>
              <p className='mb-2 font-medium text-sm'>{ownerLabel}</p>
              <JokerList items={game.logOwnerFinalJokers} />
            </div>
            <div>
              <p className='mb-2 font-medium text-sm'>{opponentLabel}</p>
              <JokerList items={game.opponentFinalJokers} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Vouchers</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div>
              <p className='mb-1 font-medium text-sm'>{ownerLabel}</p>
              <VoucherList items={game.logOwnerVouchers} />
            </div>
            <div>
              <p className='mb-1 font-medium text-sm'>{opponentLabel}</p>
              <VoucherList items={game.opponentVouchers} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function LegacyGamesView({ games }: { games: ParsedLogGame[] }) {
  const [selected, setSelected] = useState(0)
  const game = games[selected] ?? games[0]
  if (!game) return null
  return (
    <div className='space-y-4'>
      {games.length > 1 && (
        <div className='flex flex-wrap gap-2'>
          {games.map((g, i) => (
            <Button
              key={g.id}
              size='sm'
              variant={i === selected ? 'default' : 'outline'}
              onClick={() => setSelected(i)}
            >
              Game {g.id}
            </Button>
          ))}
        </div>
      )}
      <p className='text-muted-foreground text-sm'>
        Started {game.startDate.toLocaleString()}
        {game.endDate && ` · Ended ${game.endDate.toLocaleString()}`}
      </p>
      <LegacyGame game={game} />
    </div>
  )
}
