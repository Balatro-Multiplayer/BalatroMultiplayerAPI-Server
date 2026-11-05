'use client'

import { Badge } from '@/components/ui/badge'
import { LOBBY_KIND_LABELS, TARGET_ROLE_LABELS } from '../../lib/format'
import type { ContestEvidence as Evidence } from '../../lib/types'
import {
  CheckBadge,
  Empty,
  Facts,
  Placements,
  RunSummary,
  Section,
} from './shared'

export function ContestEvidence({
  evidence,
  names,
}: {
  evidence: Evidence
  names: Map<string, string>
}) {
  // An in-game Contest holds the result unrated; a website-only one leaves it standing.
  const held =
    evidence.contests.length === 0 ||
    evidence.contests.some((c) => c.kind === 'in_game')
  return (
    <div className='space-y-3'>
      <Section title='Contested match'>
        <Facts
          rows={[
            ['Game', LOBBY_KIND_LABELS[evidence.lobbyKind]],
            [
              'Mode',
              evidence.match?.gameMode ?? evidence.run?.run.gameMode ?? '-',
            ],
            ['Run', evidence.runId],
          ]}
        />
        <div className='rounded border border-border border-dashed p-2 text-sm'>
          <div className='mb-1 font-semibold'>
            {held ? 'Reported before the contest' : 'Result standing'}
          </div>
          {evidence.recorded && evidence.recorded.length > 0 ? (
            <>
              <Placements placements={evidence.recorded} names={names} />
              <div className='mt-1 text-muted-foreground text-xs'>
                {held
                  ? 'Held: not rated until you decide. Dismiss rates this result.'
                  : 'Rated already. Dismiss keeps this result.'}
              </div>
            </>
          ) : (
            <Empty>
              {held
                ? 'Nobody reported a result before the contest.'
                : 'No result is recorded for this match.'}
            </Empty>
          )}
        </div>
      </Section>

      {evidence.contests.length > 0 && (
        <Section title='Contests'>
          <ul className='space-y-2 text-sm'>
            {evidence.contests.map((c) => (
              <li key={c.id} className='rounded border border-border p-2'>
                <div className='font-semibold'>
                  {names.get(c.contesterId) ?? c.contesterId}
                  <Badge variant='secondary' className='ml-1'>
                    {c.kind === 'in_game' ? 'In the game' : 'On the website'}
                  </Badge>
                  {c.withdrawn && (
                    <Badge variant='outline' className='ml-1'>
                      Withdrawn
                    </Badge>
                  )}
                </div>
                <div className='text-muted-foreground'>
                  {c.reason ?? 'No reason given'}
                </div>
                {c.detail && (
                  <div className='whitespace-pre-wrap'>{c.detail}</div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title='Players'>
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='text-muted-foreground text-xs'>
              <tr>
                <th className='py-1 pr-3 text-left font-normal'>Player</th>
                <th className='py-1 pr-3 text-left font-normal'>Log</th>
                <th className='py-1 pr-3 text-left font-normal'>Rating</th>
                <th className='py-1 text-left font-normal'>Contests started</th>
              </tr>
            </thead>
            <tbody>
              {evidence.players.map((p) => (
                <tr key={p.id} className='border-border border-t'>
                  <td className='py-1 pr-3'>
                    {p.name ?? p.id}
                    {p.role && (
                      <Badge variant='secondary' className='ml-1'>
                        {TARGET_ROLE_LABELS[p.role]}
                      </Badge>
                    )}
                    {p.flag && (
                      <Badge variant='destructive' className='ml-1'>
                        {p.flag}
                      </Badge>
                    )}
                  </td>
                  <td className='py-1 pr-3'>
                    <CheckBadge check={p.logCheck} />
                  </td>
                  <td className='py-1 pr-3'>
                    {p.ratings.length
                      ? p.ratings
                          .map(
                            (r) =>
                              `${Math.round(r.rating)} (S${r.season}, ${r.gamesPlayed} games)`
                          )
                          .join(', ')
                      : '-'}
                  </td>
                  <td className='py-1'>{p.contestsStarted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <RunSummary run={evidence.run} replay={evidence.replay} names={names} />
    </div>
  )
}
