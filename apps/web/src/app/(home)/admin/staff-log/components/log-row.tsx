import Link from 'next/link'
import { cn } from '@/lib/utils'
import { STAFF_ACTION_LABELS, type Tone, toneOf } from '../lib/action-labels'
import {
  NO_REASON_TEXT,
  type StaffLogEntry,
  agoOf,
  clockOf,
  lobbyCodeOf,
  shortId,
  sourceLinks,
  staffHref,
  targetHref,
} from '../lib/log-view'

const TONES: Record<Tone, string> = {
  red: 'border-red-500/60 bg-red-500/15 text-red-300',
  amber: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
  green: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300',
  blue: 'border-sky-500/60 bg-sky-500/15 text-sky-300',
  plain: 'border-border bg-background/60 text-foreground',
}

const link = 'text-bal-blue hover:underline'

// One staff log entry: when, who, the action, the subject, the note, where it
// came from. Every player, match and queue item in it links to its page.
export function LogRow({ entry, now }: { entry: StaffLogEntry; now: Date }) {
  const target = targetHref(entry)
  const code = lobbyCodeOf(entry)
  const sources = sourceLinks(entry)
  const ago = agoOf(entry.at, now)
  return (
    <div
      data-testid='staff-log-row'
      className='grid grid-cols-1 gap-x-4 gap-y-1 border-border border-b px-4 py-3 text-sm last:border-b-0 md:grid-cols-[90px_150px_170px_190px_1fr_190px]'
    >
      <div className='font-mono text-muted-foreground text-xs'>
        <div>{clockOf(entry.at)}</div>
        {ago && <div>{ago}</div>}
      </div>
      <div>
        <Link href={staffHref(entry)} className='font-semibold hover:underline'>
          {entry.staffName ?? shortId(entry.staffPlayerId)}
        </Link>
        <div className='text-muted-foreground text-xs'>{entry.staffRole}</div>
      </div>
      <div>
        <span
          className={cn(
            'inline-block rounded border px-2 py-0.5 font-medium text-xs',
            TONES[toneOf(entry.action)]
          )}
        >
          {STAFF_ACTION_LABELS[entry.action] ?? entry.action}
        </span>
      </div>
      <div className='min-w-0 break-words'>
        {target ? (
          <Link href={target} className={cn(link, 'font-semibold')}>
            {entry.targetName ?? shortId(entry.targetPlayerId ?? '')}
          </Link>
        ) : code ? (
          <span className='text-muted-foreground'>
            lobby <span className='font-mono'>{code}</span>
          </span>
        ) : (
          <span className='text-muted-foreground'>-</span>
        )}
        {target && code && (
          <div className='text-muted-foreground text-xs'>
            lobby <span className='font-mono'>{code}</span>
          </div>
        )}
      </div>
      <div className='break-words'>
        {entry.reason || (
          <span className='text-muted-foreground italic'>{NO_REASON_TEXT}</span>
        )}
      </div>
      <div className='flex flex-col gap-0.5 text-sm md:items-end'>
        {sources.length === 0 ? (
          <span className='text-muted-foreground'>No link</span>
        ) : (
          sources.map((s) => (
            <Link key={s.href} href={s.href} className={link}>
              {s.label}
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
