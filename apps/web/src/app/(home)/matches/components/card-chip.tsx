import Image from 'next/image'
import { jokers } from '@/shared/jokers'
import { vouchers } from '@/shared/vouchers'
import type { ResolvedCard } from '../lib/card-ref'
import { tagValue } from '../lib/card-ref'
import { PlayingCardVisual } from './playing-card-visual'

// Turns a raw SMODS center key into a readable label when no art/name lookup
// covers it (tarots/planets/spectrals -- www doesn't have full art for these
// either, see its public/cards -- only a handful of MP-custom ones, e.g.
// c_asteroid). Not a real name lookup, just enough to be more readable than
// the bare key: "c_fool" -> "Fool", "c_mp_something" -> "Mp Something".
function prettifyKey(key: string): string {
  return key
    .replace(/^[a-z]_/, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function lookupByKind(
  kind: string,
  ident: string
): { name: string; file: string } | null {
  if (kind === 'Joker' || kind === 'j') return jokers[ident] ?? null
  if (kind === 'Voucher') return vouchers[ident] ?? null
  return null
}

export function CardChip({ card }: { card: ResolvedCard }) {
  if (card.type === 'playing_card') {
    return (
      <span className='inline-flex items-center gap-1.5'>
        <PlayingCardVisual
          suit={card.suit}
          value={card.value}
          enhancement={tagValue(card.tags, 'e:')}
          edition={tagValue(card.tags, 'ed:')}
          seal={tagValue(card.tags, 's:')}
        />
        <span className='text-xs'>
          {card.value} of {card.suit}
        </span>
      </span>
    )
  }

  const known = lookupByKind(card.kind, card.ident)
  const edition = tagValue(card.tags, 'ed:')

  if (known) {
    return (
      <span className='inline-flex items-center gap-1.5'>
        <Image
          src={`/cards/${known.file}`}
          alt={known.name}
          width={28}
          height={38}
          className='rounded-sm'
        />
        <span className='text-xs'>
          {known.name}
          {edition && (
            <span className='text-muted-foreground'> ({edition})</span>
          )}
        </span>
      </span>
    )
  }

  // Tarot/Planet/Spectral (or an unrecognized Joker/Voucher key) -- no art
  // source, name-only.
  return (
    <span className='text-xs'>
      {prettifyKey(card.ident)}
      <span className='text-muted-foreground'> ({card.kind})</span>
    </span>
  )
}
