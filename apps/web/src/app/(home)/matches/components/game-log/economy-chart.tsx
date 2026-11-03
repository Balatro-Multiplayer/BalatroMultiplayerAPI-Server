import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { GameLog, PlayerGameLog, RoundLog } from '../../lib/game-log/types'

const COLORS = ['#37bd76', '#ffcf5c', '#6aa7ff', '#ff6b8b']

const BAR_W = 14
const GROUP_GAP = 18
const TOP = 12
const PLOT_H = 130
const LEFT = 34
const LABEL_H = 36

interface ShopPoint {
  key: number
  label: string
  spent: number
  rerolls: number
}

function shopsOf(player: PlayerGameLog): RoundLog[] {
  return player.rounds.filter((r) => r.kind === 'shop')
}

function niceMax(value: number): number {
  if (value <= 10) return 10
  const step = value <= 40 ? 10 : value <= 100 ? 20 : 50
  return Math.ceil(value / step) * step
}

// Dollars spent in each shop (purchases + rerolls), one bar per player, with
// the running total as a line and the reroll count under each shop.
export function EconomyChart({
  log,
  players,
  playerLabel,
}: {
  log: GameLog
  players: PlayerGameLog[]
  playerLabel: (playerId: string) => ReactNode
}) {
  const keys = [
    ...new Set(log.players.flatMap((p) => shopsOf(p).map((r) => r.index))),
  ].sort((a, b) => a - b)
  if (keys.length === 0) return null

  const series = players.map((player, i) => {
    let running = 0
    const points: (ShopPoint & { total: number })[] = keys.map((key) => {
      const shop = shopsOf(player).find((r) => r.index === key)
      running += shop?.shopSpent ?? 0
      return {
        key,
        label: shop?.label ?? '',
        spent: shop?.shopSpent ?? 0,
        rerolls: shop?.shopRerolls ?? 0,
        total: running,
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

  const top = niceMax(
    Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.total)))
  )
  const groupW = BAR_W * Math.max(1, series.length) + GROUP_GAP
  const width = LEFT + keys.length * groupW
  const height = TOP + PLOT_H + LABEL_H
  const y = (value: number) => TOP + PLOT_H - (value / top) * PLOT_H
  const ticks = [0, 0.5, 1].map((f) => Math.round(top * f))

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Shop spending</CardTitle>
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
                ${s.spent} · {s.rerolls} reroll{s.rerolls === 1 ? '' : 's'}
              </span>
            </span>
          ))}
          <span className='text-muted-foreground'>
            Bars: spent in that shop · line: running total
          </span>
        </div>
        <div className='overflow-x-auto'>
          <svg
            role='img'
            aria-label='Dollars spent in each shop'
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className='max-w-none'
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={LEFT}
                  x2={width}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke='currentColor'
                  strokeOpacity={0.12}
                />
                <text
                  x={LEFT - 6}
                  y={y(tick) + 3}
                  textAnchor='end'
                  fontSize={10}
                  fill='currentColor'
                  fillOpacity={0.6}
                >
                  ${tick}
                </text>
              </g>
            ))}
            {keys.map((key, k) => {
              const x0 = LEFT + k * groupW + GROUP_GAP / 2
              const sample = series.find((s) => s.points[k]?.label)?.points[k]
              return (
                <g key={key}>
                  {series.map((s, i) => {
                    const p = s.points[k] as (typeof s.points)[number]
                    const h = (p.spent / top) * PLOT_H
                    return (
                      <rect
                        key={s.player.playerId}
                        x={x0 + i * BAR_W}
                        y={TOP + PLOT_H - h}
                        width={BAR_W - 2}
                        height={h}
                        rx={2}
                        fill={s.color}
                      >
                        <title>{`${p.label || `Shop ${k + 1}`}: $${p.spent}, ${p.rerolls} reroll${p.rerolls === 1 ? '' : 's'}`}</title>
                      </rect>
                    )
                  })}
                  <text
                    x={x0 + (series.length * BAR_W) / 2 - 1}
                    y={TOP + PLOT_H + 12}
                    textAnchor='middle'
                    fontSize={10}
                    fill='currentColor'
                    fillOpacity={0.75}
                  >
                    {k + 1}
                    <title>{sample?.label ?? `Shop ${k + 1}`}</title>
                  </text>
                  {series.map((s, i) => {
                    const p = s.points[k] as (typeof s.points)[number]
                    return (
                      <text
                        key={s.player.playerId}
                        x={x0 + (series.length * BAR_W) / 2 - 1}
                        y={TOP + PLOT_H + 24 + i * 10}
                        textAnchor='middle'
                        fontSize={9}
                        fill={s.color}
                      >
                        ↻{p.rerolls}
                      </text>
                    )
                  })}
                </g>
              )
            })}
            {series.map((s) => (
              <polyline
                key={s.player.playerId}
                fill='none'
                stroke={s.color}
                strokeWidth={2}
                strokeOpacity={0.9}
                points={s.points
                  .map(
                    (p, k) =>
                      `${LEFT + k * groupW + GROUP_GAP / 2 + (series.length * BAR_W) / 2 - 1},${y(p.total)}`
                  )
                  .join(' ')}
              />
            ))}
          </svg>
        </div>
        <p className='text-muted-foreground text-xs'>
          Numbers under the chart are the shop's position; ↻ is how many times
          that player rerolled in it.
        </p>
      </CardContent>
    </Card>
  )
}
