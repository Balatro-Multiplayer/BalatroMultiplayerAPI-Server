import type { CSSProperties } from 'react'

// Ported from www's deck-view.tsx (src/app/(home)/log-parser/_components/deck-view.tsx):
// CSS multi-background-position compositing over the same three atlases
// (public/atlases/8BitDeck.png, Editions.png, Enhancers.png), already present
// in this app's public/ directory. Adapted only to this app's suit/value
// strings, which are the full Balatro/SMODS words RLOG.card_ref emits
// ("Hearts"/"Ace") rather than www's single-char log format ("H"/"A") --
// and to reading enhancement/edition/seal off card_ref's own tag vocabulary
// ("e:m_glass", "ed:foil", "s:Gold"), which already reuses Balatro/SMODS'
// native key names, so no separate translation table is needed for those.

const CARD_WIDTH = 71
const CARD_HEIGHT = 95

const SUIT_ROW: Record<string, number> = {
  Hearts: 0,
  Clubs: 1,
  Diamonds: 2,
  Spades: 3,
}

const VALUE_COLUMN: Record<string, number> = {
  '2': 0,
  '3': 1,
  '4': 2,
  '5': 3,
  '6': 4,
  '7': 5,
  '8': 6,
  '9': 7,
  '10': 8,
  Jack: 9,
  Queen: 10,
  King: 11,
  Ace: 12,
}

const ENHANCEMENT_POSITION: Record<string, { x: number; y: number }> = {
  m_bonus: { x: 1, y: 1 },
  m_mult: { x: 2, y: 1 },
  m_wild: { x: 3, y: 1 },
  m_lucky: { x: 4, y: 1 },
  m_glass: { x: 5, y: 1 },
  m_steel: { x: 6, y: 1 },
  m_stone: { x: 5, y: 0 },
  m_gold: { x: 6, y: 0 },
}

const SEAL_POSITION: Record<string, { x: number; y: number }> = {
  Gold: { x: 2, y: 0 },
  Purple: { x: 4, y: 4 },
  Red: { x: 5, y: 4 },
  Blue: { x: 6, y: 4 },
}

const EDITION_POSITION: Record<string, { x: number; y: number }> = {
  foil: { x: 1, y: 0 },
  holo: { x: 2, y: 0 },
  polychrome: { x: 3, y: 0 },
}

function spriteOffset(x: number, y: number) {
  return `-${x * CARD_WIDTH}px -${y * CARD_HEIGHT}px`
}

export interface PlayingCardVisualProps {
  suit: string
  value: string
  enhancement?: string | null
  edition?: string | null
  seal?: string | null
}

export function PlayingCardVisual({
  suit,
  value,
  enhancement,
  edition,
  seal,
}: PlayingCardVisualProps) {
  const suitRow = SUIT_ROW[suit]
  const valueColumn = VALUE_COLUMN[value]
  const isStone = enhancement === 'm_stone'

  const layers: string[] = []
  const positions: string[] = []

  const editionPos = edition ? EDITION_POSITION[edition] : undefined
  if (editionPos) {
    layers.push("url('/atlases/Editions.png')")
    positions.push(spriteOffset(editionPos.x, editionPos.y))
  }

  const stonePos = ENHANCEMENT_POSITION.m_stone
  if (isStone && stonePos) {
    layers.push("url('/atlases/Enhancers.png')")
    positions.push(spriteOffset(stonePos.x, stonePos.y))
  } else if (suitRow !== undefined && valueColumn !== undefined) {
    layers.push("url('/atlases/8BitDeck.png')")
    positions.push(spriteOffset(valueColumn, suitRow))
    const enhancementPos = enhancement ? ENHANCEMENT_POSITION[enhancement] : undefined
    if (enhancementPos) {
      layers.push("url('/atlases/Enhancers.png')")
      positions.push(spriteOffset(enhancementPos.x, enhancementPos.y))
    }
  }

  const style: CSSProperties = {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundImage: layers.join(', '),
    backgroundPosition: positions.join(', '),
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
    backgroundBlendMode: edition === 'polychrome' ? 'normal, color' : undefined,
  }

  const sealPos = seal && seal in SEAL_POSITION ? SEAL_POSITION[seal] : null

  return (
    <div className='relative overflow-hidden rounded-sm' style={style}>
      {sealPos && (
        <div
          className='absolute inset-0'
          style={{
            backgroundImage: "url('/atlases/Enhancers.png')",
            backgroundPosition: spriteOffset(sealPos.x, sealPos.y),
            backgroundRepeat: 'no-repeat',
            imageRendering: 'pixelated',
          }}
        />
      )}
    </div>
  )
}
