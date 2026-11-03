'use client'

import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { tagValue } from '../../lib/card-ref'
import { formatScore } from '../../lib/game-log/score'
import type { GameEvent } from '../../lib/game-log/types'
import { CardChip } from '../card-chip'
import { PlayingCardVisual } from '../playing-card-visual'

type HandEvent = Extract<GameEvent, { type: 'hand' }>

// One played/discarded hand as a single line; the cards (with enhancement,
// edition and seal) and the jokers owned at that moment live in the
// dropdown, so a long log stays scannable.
export function HandRow({ event }: { event: HandEvent }) {
  const [open, setOpen] = useState(false)
  const isPlay = event.kind === 'play'
  const count = Math.max(event.cards.length, event.positions.length)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className='flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-muted/50'>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            open && 'rotate-90'
          )}
        />
        <span className={cn('font-medium', !isPlay && 'text-muted-foreground')}>
          {isPlay ? 'Played' : 'Discarded'} {count} card
          {count === 1 ? '' : 's'}
        </span>
        {isPlay && event.handScore !== null && (
          <span className='font-mono text-xs'>
            +{formatScore(event.handScore)}
          </span>
        )}
        {event.roundScore !== null && (
          <span className='font-mono text-muted-foreground text-xs'>
            = {formatScore(event.roundScore)}
          </span>
        )}
        {event.handsLeft !== null && (
          <span className='ml-auto text-muted-foreground text-xs'>
            {event.handsLeft} left
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='space-y-2 border-l py-2 pl-3'>
          {event.cards.length === 0 && event.positions.length > 0 && (
            <p className='text-muted-foreground text-xs'>
              Hand positions {event.positions.join(', ')}. This log does not
              record which cards they were.
            </p>
          )}
          <div className='flex flex-wrap gap-1.5'>
            {event.cards.map((card, i) =>
              card.type === 'playing_card' ? (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
                  key={i}
                  title={`${card.value} of ${card.suit}`}
                >
                  <PlayingCardVisual
                    suit={card.suit}
                    value={card.value}
                    enhancement={tagValue(card.tags, 'e:')}
                    edition={tagValue(card.tags, 'ed:')}
                    seal={tagValue(card.tags, 's:')}
                  />
                </div>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
                <CardChip key={i} card={card} />
              )
            )}
          </div>
          {event.jokers.length > 0 && (
            <div>
              <p className='mb-1 text-muted-foreground text-xs'>Jokers</p>
              <div className='flex flex-wrap gap-x-3 gap-y-1'>
                {event.jokers.map((joker, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered, static
                  <CardChip key={i} card={joker} />
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
