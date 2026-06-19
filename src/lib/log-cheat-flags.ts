type ParsedEventLike = {
  text?: unknown
  type?: unknown
}

type ParsedGameLike = {
  deck?: unknown
  events?: unknown
  gameIndex?: unknown
  logOwnerName?: unknown
  moneySpentPerShop?: unknown
  moneySpentPerShopOpponent?: unknown
  options?: unknown
  opponentName?: unknown
  ruleset?: unknown
  startDate?: unknown
}

type GameOptionsLike = {
  ruleset?: unknown
  stake?: unknown
}

type FlagRole = 'logOwner' | 'opponent'

type CheatFlagBase = {
  deck: string
  gameIndex: number
  gameMode: string
  stake: string
  startDate: string | null
}

export type FirstShopOverspendFlag = CheatFlagBase & {
  type: 'first_shop_overspend'
  threshold: number
  offenders: Array<{
    amount: number
    playerName: string
    role: FlagRole
  }>
}

export type FirstRoundOverearnFlag = CheatFlagBase & {
  type: 'first_round_overearn'
  actualEarned: number
  actualMoney: number
  blindName: 'Small Blind' | 'Big Blind' | 'Boss Blind'
  expectedEarned: number
  expectedMoney: number
  playerName: string
}

export type CheatFlag = FirstShopOverspendFlag | FirstRoundOverearnFlag

const DEFAULT_THRESHOLD = 20
const YELLOW_DECK_THRESHOLD = 30
const DEFAULT_STARTING_HANDS = 4
const DEFAULT_STARTING_MONEY = 4
const YELLOW_DECK_STARTING_MONEY = 14

const STAKE_NAMES = {
  1: 'White Stake',
  2: 'Red Stake',
  3: 'Green Stake',
  4: 'Black Stake',
  5: 'Blue Stake',
  6: 'Purple Stake',
  7: 'Orange Stake',
  8: 'Gold Stake',
} as const

function normalizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function normalizeInteger(value: unknown) {
  const normalized = normalizeNumber(value)
  if (normalized === null) {
    return null
  }

  return Math.trunc(normalized)
}

function normalizeDeck(value: unknown) {
  const deck = normalizeString(value)
  if (!deck) {
    return 'Unknown'
  }

  return deck.replace(/deck$/i, '').trim() || deck
}

function normalizeGameMode(value: unknown) {
  const mode = normalizeString(value)
  return mode ?? 'Unknown'
}

function normalizeSpend(value: unknown) {
  return normalizeNumber(value)
}

function normalizeStake(value: unknown) {
  const stake = normalizeInteger(value)
  if (stake === null) {
    return 'Unknown Stake'
  }

  return STAKE_NAMES[stake as keyof typeof STAKE_NAMES] ?? `Stake ${stake}`
}

function normalizeStartDate(value: unknown) {
  const startDate =
    typeof value === 'string'
      ? new Date(value)
      : value instanceof Date
        ? value
        : null

  return startDate && !Number.isNaN(startDate.getTime())
    ? startDate.toISOString()
    : null
}

function isYellowDeck(deck: string) {
  return deck.trim().toLowerCase() === 'yellow'
}

function isBlueDeck(deck: string) {
  return deck.trim().toLowerCase() === 'blue'
}

function isBlackDeck(deck: string) {
  return deck.trim().toLowerCase() === 'black'
}

function isGreenDeck(deck: string) {
  return deck.trim().toLowerCase() === 'green'
}

function isOrangeDeck(deck: string) {
  return deck.trim().toLowerCase() === 'orange'
}

function getStartingMoney(deck: string) {
  return isYellowDeck(deck)
    ? YELLOW_DECK_STARTING_MONEY
    : DEFAULT_STARTING_MONEY
}

function getStartingHands(deck: string) {
  if (isBlackDeck(deck)) {
    return DEFAULT_STARTING_HANDS - 1
  }

  if (isBlueDeck(deck)) {
    return DEFAULT_STARTING_HANDS + 1
  }

  return DEFAULT_STARTING_HANDS
}

function getInterestForFirstBlind(deck: string) {
  if (isGreenDeck(deck)) {
    return 0
  }

  return isYellowDeck(deck) ? 2 : 0
}

function getMoneyPerRemainingHand(deck: string) {
  return isGreenDeck(deck) ? 2 : 1
}

function getStartingDiscards(stake: string) {
  return ['Blue Stake', 'Purple Stake', 'Orange Stake', 'Gold Stake'].includes(
    stake
  )
    ? 2
    : 3
}

function getMoneyPerRemainingDiscard(deck: string) {
  return isGreenDeck(deck) ? 1 : 0
}

function getBlindReward(blindName: string | null, stake: string) {
  if (blindName === 'Small Blind') {
    return stake === 'White Stake' ? 3 : 0
  }

  if (blindName === 'Big Blind') {
    return 4
  }

  if (blindName === 'Boss Blind') {
    return 5
  }

  return null
}

function normalizeEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as ParsedEventLike[]
  }

  return value.filter((event) => {
    return Boolean(event) && typeof event === 'object'
  }) as ParsedEventLike[]
}

function getFirstBlindName(events: ParsedEventLike[]) {
  for (const event of events) {
    const text = normalizeString(event.text)
    const blindName = text?.match(/^Started (.+) \(Blind #1\)$/)?.[1]
    if (
      blindName === 'Small Blind' ||
      blindName === 'Big Blind' ||
      blindName === 'Boss Blind'
    ) {
      return blindName
    }
  }

  return null
}

function getEarnedBeforeFirstShop(events: ParsedEventLike[]) {
  let total = 0

  for (const event of events) {
    const text = normalizeString(event.text)
    if (!text) {
      continue
    }

    if (text === 'Moved to Shop' || event.type === 'shop') {
      break
    }

    const amount = text.match(/^Gained \$(\d+(?:\.\d+)?)$/)?.[1]
    if (!amount) {
      continue
    }

    total += Number(amount)
  }

  return total
}

function detectFirstRoundOverearnFlag(
  parsedGame: ParsedGameLike,
  index: number,
  deck: string,
  stake: string,
  gameMode: string,
  startDate: string | null
) {
  const events = normalizeEvents(parsedGame.events)
  const blindName = getFirstBlindName(events)
  const blindReward = getBlindReward(blindName, stake)

  if (!blindName || blindReward === null) {
    return null
  }

  const handsLeftReward =
    Math.max(0, getStartingHands(deck) - 1) * getMoneyPerRemainingHand(deck)
  const discardsLeftReward =
    getStartingDiscards(stake) * getMoneyPerRemainingDiscard(deck)
  const orangeDeckBuffer = isOrangeDeck(deck) ? 3 : 0
  const expectedEarned =
    blindReward +
    getInterestForFirstBlind(deck) +
    handsLeftReward +
    discardsLeftReward +
    orangeDeckBuffer
  const actualEarned = getEarnedBeforeFirstShop(events)

  if (actualEarned <= expectedEarned) {
    return null
  }

  const playerName =
    normalizeString(parsedGame.logOwnerName) ?? 'Unknown player'
  const startingMoney = getStartingMoney(deck)

  return {
    type: 'first_round_overearn' as const,
    gameIndex:
      typeof parsedGame.gameIndex === 'number' &&
      Number.isInteger(parsedGame.gameIndex)
        ? parsedGame.gameIndex
        : index,
    deck,
    stake,
    blindName,
    gameMode,
    expectedEarned,
    actualEarned,
    expectedMoney: startingMoney + expectedEarned,
    actualMoney: startingMoney + actualEarned,
    playerName,
    startDate,
  }
}

function detectFirstShopOverspendFlag(
  parsedGame: ParsedGameLike,
  index: number,
  deck: string,
  stake: string,
  gameMode: string,
  startDate: string | null
) {
  const threshold = isYellowDeck(deck)
    ? YELLOW_DECK_THRESHOLD
    : DEFAULT_THRESHOLD
  const logOwnerSpend = Array.isArray(parsedGame.moneySpentPerShop)
    ? normalizeSpend(parsedGame.moneySpentPerShop[0])
    : null
  const opponentSpend = Array.isArray(parsedGame.moneySpentPerShopOpponent)
    ? normalizeSpend(parsedGame.moneySpentPerShopOpponent[0])
    : null

  const offenders = [
    logOwnerSpend !== null && logOwnerSpend > threshold
      ? {
          playerName:
            normalizeString(parsedGame.logOwnerName) ?? 'Unknown player',
          amount: logOwnerSpend,
          role: 'logOwner' as const,
        }
      : null,
    opponentSpend !== null && opponentSpend > threshold
      ? {
          playerName:
            normalizeString(parsedGame.opponentName) ?? 'Unknown player',
          amount: opponentSpend,
          role: 'opponent' as const,
        }
      : null,
  ].filter((value) => value !== null)

  if (offenders.length === 0) {
    return null
  }

  return {
    type: 'first_shop_overspend' as const,
    gameIndex:
      typeof parsedGame.gameIndex === 'number' &&
      Number.isInteger(parsedGame.gameIndex)
        ? parsedGame.gameIndex
        : index,
    deck,
    stake,
    gameMode,
    threshold,
    offenders,
    startDate,
  }
}

export function detectCheatFlags(parsedGames: unknown) {
  if (!Array.isArray(parsedGames)) {
    return [] as CheatFlag[]
  }

  return parsedGames.flatMap((game, index) => {
    if (!game || typeof game !== 'object') {
      return []
    }

    const parsedGame = game as ParsedGameLike
    const options =
      parsedGame.options && typeof parsedGame.options === 'object'
        ? (parsedGame.options as GameOptionsLike)
        : null
    const deck = normalizeDeck(parsedGame.deck)
    const stake = normalizeStake(options?.stake)
    const gameMode = normalizeGameMode(parsedGame.ruleset ?? options?.ruleset)
    const startDate = normalizeStartDate(parsedGame.startDate)

    const flags = [
      detectFirstShopOverspendFlag(
        parsedGame,
        index,
        deck,
        stake,
        gameMode,
        startDate
      ),
      detectFirstRoundOverearnFlag(
        parsedGame,
        index,
        deck,
        stake,
        gameMode,
        startDate
      ),
    ].filter((flag) => flag !== null)

    return flags
  })
}
