// A joker's edition and stickers, read from a card's tags.
//
// Tags follow card_ref's vocabulary: "ed:foil" for an edition and, for
// stickers, "st:eternal" (the bare words "eternal", "perishable", "rental"
// and "pinned" are accepted too).

export const STICKERS = ['eternal', 'perishable', 'rental', 'pinned'] as const

const STICKER_SET = new Set<string>(STICKERS)

const EDITION_NAMES: Record<string, string> = {
  foil: 'Foil',
  holo: 'Holographic',
  polychrome: 'Polychrome',
  negative: 'Negative',
}

const STICKER_NAMES: Record<string, string> = {
  eternal: 'Eternal',
  perishable: 'Perishable',
  rental: 'Rental',
  pinned: 'Pinned',
}

export function isStickerName(name: string): boolean {
  return STICKER_SET.has(name)
}

export interface JokerModifier {
  kind: 'edition' | 'sticker'
  key: string
  label: string
}

// Edition first, then stickers in the order they were recorded.
export function jokerModifiers(tags: readonly string[]): JokerModifier[] {
  const out: JokerModifier[] = []
  const edition = tags.find((t) => t.startsWith('ed:'))?.slice(3)
  if (edition) {
    out.push({
      kind: 'edition',
      key: edition,
      label: EDITION_NAMES[edition] ?? edition,
    })
  }
  for (const tag of tags) {
    const name = tag.startsWith('st:') ? tag.slice(3) : tag
    if (isStickerName(name) && !out.some((m) => m.key === name)) {
      out.push({
        kind: 'sticker',
        key: name,
        label: STICKER_NAMES[name] ?? name,
      })
    }
  }
  return out
}
