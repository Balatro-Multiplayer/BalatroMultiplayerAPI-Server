import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { vouchers } from '@/shared/vouchers'
import type { ResolvedCard } from '../lib/card-ref'
import { tagValue } from '../lib/card-ref'
import { jokerArt } from '../lib/joker-art'
import { jokerModifiers } from '../lib/joker-modifiers'
import { PlayingCardVisual } from './playing-card-visual'

// Turns a raw SMODS center key into a readable label when no art/name lookup
// covers it (tarots/planets/spectrals -- www doesn't have full art for these
// either, see its public/cards -- only a handful of MP-custom ones, e.g.
// c_asteroid). Not a real name lookup, just enough to be more readable than
// the bare key: "c_fool" -> "Fool", "c_mp_something" -> "Mp Something".
function prettifyKey(key: string): string {
  const pack = /^p_(\w+?)_(normal|jumbo|mega)_\d+$/.exec(key)
  if (pack) {
    const kind =
      (pack[1] ?? '').charAt(0).toUpperCase() + (pack[1] ?? '').slice(1)
    const size =
      pack[2] === 'normal'
        ? ''
        : `${pack[2]?.charAt(0).toUpperCase()}${pack[2]?.slice(1)} `
    return `${size}${kind} Pack`
  }
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
  if (kind === 'Joker' || kind === 'j') return jokerArt(ident)
  if (kind === 'Voucher') return vouchers[ident] ?? null
  return null
}

// An edition or sticker on a joker, as small labels (e.g. under its art).
function ModifierLabels({ tags }: { tags: string[] }) {
  const modifiers = jokerModifiers(tags)
  if (modifiers.length === 0) return null
  return (
    <span className='flex flex-wrap justify-center gap-0.5'>
      {modifiers.map((m) => (
        <Badge
          key={m.key}
          variant='outline'
          className='px-1 py-0 font-normal text-[10px] leading-tight'
        >
          {m.label}
        </Badge>
      ))}
    </span>
  )
}

// `artOnly` drops the name next to the art (the name and edition stay in the
// tooltip); used where a row of jokers should read as a lineup.
export function CardChip({
  card,
  artOnly = false,
}: {
  card: ResolvedCard
  artOnly?: boolean
}) {
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

  const isJokerCard = card.kind === 'Joker' || card.kind === 'j'

  if (known && artOnly) {
    return (
      <span className='inline-flex min-w-14 flex-col items-center gap-1'>
        <Image
          src={`/cards/${known.file}`}
          alt={known.name}
          title={edition ? `${known.name} (${edition})` : known.name}
          width={56}
          height={76}
          className='rounded-sm'
        />
        {isJokerCard && <ModifierLabels tags={card.tags} />}
      </span>
    )
  }

  if (known) {
    return (
      <span className='inline-flex items-start gap-1.5'>
        <Image
          src={`/cards/${known.file}`}
          alt={known.name}
          width={28}
          height={38}
          className='rounded-sm'
        />
        <span className='flex flex-col items-start gap-0.5'>
          <span className='text-xs'>{known.name}</span>
          {isJokerCard && <ModifierLabels tags={card.tags} />}
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
