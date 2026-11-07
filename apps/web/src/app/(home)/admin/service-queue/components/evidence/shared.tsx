'use client'

import { DownloadIcon, ExternalLinkIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { downloadReplay } from '../../lib/api'
import { ItemLink } from '../item-link'
import { formatTime, nameOf } from '../../lib/format'
import type {
  ChatLine,
  LogCheck,
  NakamaRunView,
  Placement,
  ReplayView,
} from '../../lib/types'

export function Section({
  title,
  children,
  aside,
}: {
  title: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className='space-y-2 rounded-lg border border-border p-3'>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='font-semibold text-muted-foreground text-xs uppercase tracking-wide'>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className='grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm'>
      {rows.map(([label, value]) => (
        <div key={label} className='contents'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd className='min-w-0 break-words'>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className='text-muted-foreground text-sm'>{children}</p>
}

const CHECK_VARIANT: Record<string, 'secondary' | 'destructive' | 'outline'> = {
  match: 'secondary',
  mismatch: 'destructive',
}

export function CheckBadge({ check }: { check: LogCheck | null | undefined }) {
  if (!check) return <Badge variant='outline'>no check</Badge>
  return (
    <Badge
      variant={CHECK_VARIANT[check] ?? 'outline'}
      title={
        check === 'incomplete'
          ? 'The stored log has missing events, so its check code was not compared.'
          : undefined
      }
    >
      log {check}
    </Badge>
  )
}

export function Placements({
  placements,
  names,
}: {
  placements: Placement[] | null | undefined
  names: Map<string, string>
}) {
  if (!placements?.length)
    return <span className='text-muted-foreground'>—</span>
  return (
    <ol className='space-y-0.5'>
      {[...placements]
        .sort((a, b) => a.place - b.place)
        .map((p) => (
          <li key={p.playerId}>
            <span className='text-muted-foreground'>#{p.place}</span>{' '}
            {nameOf(names, p.playerId)}
          </li>
        ))}
    </ol>
  )
}

// The replay viewer link and a JSON download.
export function ReplayLinks({ runId }: { runId: string | null | undefined }) {
  if (!runId) return null
  return (
    <div className='flex flex-wrap gap-2'>
      <Button asChild size='sm' variant='outline'>
        <ItemLink to={{ match: runId }}>
          <ExternalLinkIcon /> Open replay
        </ItemLink>
      </Button>
      <Button
        size='sm'
        variant='outline'
        onClick={() =>
          downloadReplay(runId).catch((err: Error) =>
            toast.error(`Replay download failed: ${err.message}`)
          )
        }
      >
        <DownloadIcon /> Download
      </Button>
    </div>
  )
}

// Nakama's view of the run: mode, seed, the result and each player's report.
export function RunSummary({
  run,
  replay,
  names,
}: {
  run: NakamaRunView | null
  replay: ReplayView | null
  names: Map<string, string>
}) {
  const runId = run?.run.runId ?? replay?.runId
  if (!run)
    return (
      <Section title='Run' aside={<ReplayLinks runId={runId} />}>
        <Empty>
          {replay
            ? `Stored replay only (${replay.status}).`
            : 'No run recorded for this item.'}
        </Empty>
      </Section>
    )
  const r = run.run
  return (
    <Section title='Run' aside={<ReplayLinks runId={runId} />}>
      <Facts
        rows={[
          [
            'Status',
            <Badge
              key='s'
              variant={r.status === 'disputed' ? 'destructive' : 'secondary'}
            >
              {r.status}
            </Badge>,
          ],
          ['Mode', r.rankedMode ?? r.gameMode ?? r.modId],
          ['Lobby', `${r.code}${r.lobbyType ? ` (${r.lobbyType})` : ''}`],
          ['Seed', r.seed ?? '—'],
          ['Played', `${formatTime(r.startedAt)} → ${formatTime(r.endedAt)}`],
        ]}
      />
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead className='text-muted-foreground text-xs'>
            <tr>
              <th className='py-1 pr-3 text-left font-normal'>Player</th>
              <th className='py-1 pr-3 text-left font-normal'>Reported</th>
              <th className='py-1 pr-3 text-left font-normal'>Log</th>
              <th className='py-1 text-left font-normal'>Flag</th>
            </tr>
          </thead>
          <tbody>
            {r.players.map((p) => (
              <tr key={p.id} className='border-border border-t align-top'>
                <td className='py-1 pr-3'>{p.displayName}</td>
                <td className='py-1 pr-3'>
                  <Placements placements={r.reports[p.id]} names={names} />
                </td>
                <td className='py-1 pr-3'>
                  <CheckBadge
                    check={r.logChecks?.[p.id] ?? run.logs[p.id]?.check}
                  />
                  <div className='text-muted-foreground text-xs'>
                    {run.logs[p.id]?.eventCount ?? 0} events
                  </div>
                </td>
                <td className='py-1'>
                  {r.flags?.[p.id] ? (
                    <Badge variant='destructive'>{r.flags[p.id]}</Badge>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='text-sm'>
        <span className='text-muted-foreground'>Recorded result: </span>
        <Placements placements={r.placements} names={names} />
      </div>
    </Section>
  )
}

// A chat tail with the subject's lines and flagged lines marked.
export function ChatTail({ lines }: { lines: ChatLine[] }) {
  if (!lines.length) return <Empty>No chat recorded.</Empty>
  return (
    <ul className='max-h-80 space-y-1 overflow-y-auto font-mono text-xs'>
      {lines.map((line) => (
        <li
          key={`${line.sentAt}-${line.playerId}-${line.message}`}
          className={cn(
            'rounded px-2 py-1',
            line.bySubject && 'bg-amber-500/10',
            line.isFlaggedLine && 'bg-destructive/25 ring-1 ring-destructive',
            line.flagged && !line.isFlaggedLine && 'bg-destructive/10'
          )}
        >
          <span className='text-muted-foreground'>
            {new Date(line.sentAt).toLocaleTimeString()}
          </span>{' '}
          <span
            className={cn('font-semibold', line.bySubject && 'text-amber-400')}
          >
            {line.displayName}
          </span>
          : {line.message}
          {line.flagged && (
            <Badge variant='destructive' className='ml-2'>
              flagged
            </Badge>
          )}
        </li>
      ))}
    </ul>
  )
}
