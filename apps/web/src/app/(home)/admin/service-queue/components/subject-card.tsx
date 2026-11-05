'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ageText,
  formatTime,
  REPORT_TYPE_LABELS,
  TYPE_LABELS,
} from '../lib/format'
import type { BanRow, SubjectCard as Card } from '../lib/types'
import { ItemLink } from './item-link'
import { Empty, Facts, Section } from './evidence/shared'

function BanLine({ ban }: { ban: BanRow }) {
  return (
    <li>
      <Badge variant={ban.liftedAt ? 'outline' : 'destructive'}>
        {ban.banType}
      </Badge>{' '}
      {ban.reason ?? 'no reason'}{' '}
      <span className='text-muted-foreground'>
        {formatTime(ban.issuedAt)} →{' '}
        {ban.liftedAt
          ? `lifted ${formatTime(ban.liftedAt)}`
          : ban.expiresAt
            ? formatTime(ban.expiresAt)
            : 'permanent'}
      </span>
    </li>
  )
}

export function SubjectCard({
  card,
  now,
  onOpenItem,
  onShowAllItems,
}: {
  card: Card
  now: number
  onOpenItem: (id: number) => void
  onShowAllItems: (playerId: string) => void
}) {
  const { player, nakama } = card
  const standing = nakama?.standing
  return (
    <Section
      title='Subject'
      aside={
        <Button
          size='sm'
          variant='ghost'
          onClick={() => onShowAllItems(player.id)}
        >
          All their items
        </Button>
      }
    >
      <div className='flex flex-wrap items-center gap-2'>
        <ItemLink
          to={{ player: player.id }}
          className='font-semibold text-bal-blue text-lg hover:underline'
        >
          {player.name ?? 'Unknown player'}
        </ItemLink>
        {player.deleted && <Badge variant='destructive'>deleted</Badge>}
        {player.privileges.map((p) => (
          <Badge key={p} variant='secondary'>
            {p}
          </Badge>
        ))}
        {nakama && (
          <Badge variant={nakama.online ? 'default' : 'outline'}>
            {nakama.online ? 'online' : 'offline'}
          </Badge>
        )}
        {standing && (
          <Badge variant='outline'>standing: {standing.standing}</Badge>
        )}
      </div>
      <Facts
        rows={[
          [
            'Player id',
            <span key='p' className='font-mono text-xs'>
              {player.id}
            </span>,
          ],
          [
            'Nakama id',
            <span key='n' className='font-mono text-xs'>
              {player.nakamaUserId ?? '—'}
            </span>,
          ],
          [
            'Account age',
            player.createdAt ? ageText(player.createdAt, now) : '—',
          ],
          [
            'Chat',
            player.chatBlocked ? 'blocked' : player.chatEnabled ? 'on' : 'off',
          ],
          [
            'Integrity',
            nakama?.integrity
              ? nakama.integrity.verified
                ? `verified until ${formatTime(nakama.integrity.expiresAt)}`
                : 'not verified'
              : '—',
          ],
          ...(standing?.reason
            ? ([['Standing reason', standing.reason]] as [string, string][])
            : []),
          [
            'Now',
            nakama?.lobby
              ? `in lobby ${nakama.lobby.code ?? nakama.lobby.matchId ?? ''}`
              : nakama?.ranked?.inGame
                ? 'in a ranked game'
                : nakama?.ranked?.queued
                  ? 'queued for ranked'
                  : 'not in a game',
          ],
          [
            'Mods',
            nakama?.mods?.mods.length ? (
              <span key='m' className='text-xs'>
                {nakama.mods.mods.join(', ')}
              </span>
            ) : (
              '—'
            ),
          ],
        ]}
      />

      {card.ratings.length > 0 && (
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='text-muted-foreground text-xs'>
              <tr>
                <th className='text-left font-normal'>Mode</th>
                <th className='text-left font-normal'>Rating</th>
                <th className='text-left font-normal'>Rank</th>
                <th className='text-left font-normal'>W/L</th>
              </tr>
            </thead>
            <tbody>
              {card.ratings.map((r) => (
                <tr key={`${r.modId}-${r.gameMode}-${r.season}`}>
                  <td>
                    {r.gameMode}{' '}
                    <span className='text-muted-foreground'>S{r.season}</span>
                  </td>
                  <td>{Math.round(r.rating)}</td>
                  <td>{r.rank ?? '—'}</td>
                  <td>
                    {r.wins}/{r.losses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className='grid gap-3 text-sm sm:grid-cols-2'>
        <div>
          <div className='text-muted-foreground text-xs'>
            Bans: {card.bans.active.length} active, {card.bans.prior.length}{' '}
            prior
          </div>
          <ul className='space-y-0.5'>
            {[...card.bans.active, ...card.bans.prior].slice(0, 6).map((b) => (
              <BanLine key={b.id} ban={b} />
            ))}
          </ul>
        </div>
        <div>
          <div className='text-muted-foreground text-xs'>
            Warnings: {card.warnings.length}
          </div>
          <ul className='space-y-0.5'>
            {card.warnings.slice(0, 5).map((w) => (
              <li key={w.id}>
                <span className='text-muted-foreground'>
                  {formatTime(w.issuedAt)}
                </span>{' '}
                {w.message}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className='text-muted-foreground text-xs'>
            Reports against: {card.reportsAgainst.total} (
            {card.reportsAgainst.open} open,{' '}
            {card.reportsAgainst.distinctReporters} reporters)
          </div>
          <div className='flex flex-wrap gap-1'>
            {Object.entries(card.reportsAgainst.byType).map(([type, n]) => (
              <Badge key={type} variant='outline'>
                {REPORT_TYPE_LABELS[type] ?? type}: {n}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <div className='text-muted-foreground text-xs'>
            Reports filed: {card.reportsFiled.total} (
            {card.reportsFiled.actioned} actioned)
          </div>
        </div>
      </div>

      <div className='text-sm'>
        <div className='text-muted-foreground text-xs'>
          Other open items about them
        </div>
        {card.otherItems.open.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className='space-y-0.5'>
            {card.otherItems.open.map((o) => (
              <li key={o.id}>
                <button
                  type='button'
                  className='text-left text-bal-blue hover:underline'
                  onClick={() => onOpenItem(o.id)}
                >
                  #{o.id} {TYPE_LABELS[o.itemType]}: {o.summary}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}
