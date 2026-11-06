'use client'

import { type ReactNode, useState } from 'react'
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
import type { GameLog, PlayerGameLog, RoundLog } from '../../lib/game-log/types'

const COLORS = ['#37bd76', '#ffcf5c', '#6aa7ff', '#ff6b8b']

const TOP = 24
const PLOT_H = 280
const LEFT = 68
const RIGHT = 24
const ROW = 17
const SLOT_SHORT = ['Small', 'Big', 'Boss'] as const

interface AnteShop {
  slot: 0 | 1 | 2
  spent: number
}

interface AntePoint {
  ante: number
  spent: number
  rerolls: number
  /** Total spent from the start of the game to the end of this ante. */
  total: number
  shops: AnteShop[]
}

interface Series {
  player: PlayerGameLog
  color: string
  points: AntePoint[]
  spent: number
  rerolls: number
}

function shopsOf(player: PlayerGameLog): RoundLog[] {
  return player.rounds.filter((r) => r.kind === 'shop')
}

const rerolls = (n: number) => `${n} reroll${n === 1 ? '' : 's'}`

function niceMax(value: number): number {
  if (value <= 10) return 10
  const step = value <= 40 ? 10 : value <= 100 ? 20 : value <= 400 ? 50 : 100
  return Math.ceil(value / step) * step
}

// Pointer x relative to the box holding the chart (the tooltip's offset
// parent), whatever the chart's horizontal scroll.
function pointerPos(e: { clientX: number; currentTarget: Element }): {
  x: number
  flip: boolean
} {
  const rect = e.currentTarget
    .closest('svg')
    ?.parentElement?.parentElement?.getBoundingClientRect()
  const x = e.clientX - (rect?.left ?? 0)
  // Past the middle the tooltip opens to the left of the pointer.
  return { x, flip: rect ? x > rect.width / 2 : false }
}

function ChartTooltip({
  left,
  flip,
  ante,
  rows,
}: {
  left: number
  flip: boolean
  ante: number
  rows: { id: string; name: ReactNode; color: string; point: AntePoint }[]
}) {
  return (
    <div
      className='pointer-events-none absolute top-2 z-10 w-max max-w-sm space-y-1 rounded-md border bg-popover px-3 py-2 text-popover-foreground text-xs shadow-md'
      style={
        flip
          ? { left: left - 12, transform: 'translateX(-100%)' }
          : { left: left + 12 }
      }
    >
      <p className='font-medium'>Ante {ante}</p>
      {rows.map((row) => (
        <div key={row.id}>
          <p className='flex items-center gap-1.5 font-mono'>
            <span
              className='inline-block h-2 w-2 rounded-sm'
              style={{ background: row.color }}
            />
            <span className='font-sans'>{row.name}</span>
            <span>
              spent ${row.point.spent} · total ${row.point.total}
              {` · ${rerolls(row.point.rerolls)}`}
            </span>
          </p>
          {row.point.shops.length > 0 && (
            <p className='pl-3.5 font-mono text-[11px] text-muted-foreground'>
              {row.point.shops
                .map((s) => `${SLOT_SHORT[s.slot]} $${s.spent}`)
                .join(' · ')}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function SpendingGraph({
  antes,
  series,
  playerLabel,
}: {
  antes: number[]
  series: Series[]
  playerLabel: (playerId: string) => ReactNode
}) {
  // Which ante the pointer is over, and where (relative to the chart box).
  const [hover, setHover] = useState<{
    k: number
    x: number
    flip: boolean
  } | null>(null)

  const count = Math.max(1, series.length)
  const top = niceMax(
    Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.total)))
  )
  // The chart stretches to the card; a game with very many antes stops
  // shrinking and scrolls sideways instead.
  const roomy = antes.length <= 12
  const colW = roomy ? 104 : 84
  const plotRight = LEFT + antes.length * colW
  const width = plotRight + RIGHT
  const axisY = TOP + PLOT_H
  const spentY = axisY + 48
  const rerollY = spentY + count * ROW + 14
  // Sized from the player count so every player gets a row.
  const height = rerollY + count * ROW + 8
  const y = (value: number) => axisY - (value / top) * PLOT_H
  const colX = (k: number) => LEFT + k * colW + colW / 2
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f))

  return (
    <div className='relative'>
      {hover && (
        <ChartTooltip
          left={hover.x}
          flip={hover.flip}
          ante={antes[hover.k] as number}
          rows={series.map((s) => ({
            id: s.player.playerId,
            name: playerLabel(s.player.playerId),
            color: s.color,
            point: s.points[hover.k] as AntePoint,
          }))}
        />
      )}
      <div className='overflow-x-auto'>
        <svg
          role='img'
          aria-label='Total dollars spent over the game'
          width='100%'
          viewBox={`0 0 ${width} ${height}`}
          className='h-auto'
          style={{ minWidth: roomy ? undefined : width }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={LEFT}
                x2={plotRight}
                y1={y(tick)}
                y2={y(tick)}
                stroke='currentColor'
                strokeOpacity={0.12}
              />
              <text
                x={LEFT - 8}
                y={y(tick) + 4}
                textAnchor='end'
                fontSize={14}
                fill='currentColor'
                fillOpacity={0.6}
              >
                ${tick}
              </text>
            </g>
          ))}

          {antes.map((ante, k) => (
            <g key={ante}>
              {hover?.k === k && (
                <rect
                  x={LEFT + k * colW}
                  y={0}
                  width={colW}
                  height={height}
                  fill='currentColor'
                  fillOpacity={0.07}
                />
              )}
              <text
                x={colX(k)}
                y={axisY + 24}
                textAnchor='middle'
                fontSize={15}
                fontWeight={600}
                fill='currentColor'
              >
                Ante {ante}
              </text>
              {series.map((s, i) => (
                <text
                  key={`spent-${s.player.playerId}`}
                  x={colX(k)}
                  y={spentY + i * ROW}
                  textAnchor='middle'
                  fontSize={14}
                  fill={s.color}
                >
                  ${s.points[k]?.spent ?? 0}
                </text>
              ))}
              {series.map((s, i) => (
                <text
                  key={`reroll-${s.player.playerId}`}
                  x={colX(k)}
                  y={rerollY + i * ROW}
                  textAnchor='middle'
                  fontSize={13}
                  fill={s.color}
                  fillOpacity={0.9}
                >
                  {s.points[k]?.rerolls ?? 0}
                </text>
              ))}
            </g>
          ))}

          <text
            x={LEFT - 8}
            y={spentY}
            textAnchor='end'
            fontSize={12}
            fill='currentColor'
            fillOpacity={0.6}
          >
            Spent
          </text>
          <text
            x={LEFT - 8}
            y={rerollY}
            textAnchor='end'
            fontSize={12}
            fill='currentColor'
            fillOpacity={0.6}
          >
            Rerolls
          </text>

          {series.map((s) => (
            <g key={s.player.playerId}>
              <polyline
                fill='none'
                stroke={s.color}
                strokeWidth={3}
                strokeOpacity={0.9}
                strokeLinejoin='round'
                points={[
                  `${LEFT},${y(0)}`,
                  ...s.points.map((p, k) => `${colX(k)},${y(p.total)}`),
                ].join(' ')}
              />
              {s.points.map((p, k) => (
                <circle
                  key={p.ante}
                  cx={colX(k)}
                  cy={y(p.total)}
                  r={5}
                  fill={s.color}
                />
              ))}
            </g>
          ))}

          {antes.map((ante, k) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only detail; the same numbers are printed under each ante
            <rect
              key={`hit-${ante}`}
              x={LEFT + k * colW}
              y={0}
              width={colW}
              height={height}
              fill='transparent'
              onMouseEnter={(e) => setHover({ k, ...pointerPos(e) })}
              onMouseMove={(e) => setHover({ k, ...pointerPos(e) })}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      </div>
    </div>
  )
}

// The old log parser's shop spending table: one row per shop, a column per
// player, and a total.
function SpendingTable({
  log,
  series,
  playerLabel,
}: {
  log: GameLog
  series: Series[]
  playerLabel: (playerId: string) => ReactNode
}) {
  const keys = [
    ...new Set(log.players.flatMap((p) => shopsOf(p).map((r) => r.index))),
  ].sort((a, b) => a - b)

  const cell = (player: PlayerGameLog, key: number) => {
    const shop = shopsOf(player).find((r) => r.index === key)
    if (shop) {
      return (
        <>
          ${shop.shopSpent}
          <span className='text-muted-foreground'> ↻{shop.shopRerolls}</span>
        </>
      )
    }
    // No shop after a blind that player skipped; '-' when the log simply
    // does not have one.
    const blind = player.rounds.find(
      (r) => r.kind === 'blind' && r.index === Math.floor(key)
    )
    return blind?.entry === 'skipped' ? 'Skipped' : '-'
  }

  return (
    <div className='overflow-hidden rounded-lg border bg-background'>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader className='sticky top-0 z-10 bg-background'>
            <TableRow className='bg-muted/50'>
              <TableHead className='w-15 text-right font-mono'>Shop</TableHead>
              <TableHead className='font-mono'>After</TableHead>
              {series.map((s) => (
                <TableHead
                  key={s.player.playerId}
                  className='text-right font-mono'
                >
                  {playerLabel(s.player.playerId)}
                  {s.player.result === 'win' ? ' 🏆' : ''}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key, i) => {
              const label =
                log.players
                  .flatMap(shopsOf)
                  .find((r) => r.index === key)
                  ?.label.replace(/^Ante (\d+) · Shop after /, 'Ante $1 · ') ??
                ''
              return (
                <TableRow key={key}>
                  <TableCell className='text-right font-mono'>
                    {i + 1}
                  </TableCell>
                  <TableCell className='text-muted-foreground text-xs'>
                    {label}
                  </TableCell>
                  {series.map((s) => (
                    <TableCell
                      key={s.player.playerId}
                      className='text-right font-mono'
                    >
                      {cell(s.player, key)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
            <TableRow className='border-t-2 font-bold'>
              <TableCell className='text-right font-mono'>Total</TableCell>
              <TableCell />
              {series.map((s) => (
                <TableCell
                  key={s.player.playerId}
                  className='text-right font-mono'
                >
                  ${s.spent}
                  <span className='font-normal text-muted-foreground'>
                    {' '}
                    ↻{s.rerolls}
                  </span>
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// Total spent over the game as a line, per ante, with each player's spend
// and reroll count printed under every ante; or the same numbers as the old
// parser's spreadsheet-style table.
export function EconomyChart({
  log,
  players,
  playerLabel,
}: {
  log: GameLog
  players: PlayerGameLog[]
  playerLabel: (playerId: string) => ReactNode
}) {
  const [view, setView] = useState<'graph' | 'spreadsheet'>('graph')

  const antes = [
    ...new Set(log.players.flatMap((p) => shopsOf(p).map((r) => r.ante))),
  ].sort((a, b) => a - b)
  if (antes.length === 0) return null

  const series: Series[] = players.map((player, i) => {
    let running = 0
    const points = antes.map((ante): AntePoint => {
      const shops = shopsOf(player).filter((r) => r.ante === ante)
      const spent = shops.reduce((n, r) => n + r.shopSpent, 0)
      running += spent
      return {
        ante,
        spent,
        rerolls: shops.reduce((n, r) => n + r.shopRerolls, 0),
        total: running,
        shops: shops.map((r) => ({ slot: r.slot, spent: r.shopSpent })),
      }
    })
    return {
      player,
      color: COLORS[i % COLORS.length] as string,
      points,
      spent: running,
      rerolls: points.reduce((n, p) => n + p.rerolls, 0),
    }
  })

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2'>
        <CardTitle className='text-base'>Shop spending</CardTitle>
        <div className='flex gap-1'>
          <Button
            size='sm'
            variant={view === 'graph' ? 'default' : 'outline'}
            onClick={() => setView('graph')}
          >
            Graph view
          </Button>
          <Button
            size='sm'
            variant={view === 'spreadsheet' ? 'default' : 'outline'}
            onClick={() => setView('spreadsheet')}
          >
            Spreadsheet view
          </Button>
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='flex flex-wrap gap-x-5 gap-y-1 text-xs'>
          {series.map((s) => (
            <span key={s.player.playerId} className='flex items-center gap-1.5'>
              <span
                className='inline-block h-2.5 w-2.5 rounded-sm'
                style={{ background: s.color }}
              />
              <span className='font-medium'>
                {playerLabel(s.player.playerId)}
              </span>
              <span className='font-mono text-muted-foreground'>
                ${s.spent} · {rerolls(s.rerolls)}
              </span>
            </span>
          ))}
        </div>
        {view === 'graph' ? (
          <>
            <SpendingGraph
              antes={antes}
              series={series}
              playerLabel={playerLabel}
            />
            <p className='text-muted-foreground text-xs'>
              The line is the total each player has spent in shops by the end of
              that ante. Under each ante: dollars spent in it, then rerolls.
              Hover an ante for the shop-by-shop numbers.
            </p>
          </>
        ) : (
          <SpendingTable log={log} series={series} playerLabel={playerLabel} />
        )}
      </CardContent>
    </Card>
  )
}
