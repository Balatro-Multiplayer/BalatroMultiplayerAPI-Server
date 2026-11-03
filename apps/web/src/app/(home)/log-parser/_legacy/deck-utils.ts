export type DeckCardSnapshot = {
  code: string
  frontKey: string
  suit: 'H' | 'C' | 'D' | 'S'
  suitName: string
  rank: string
  rankName: string
  name: string
  enhancement: string | null
  enhancementName: string | null
  edition: string | null
  editionName: string | null
  seal: string | null
  sealName: string | null
}

const SUIT_NAMES = {
  H: 'Hearts',
  C: 'Clubs',
  D: 'Diamonds',
  S: 'Spades',
} as const

const RANK_NAMES = {
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  T: '10',
  J: 'Jack',
  Q: 'Queen',
  K: 'King',
  A: 'Ace',
} as const

const ENHANCEMENT_NAMES = {
  m_bonus: 'Bonus Card',
  m_mult: 'Mult Card',
  m_wild: 'Wild Card',
  m_glass: 'Glass Card',
  m_steel: 'Steel Card',
  m_stone: 'Stone Card',
  m_gold: 'Gold Card',
  m_lucky: 'Lucky Card',
} as const

const EDITION_NAMES = {
  foil: 'Foil',
  holo: 'Holographic',
  polychrome: 'Polychrome',
  negative: 'Negative',
} as const

const SEAL_NAMES = {
  Gold: 'Gold Seal',
  Red: 'Red Seal',
  Blue: 'Blue Seal',
  Purple: 'Purple Seal',
} as const

function cleanDeckToken(value: string) {
  return value
    .trim()
    .replace(/^(m_|e_)/, '')
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (token) => {
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
    })
}

function normalizeEnhancement(raw: string | undefined) {
  if (!raw || raw === 'none' || raw === 'c_base') {
    return {
      enhancement: null,
      enhancementName: null,
    }
  }

  return {
    enhancement: raw,
    enhancementName:
      ENHANCEMENT_NAMES[raw as keyof typeof ENHANCEMENT_NAMES] ??
      cleanDeckToken(raw),
  }
}

function normalizeEdition(raw: string | undefined) {
  if (!raw || raw === 'none' || raw === 'negative') {
    return {
      edition: null,
      editionName: null,
    }
  }

  return {
    edition: raw,
    editionName:
      EDITION_NAMES[raw as keyof typeof EDITION_NAMES] ?? cleanDeckToken(raw),
  }
}

function normalizeSeal(raw: string | undefined) {
  if (!raw || raw === 'none') {
    return {
      seal: null,
      sealName: null,
    }
  }

  return {
    seal: raw,
    sealName: SEAL_NAMES[raw as keyof typeof SEAL_NAMES] ?? cleanDeckToken(raw),
  }
}

export function parseDeckCardsFromString(rawDeck: string | null | undefined) {
  if (!rawDeck) {
    return [] satisfies DeckCardSnapshot[]
  }

  const cards: DeckCardSnapshot[] = []

  for (const rawCard of rawDeck.split(';')) {
    const card = rawCard.trim()
    if (!card) {
      continue
    }

    const [suit, rank, rawEnhancement, rawEdition, rawSeal] = card.split('-')
    if (!suit || !rank) {
      continue
    }

    const suitName = SUIT_NAMES[suit as keyof typeof SUIT_NAMES]
    const rankName = RANK_NAMES[rank as keyof typeof RANK_NAMES]
    if (!suitName || !rankName) {
      continue
    }

    const { enhancement, enhancementName } =
      normalizeEnhancement(rawEnhancement)
    const { edition, editionName } = normalizeEdition(rawEdition)
    const { seal, sealName } = normalizeSeal(rawSeal)

    cards.push({
      code: card,
      frontKey: `${suit}_${rank}`,
      suit: suit as DeckCardSnapshot['suit'],
      suitName,
      rank,
      rankName,
      name: `${rankName} of ${suitName}`,
      enhancement,
      enhancementName,
      edition,
      editionName,
      seal,
      sealName,
    })
  }

  return cards
}

export function normalizeDeckCards(
  cards: DeckCardSnapshot[] | null | undefined
) {
  return Array.isArray(cards) ? cards : []
}

export function summarizeDeck(cards: DeckCardSnapshot[] | null | undefined) {
  const normalizedCards = normalizeDeckCards(cards)
  let enhancements = 0
  let editions = 0
  let seals = 0

  for (const card of normalizedCards) {
    if (card.enhancement) {
      enhancements++
    }
    if (card.edition) {
      editions++
    }
    if (card.seal) {
      seals++
    }
  }

  return {
    total: normalizedCards.length,
    modified: normalizedCards.filter((card) => {
      return Boolean(card.enhancement || card.edition || card.seal)
    }).length,
    enhancements,
    editions,
    seals,
  }
}
