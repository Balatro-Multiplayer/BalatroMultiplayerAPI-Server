'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatTime } from '../../lib/format'
import type {
  ChatVerdict,
  FlaggedChatEvidence as Evidence,
  FlaggedChatMessage,
} from '../../lib/types'
import { ChatTail, Empty, Facts, Section } from './shared'

const verdictText = (verdict: ChatVerdict) =>
  verdict.source === 'local' ? 'Word list' : `Classifier band: ${verdict.band}`

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The message split into plain and matched-term pieces; `at` is where each
// piece starts.
export function highlightTerms(
  message: string,
  terms: readonly string[]
): { text: string; matched: boolean; at: number }[] {
  const wanted = terms.filter((t) => t.trim())
  if (!wanted.length) return [{ text: message, matched: false, at: 0 }]
  const pattern = new RegExp(`(${wanted.map(escapeRegExp).join('|')})`, 'gi')
  let at = 0
  return message
    .split(pattern)
    .filter((piece) => piece !== '')
    .map((piece) => {
      const start = at
      at += piece.length
      return {
        text: piece,
        matched: wanted.some((t) => t.toLowerCase() === piece.toLowerCase()),
        at: start,
      }
    })
}

const bandText = (message: FlaggedChatMessage) =>
  message.verdict.source === 'local'
    ? 'Word list'
    : `Band: ${message.band ?? message.verdict.band}`

const scoreText = (score: number | null) =>
  score === null ? 'no score' : `Guard score ${score.toFixed(2)}`

export function FlaggedChatEvidence({ evidence }: { evidence: Evidence }) {
  const byId = new Map(evidence.messages.map((m) => [m.id, m]))
  return (
    <div className='space-y-3'>
      <Section title={`Flagged messages (${evidence.messages.length})`}>
        <ul className='space-y-2'>
          {evidence.messages.map((m) => (
            <li key={m.id} className='space-y-1'>
              <p className='rounded bg-destructive/10 px-3 py-2 font-mono text-sm'>
                {highlightTerms(
                  m.message,
                  m.verdict.source === 'local' ? m.verdict.matches : []
                ).map((piece) =>
                  piece.matched ? (
                    <mark
                      key={piece.at}
                      className='rounded bg-destructive px-0.5 text-white'
                    >
                      {piece.text}
                    </mark>
                  ) : (
                    <span key={piece.at}>{piece.text}</span>
                  )
                )}
              </p>
              <div className='flex flex-wrap gap-1 text-xs'>
                <Badge variant='outline'>{bandText(m)}</Badge>
                <Badge variant='outline'>{scoreText(m.guardScore)}</Badge>
                <span className='text-muted-foreground'>
                  {formatTime(m.sentAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <Facts
          rows={[
            ['Lobby', evidence.source?.lobbyCode ?? '—'],
            [
              'Already muted',
              evidence.alreadyMuted ? (
                <Badge key='m' variant='destructive'>
                  yes
                </Badge>
              ) : (
                'no'
              ),
            ],
          ]}
        />
      </Section>

      <Section title='Lobby conversation'>
        {evidence.conversation.length === 0 ? (
          <Empty>No chat recorded.</Empty>
        ) : (
          <ul className='max-h-96 space-y-1 overflow-y-auto font-mono text-xs'>
            {evidence.conversation.map((line) => {
              const flagged =
                line.flaggedMessageId === null
                  ? null
                  : byId.get(line.flaggedMessageId)
              return (
                <li
                  key={`${line.sentAt}-${line.playerId}-${line.message}`}
                  className={cn(
                    'rounded px-2 py-1',
                    line.bySubject && 'bg-amber-500/10',
                    flagged && 'bg-destructive/25 ring-1 ring-destructive'
                  )}
                >
                  <span className='text-muted-foreground'>
                    {new Date(line.sentAt).toLocaleTimeString()}
                  </span>{' '}
                  <span
                    className={cn(
                      'font-semibold',
                      line.bySubject && 'text-amber-400'
                    )}
                  >
                    {line.displayName}
                  </span>
                  : {line.message}
                  {flagged && (
                    <Badge variant='destructive' className='ml-2'>
                      flagged, {bandText(flagged)}, {scoreText(flagged.guardScore)}
                    </Badge>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title='Other flagged messages (30 days)'>
        {evidence.otherFlags.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className='space-y-1 text-sm'>
            {evidence.otherFlags.map((f) => (
              <li key={f.id}>
                <span className='text-muted-foreground'>
                  {formatTime(f.flaggedAt)}
                </span>{' '}
                <span className='font-mono'>{f.message}</span>{' '}
                <Badge variant='outline'>{verdictText(f.verdict)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
