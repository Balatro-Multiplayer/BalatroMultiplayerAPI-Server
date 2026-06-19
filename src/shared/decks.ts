export const DECK_IMAGES: Record<string, string> = {
  red: '/decks/red.png',
  blue: '/decks/blue.png',
  yellow: '/decks/yellow.png',
  green: '/decks/green.png',
  black: '/decks/black.png',
  magic: '/decks/magic.png',
  nebula: '/decks/nebula.png',
  ghost: '/decks/ghost.png',
  abandoned: '/decks/abandoned.png',
  checkered: '/decks/checkered.png',
  zodiac: '/decks/zodiac.png',
  painted: '/decks/painted.png',
  anaglyph: '/decks/anaglyph.png',
  plasma: '/decks/plasma.png',
  erratic: '/decks/erratic.png',
  challenge: '/decks/challenge.png',
  heidelberg: '/decks/heidelberg.png',
  gradient: '/decks/gradient.png',
  white: '/decks/white.png',
  violet: '/decks/violet.png',
  sibyl: '/decks/sibyl.png',
  orange: '/decks/orange.png',
  oracle: '/decks/oracle.png',
  indigo: '/decks/indigo.png',
  cocktail: '/decks/cocktail.png',
  'specialty cocktails': '/decks/cocktail.png',
  unknown: '/decks/unknown.png',
}

export const DECK_INFO: Record<string, { name: string; description: string }> =
  {
    abandoned: {
      name: 'Abandoned Deck',
      description: 'Start run with no Face Cards in your deck',
    },
    anaglyph: {
      name: 'Anaglyph Deck',
      description: 'After defeating each Boss Blind, gain a Double Tag',
    },
    black: {
      name: 'Black Deck',
      description: '+1 Joker slot, -1 hand every round',
    },
    blue: {
      name: 'Blue Deck',
      description: '+1 hand every round',
    },
    challenge: {
      name: 'Challenge Deck',
      description: 'Challenge mode deck',
    },
    checkered: {
      name: 'Checkered Deck',
      description: 'Start run with 26 Spades and 26 Hearts in deck',
    },
    cocktail: {
      name: 'Cocktail Deck',
      description: 'Copies all effects of 3 other decks at random',
    },
    'specialty cocktails': {
      name: 'Specialty Cocktails',
      description: 'All custom Cocktail Deck variants combined',
    },
    'virtualized cocktail': {
      name: 'Virtualized Cocktail',
      description: 'Magic + Heidelberg + Zodiac',
    },
    "jake's cocktail": {
      name: "Jake's Cocktail",
      description: 'Indigo + Violet + Magic',
    },
    "fantom's cocktail": {
      name: "Fantom's Cocktail",
      description: 'Abandoned + Orange + Magic',
    },
    erratic: {
      name: 'Erratic Deck',
      description: 'All Ranks and Suits in deck are randomized',
    },
    ghost: {
      name: 'Ghost Deck',
      description:
        'Spectral cards may appear in the shop, start with a Hex card',
    },
    gradient: {
      name: 'Gradient Deck',
      description:
        'Cards are also considered one rank higher or lower for all Joker effects',
    },
    green: {
      name: 'Green Deck',
      description:
        'At end of each Round: earn money per remaining Hand and Discard',
    },
    heidelberg: {
      name: 'Heidelberg Deck',
      description:
        'Creates a Negative copy of 1 random consumable card at the end of the shop',
    },
    indigo: {
      name: 'Indigo Deck',
      description:
        'Choose +1 additional card from all Booster Packs. Booster Packs are unskippable',
    },
    magic: {
      name: 'Magic Deck',
      description:
        'Start run with the Crystal Ball voucher and 2 copies of The Fool',
    },
    nebula: {
      name: 'Nebula Deck',
      description: 'Start run with the Telescope voucher, -1 consumable slot',
    },
    orange: {
      name: 'Orange Deck',
      description:
        'Start run with a Giga Standard Pack, and 2 copies of The Hanged Man',
    },
    oracle: {
      name: 'Oracle Deck',
      description:
        'Start run with Medium and Clearance Sale. Balance capped at $50 + current interest cap',
    },
    painted: {
      name: 'Painted Deck',
      description: '+2 hand size, -1 Joker slot',
    },
    plasma: {
      name: 'Plasma Deck',
      description:
        'Balance Chips and Mult when calculating score for played hand. X2 base Blind size',
    },
    red: {
      name: 'Red Deck',
      description: '+1 discard every round',
    },
    violet: {
      name: 'Violet Deck',
      description:
        '+1 Voucher in shop. Vouchers are 50% off during Ante 1, and 30% off during Ante 2',
    },
    white: {
      name: 'White Deck',
      description:
        "View Nemesis' current deck and Joker setup (updates at PvP blind)",
    },
    yellow: {
      name: 'Yellow Deck',
      description: 'Start with extra $10',
    },
    zodiac: {
      name: 'Zodiac Deck',
      description:
        'Start run with Tarot Merchant, Planet Merchant, and Overstock vouchers',
    },
    sibyl: {
      name: 'Sibyl Deck',
      description: 'Sibyl deck',
    },
  }

function normalizeDeckKey(key: string) {
  return key.replace(/[\u2018\u2019]/g, "'")
}

export function isCocktailVariant(key: string) {
  return key.includes('cocktail') && key !== 'cocktail'
}

export function lookupDeckInfo(key: string) {
  return DECK_INFO[key] ?? DECK_INFO[normalizeDeckKey(key)]
}

export function getDeckDisplayName(key: string) {
  const info = lookupDeckInfo(key)
  if (info) return info.name
  if (isCocktailVariant(key)) {
    return key
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
  return key
}

export function getDeckDescription(key: string) {
  const info = lookupDeckInfo(key)
  if (info) return info.description
  if (isCocktailVariant(key)) return 'Custom Cocktail Deck variant'
  return ''
}

export function getDeckImage(key: string) {
  if (DECK_IMAGES[key]) return DECK_IMAGES[key]
  if (isCocktailVariant(key)) return DECK_IMAGES.cocktail
  return undefined
}
