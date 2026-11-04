'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { type ResolvedCard, tagValue } from '../../lib/card-ref'
import { PlayingCardVisual } from '../playing-card-visual'

type PlayingCard = Extract<ResolvedCard, { type: 'playing_card' }>

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

const ENHANCEMENT_NAMES: Record<string, string> = {
  m_bonus: 'Bonus Card',
  m_mult: 'Mult Card',
  m_wild: 'Wild Card',
  m_glass: 'Glass Card',
  m_steel: 'Steel Card',
  m_stone: 'Stone Card',
  m_gold: 'Gold Card',
  m_lucky: 'Lucky Card',
}

const EDITION_NAMES: Record<string, string> = {
  foil: 'Foil',
  holo: 'Holographic',
  polychrome: 'Polychrome',
  negative: 'Negative',
}

const SEAL_NAMES: Record<string, string> = {
  Gold: 'Gold Seal',
  Red: 'Red Seal',
  Blue: 'Blue Seal',
  Purple: 'Purple Seal',
}

interface DeckEntry {
  card: PlayingCard
  count: number
  enhancement: string | null
  edition: string | null
  seal: string | null
}

interface DeckSection {
  key: string
  label: string
  entries: DeckEntry[]
}

function describe(card: PlayingCard) {
  const enhancement = tagValue(card.tags, 'e:')
  return {
    enhancement,
    edition: tagValue(card.tags, 'ed:'),
    seal: tagValue(card.tags, 's:'),
    isStone: enhancement === 'm_stone',
  }
}

function rankIndex(value: string) {
  const i = RANK_ORDER.indexOf(value)
  return i === -1 ? RANK_ORDER.length : i
}

// One section per suit (highest rank first), identical cards collapsed into a
// single entry with a count, and Stone cards pulled out into their own section
// because they have no suit or rank.
function buildSections(cards: PlayingCard[]): DeckSection[] {
  const group = (list: PlayingCard[]): DeckEntry[] => {
    const entries = new Map<string, DeckEntry>()
    for (const card of [...list].sort(
      (a, b) => rankIndex(a.value) - rankIndex(b.value)
    )) {
      const d = describe(card)
      const key = `${card.suit}|${card.value}|${card.tags.join('|')}`
      const existing = entries.get(key)
      if (existing) existing.count++
      else entries.set(key, { card, count: 1, ...d })
    }
    return [...entries.values()]
  }

  const sections: DeckSection[] = []
  const known = [...SUIT_ORDER]
  for (const card of cards) {
    if (!known.includes(card.suit)) known.push(card.suit)
  }
  for (const suit of known) {
    const suitCards = cards.filter(
      (c) => c.suit === suit && !describe(c).isStone
    )
    if (suitCards.length > 0) {
      sections.push({ key: suit, label: suit, entries: group(suitCards) })
    }
  }
  const stones = cards.filter((c) => describe(c).isStone)
  if (stones.length > 0) {
    sections.push({ key: 'stone', label: 'Stone Cards', entries: group(stones) })
  }
  return sections
}

function summarize(cards: PlayingCard[]) {
  let enhancements = 0
  let editions = 0
  let seals = 0
  let modified = 0
  for (const card of cards) {
    const d = describe(card)
    if (d.enhancement) enhancements++
    if (d.edition) editions++
    if (d.seal) seals++
    if (d.enhancement || d.edition || d.seal) modified++
  }
  return { total: cards.length, modified, enhancements, editions, seals }
}

function cardName(entry: DeckEntry) {
  return entry.enhancement === 'm_stone'
    ? 'Stone Card'
    : `${entry.card.value} of ${entry.card.suit}`
}

function DeckCardEntry({ entry }: { entry: DeckEntry }) {
  const { card, count, enhancement, edition, seal } = entry
  const enhancementName =
    enhancement && enhancement !== 'm_stone'
      ? (ENHANCEMENT_NAMES[enhancement] ?? enhancement)
      : null
  const editionName = edition ? (EDITION_NAMES[edition] ?? edition) : null
  const sealName = seal ? (SEAL_NAMES[seal] ?? seal) : null
  return (
    <div className='flex w-[92px] flex-col items-center gap-2'>
      <div className='relative' title={cardName(entry)}>
        <PlayingCardVisual
          suit={card.suit}
          value={card.value}
          enhancement={enhancement}
          edition={edition}
          seal={seal}
        />
        {count > 1 && (
          <div className='pointer-events-none absolute top-0 right-0 z-10 rounded-tr-sm rounded-bl-md bg-black px-2 py-1 font-black text-[14px] text-white leading-none shadow-[0_2px_10px_rgba(0,0,0,0.55)]'>
            {count}
          </div>
        )}
      </div>
      <div className='space-y-1 text-center'>
        <p className='font-medium text-[11px] leading-tight'>
          {cardName(entry)}
        </p>
        <div className='flex flex-wrap justify-center gap-1'>
          {[enhancementName, sealName, editionName].map((name) =>
            name ? (
              <Badge
                key={name}
                variant='outline'
                className='px-1.5 py-0 text-[10px]'
              >
                {name}
              </Badge>
            ) : null
          )}
        </div>
      </div>
    </div>
  )
}

// The deck at the end of the run: a short summary and a "View deck" dialog
// that lays the cards out by suit, with counts for duplicates.
export function DeckPanel({
  cards,
  label,
}: {
  cards: ResolvedCard[]
  label?: ReactNode
}) {
  const playing = cards.filter(
    (c): c is PlayingCard => c.type === 'playing_card'
  )
  if (playing.length === 0) return null
  const summary = summarize(playing)
  const sections = buildSections(playing)
  const title = label ? <>{label} final deck</> : 'Final deck'

  return (
    <div className='space-y-1.5'>
      <p className='text-muted-foreground text-xs'>Final deck</p>
      <div className='flex flex-wrap items-center gap-1.5'>
        <Badge variant='outline'>{summary.total} cards</Badge>
        <Badge variant='outline'>{summary.modified} modified</Badge>
        {summary.enhancements > 0 && (
          <Badge variant='outline'>{summary.enhancements} enhanced</Badge>
        )}
        {summary.editions > 0 && (
          <Badge variant='outline'>{summary.editions} editions</Badge>
        )}
        {summary.seals > 0 && (
          <Badge variant='outline'>{summary.seals} seals</Badge>
        )}
        <Dialog>
          <DialogTrigger asChild>
            <Button size='sm' variant='outline' className='ml-auto'>
              View deck
            </Button>
          </DialogTrigger>
          <DialogContent className='dark max-h-[90vh] gap-3 overflow-hidden bg-[#3A5055] p-0 text-white sm:max-w-280'>
            <DialogHeader className='border-border/70 border-b px-6 pt-6 pb-4'>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {summary.total} cards, {summary.modified} modified,{' '}
                {summary.enhancements} enhancements, {summary.editions}{' '}
                editions, {summary.seals} seals.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className='max-h-[calc(90vh-7rem)] px-6 pb-6'>
              <div className='space-y-6 pr-3'>
                {sections.map((section) => (
                  <div key={section.key} className='space-y-3'>
                    <p className='font-semibold text-muted-foreground text-xs uppercase tracking-[0.18em]'>
                      {section.label}
                    </p>
                    <div className='flex flex-wrap gap-x-3 gap-y-5'>
                      {section.entries.map((entry) => (
                        <DeckCardEntry
                          key={`${entry.card.suit}|${entry.card.value}|${entry.card.tags.join('|')}`}
                          entry={entry}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
