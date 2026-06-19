export const RANK_IMAGES = {
  foil: '/ranks/foil.png',
  glass: '/ranks/glass2.png',
  gold: '/ranks/gold.png',
  holographic: '/ranks/holo.png',
  lucky: '/ranks/lucky.png',
  negative: '/ranks/negative.png',
  polychrome: '/ranks/poly.png',
  steel: '/ranks/steel.png',
  stone: '/ranks/stone.png',
  pebble: '/ranks/pebble.png',
  ferrite: '/ranks/ferrite.png',
  pyrite: '/ranks/pyrite.png',
  jade: '/ranks/jade.png',
  crystal: '/ranks/crystal.png',
  milk: '/ranks/milk.png',
  strawberry: '/ranks/strawberry.png',
  chocolate: '/ranks/chocolate.png',
  mint: '/ranks/mint.png',
  bubblegum: '/ranks/bubblegum.png',
}

export const EDITION_THRESHOLD = {
  FOIL: 50,
  HOLOGRAPHIC: 10,
  POLYCHROME: 3,
  NEGATIVE: 1,
  ANTIMATTER: 1,
}

export const ENHANCEMENT_THRESHOLD = {
  STEEL: 230,
  GOLD: 320,
  LUCKY: 460,
  GLASS: 620,
}

export const SMALLWORLD_THRESHOLD = {
  PEBBLE: 0,
  FERRITE: 225,
  PYRITE: 325,
  JADE: 425,
  CRYSTAL: 550,
}

export const LEGACY_THRESHOLD = {
  MILK: 0,
  STRAWBERRY: 225,
  CHOCOLATE: 325,
  MINT: 425,
  BUBBLEGUM: 550,
}

export const getRankData = (mmr: number, queueType?: string) => {
  if (queueType === 'vanilla') {
    return null
  }

  if (queueType === 'legacy') {
    let enhancement = RANK_IMAGES.milk
    let tooltip = 'Milk'
    if (mmr >= LEGACY_THRESHOLD.STRAWBERRY) {
      enhancement = RANK_IMAGES.strawberry
      tooltip = 'Strawberry'
    }
    if (mmr >= LEGACY_THRESHOLD.CHOCOLATE) {
      enhancement = RANK_IMAGES.chocolate
      tooltip = 'Chocolate'
    }
    if (mmr >= LEGACY_THRESHOLD.MINT) {
      enhancement = RANK_IMAGES.mint
      tooltip = 'Mint'
    }
    if (mmr >= LEGACY_THRESHOLD.BUBBLEGUM) {
      enhancement = RANK_IMAGES.bubblegum
      tooltip = 'Bubblegum'
    }
    return { enhancement, tooltip }
  }

  if (queueType === 'smallworld') {
    let enhancement = RANK_IMAGES.pebble
    let tooltip = 'Pebble'
    if (mmr >= SMALLWORLD_THRESHOLD.FERRITE) {
      enhancement = RANK_IMAGES.ferrite
      tooltip = 'Ferrite'
    }
    if (mmr >= SMALLWORLD_THRESHOLD.PYRITE) {
      enhancement = RANK_IMAGES.pyrite
      tooltip = 'Pyrite'
    }
    if (mmr >= SMALLWORLD_THRESHOLD.JADE) {
      enhancement = RANK_IMAGES.jade
      tooltip = 'Jade'
    }
    if (mmr >= SMALLWORLD_THRESHOLD.CRYSTAL) {
      enhancement = RANK_IMAGES.crystal
      tooltip = 'Crystal'
    }
    return { enhancement, tooltip }
  }

  let enhancement = RANK_IMAGES.stone
  let tooltip = 'Stone'
  if (mmr >= ENHANCEMENT_THRESHOLD.STEEL) {
    enhancement = RANK_IMAGES.steel
    tooltip = 'Steel'
  }
  if (mmr >= ENHANCEMENT_THRESHOLD.GOLD) {
    enhancement = RANK_IMAGES.gold
    tooltip = 'Gold'
  }
  if (mmr >= ENHANCEMENT_THRESHOLD.LUCKY) {
    enhancement = RANK_IMAGES.lucky
    tooltip = 'Lucky'
  }
  if (mmr >= ENHANCEMENT_THRESHOLD.GLASS) {
    enhancement = RANK_IMAGES.glass
    tooltip = 'Glass'
  }
  return { enhancement, tooltip }
}
