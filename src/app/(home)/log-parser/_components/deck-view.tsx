'use client'

import type { CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  type DeckCardSnapshot,
  normalizeDeckCards,
  summarizeDeck,
} from '../deck-utils'

const CARD_WIDTH = 71
const CARD_HEIGHT = 95

const SUIT_ROW = {
  H: 0,
  C: 1,
  D: 2,
  S: 3,
} as const

const RANK_COLUMN = {
  '2': 0,
  '3': 1,
  '4': 2,
  '5': 3,
  '6': 4,
  '7': 5,
  '8': 6,
  '9': 7,
  T: 8,
  J: 9,
  Q: 10,
  K: 11,
  A: 12,
} as const

const ENHANCEMENT_POSITION = {
  base: { x: 1, y: 0 },
  m_bonus: { x: 1, y: 1 },
  m_mult: { x: 2, y: 1 },
  m_wild: { x: 3, y: 1 },
  m_lucky: { x: 4, y: 1 },
  m_glass: { x: 5, y: 1 },
  m_steel: { x: 6, y: 1 },
  m_stone: { x: 5, y: 0 },
  m_gold: { x: 6, y: 0 },
} as const

const SEAL_POSITION = {
  Gold: { x: 2, y: 0 },
  Purple: { x: 4, y: 4 },
  Red: { x: 5, y: 4 },
  Blue: { x: 6, y: 4 },
} as const

const EDITION_POSITION = {
  foil: { x: 1, y: 0 },
  holo: { x: 2, y: 0 },
  polychrome: { x: 3, y: 0 },
} as const

const SUIT_ORDER = ['S', 'H', 'C', 'D'] as const

const RANK_SORT_VALUE = {
  A: 12,
  K: 11,
  Q: 10,
  J: 9,
  T: 8,
  '9': 7,
  '8': 6,
  '7': 5,
  '6': 4,
  '5': 3,
  '4': 2,
  '3': 1,
  '2': 0,
} as const

function spriteOffset(x: number, y: number) {
  return `-${x * CARD_WIDTH}px -${y * CARD_HEIGHT}px`
}

function compareDeckCards(a: DeckCardSnapshot, b: DeckCardSnapshot) {
  const rankDiff =
    (RANK_SORT_VALUE[b.rank as keyof typeof RANK_SORT_VALUE] ?? -1) -
    (RANK_SORT_VALUE[a.rank as keyof typeof RANK_SORT_VALUE] ?? -1)

  if (rankDiff !== 0) {
    return rankDiff
  }

  const suitDiff = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit)

  if (suitDiff !== 0) {
    return suitDiff
  }

  return a.code.localeCompare(b.code)
}

type DeckSection = {
  key: string
  label: string
  cards: Array<{
    card: DeckCardSnapshot
    count: number
  }>
}

function getSortedDeckSections(cards: DeckCardSnapshot[]) {
  const suitSections: DeckSection[] = SUIT_ORDER.flatMap((suit) => {
    const suitCards = [...cards]
      .filter((card) => card.enhancement !== 'm_stone' && card.suit === suit)
      .sort(compareDeckCards)

    if (suitCards.length === 0) {
      return []
    }

    const groupedCards = new Map<
      string,
      { card: DeckCardSnapshot; count: number }
    >()

    for (const card of suitCards) {
      const existing = groupedCards.get(card.code)
      if (existing) {
        existing.count++
        continue
      }

      groupedCards.set(card.code, { card, count: 1 })
    }

    return [
      {
        key: suit,
        label: suitCards[0]?.suitName ?? suit,
        cards: Array.from(groupedCards.values()),
      },
    ]
  })

  const stoneCards = [...cards]
    .filter((card) => card.enhancement === 'm_stone')
    .sort(compareDeckCards)

  if (stoneCards.length > 0) {
    const groupedStoneCards = new Map<
      string,
      { card: DeckCardSnapshot; count: number }
    >()

    for (const card of stoneCards) {
      const existing = groupedStoneCards.get(card.code)
      if (existing) {
        existing.count++
        continue
      }

      groupedStoneCards.set(card.code, { card, count: 1 })
    }

    suitSections.push({
      key: 'stone',
      label: 'Stone Cards',
      cards: Array.from(groupedStoneCards.values()),
    })
  }

  return suitSections
}

function getCardFaceStyle(card: DeckCardSnapshot): CSSProperties {
  const frontX = RANK_COLUMN[card.rank as keyof typeof RANK_COLUMN]
  const frontY = SUIT_ROW[card.suit]
  const enhancementPos = card.enhancement
    ? (ENHANCEMENT_POSITION[
        card.enhancement as keyof typeof ENHANCEMENT_POSITION
      ] ?? ENHANCEMENT_POSITION.base)
    : ENHANCEMENT_POSITION.base

  const layers = [`url('/atlases/Jokers.png')`]
  const positions = ['0px -855px']

  if (card.edition && card.edition in EDITION_POSITION) {
    const editionPos =
      EDITION_POSITION[card.edition as keyof typeof EDITION_POSITION]
    layers.push(`url('/atlases/Editions.png')`)
    positions.push(spriteOffset(editionPos.x, editionPos.y))
  }

  if (card.enhancement === 'm_stone') {
    layers.push(`url('/atlases/Enhancers.png')`)
    positions.push(spriteOffset(enhancementPos.x, enhancementPos.y))
  } else {
    layers.push(`url('/atlases/8BitDeck.png')`)
    positions.push(spriteOffset(frontX, frontY))
    layers.push(`url('/atlases/Enhancers.png')`)
    positions.push(spriteOffset(enhancementPos.x, enhancementPos.y))
  }

  return {
    backgroundImage: layers.join(', '),
    backgroundPosition: positions.join(', '),
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
    backgroundBlendMode:
      card.edition === 'polychrome' ? 'normal, color' : undefined,
  }
}

function DeckCardVisual({
  card,
  count,
}: {
  card: DeckCardSnapshot
  count: number
}) {
  const sealPos = card.seal
    ? (SEAL_POSITION[card.seal as keyof typeof SEAL_POSITION] ?? null)
    : null

  return (
    <div className='flex w-[92px] flex-col items-center gap-2'>
      <div className='relative'>
        <div
          className={cn(
            'relative h-[95px] w-[71px] overflow-hidden rounded-[0.45rem] shadow-[0_10px_18px_-12px_rgba(0,0,0,0.95)] transition-transform duration-150'
          )}
          style={getCardFaceStyle(card)}
          title={card.name}
        />
        {count > 1 && (
          <div className='pointer-events-none absolute top-0 right-0 z-10 rounded-tr-[0.45rem] rounded-bl-md bg-black px-2 py-1 font-black text-[14px] text-white leading-none shadow-[0_2px_10px_rgba(0,0,0,0.55)] dark:bg-white dark:text-black'>
            {count}
          </div>
        )}
        {sealPos && (
          <div
            className='pointer-events-none absolute inset-0 h-[95px] w-[71px]'
            style={{
              backgroundImage: `url('/atlases/Enhancers.png')`,
              backgroundPosition: spriteOffset(sealPos.x, sealPos.y),
              backgroundRepeat: 'no-repeat',
              imageRendering: 'pixelated',
            }}
          />
        )}
      </div>
      <div className='space-y-1 text-center'>
        <p className='font-medium text-[11px] leading-tight'>{card.name}</p>
        <div className='flex flex-wrap justify-center gap-1'>
          {card.enhancementName && (
            <Badge variant='outline' className='px-1.5 py-0 text-[10px]'>
              {card.enhancementName}
            </Badge>
          )}
          {card.sealName && (
            <Badge variant='outline' className='px-1.5 py-0 text-[10px]'>
              {card.sealName}
            </Badge>
          )}
          {card.editionName && card.edition !== 'negative' && (
            <Badge variant='outline' className='px-1.5 py-0 text-[10px]'>
              {card.editionName}
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}

function DeckDialog({
  label,
  cards,
}: {
  label: string
  cards: DeckCardSnapshot[] | null | undefined
}) {
  const normalizedCards = normalizeDeckCards(cards)
  const summary = summarizeDeck(normalizedCards)
  const sections = getSortedDeckSections(normalizedCards)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size='sm'
          variant='outline'
          disabled={summary.total === 0}
          className='w-full sm:w-auto'
        >
          View deck
        </Button>
      </DialogTrigger>
      <DialogContent className='dark max-h-[90vh] gap-3 overflow-hidden bg-[#3A5055] p-0 text-white sm:max-w-280'>
        <DialogHeader className='border-border/70 border-b px-6 pt-6 pb-4'>
          <DialogTitle>{label} deck</DialogTitle>
          <DialogDescription>
            {summary.total} cards, {summary.modified} modified,{' '}
            {summary.enhancements} enhancements, {summary.editions} editions,{' '}
            {summary.seals} seals.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className='max-h-[calc(90vh-7rem)] px-6 pb-6'>
          <div className='space-y-6 pr-3'>
            {sections.map((section) => {
              return (
                <div key={`${label}-${section.key}`} className='space-y-3'>
                  <p className='font-semibold text-muted-foreground text-xs uppercase tracking-[0.18em]'>
                    {section.label}
                  </p>
                  <div className='flex flex-wrap gap-x-3 gap-y-5'>
                    {section.cards.map(({ card, count }, index) => {
                      return (
                        <DeckCardVisual
                          key={`${label}-${section.key}-${card.code}-${index}`}
                          card={card}
                          count={count}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function DeckSummaryPanel({
  label,
  cards,
  won,
}: {
  label: string
  cards: DeckCardSnapshot[] | null | undefined
  won: boolean
}) {
  const normalizedCards = normalizeDeckCards(cards)
  const summary = summarizeDeck(normalizedCards)

  return (
    <div className='rounded-xl border border-border/70 bg-muted/20 p-4'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div className='space-y-2'>
          <div className='flex items-center gap-2'>
            <p className='font-semibold text-sm'>{label}</p>
            {won && <Badge className='text-[10px] uppercase'>Winner</Badge>}
          </div>
          {summary.total > 0 ? (
            <div className='flex flex-wrap gap-1.5'>
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
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              No deck snapshot in this log.
            </p>
          )}
        </div>
        <DeckDialog label={label} cards={normalizedCards} />
      </div>
    </div>
  )
}

export function DeckViewsCard({
  logOwnerDeck,
  opponentDeck,
  ownerLabel,
  opponentLabel,
  winner,
}: {
  logOwnerDeck: DeckCardSnapshot[] | null | undefined
  opponentDeck: DeckCardSnapshot[] | null | undefined
  ownerLabel: string
  opponentLabel: string
  winner: 'logOwner' | 'opponent' | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-lg'>Deck Snapshots</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <DeckSummaryPanel
          label={ownerLabel}
          cards={logOwnerDeck}
          won={winner === 'logOwner'}
        />
        <DeckSummaryPanel
          label={opponentLabel}
          cards={opponentDeck}
          won={winner === 'opponent'}
        />
      </CardContent>
    </Card>
  )
}
