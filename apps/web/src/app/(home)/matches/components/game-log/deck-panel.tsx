'use client'

import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { type ResolvedCard, tagValue } from '../../lib/card-ref'
import { PlayingCardVisual } from '../playing-card-visual'

const SUIT_ORDER = ['Spades', 'Hearts', 'Clubs', 'Diamonds']
const RANK_ORDER = [
  'Ace',
  'King',
  'Queen',
  'Jack',
  '10',
  '9',
  '8',
  '7',
  '6',
  '5',
  '4',
  '3',
  '2',
]

function sorted(cards: ResolvedCard[]): ResolvedCard[] {
  return [...cards].sort((a, b) => {
    if (a.type !== 'playing_card' || b.type !== 'playing_card') return 0
    return (
      SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) ||
      RANK_ORDER.indexOf(a.value) - RANK_ORDER.indexOf(b.value)
    )
  })
}

// The deck at the end of the run, sorted by suit then rank, in a dropdown so
// it does not take room while scrolling the log.
export function DeckPanel({ cards }: { cards: ResolvedCard[] }) {
  const [open, setOpen] = useState(false)
  if (cards.length === 0) return null
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className='flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground'>
        <ChevronRight
          className={cn('size-3.5 transition-transform', open && 'rotate-90')}
        />
        Final deck ({cards.length} cards)
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='mt-2 flex flex-wrap gap-1'>
          {sorted(cards).map((card, i) =>
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
            ) : null
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
