import { gunzipSync } from 'node:zlib'
import {
  type DeckCardSnapshot,
  normalizeDeckCards,
  parseDeckCardsFromString,
} from '@/app/(home)/log-parser/deck-utils'
import { jokers } from '@/shared/jokers'

type LuaValue = string | number | boolean | null | LuaTable | LuaValue[]
type LuaTable = { [key: string]: LuaValue }

export type LogEvent = {
  timestamp: Date
  text: string
  type: 'event' | 'status' | 'system' | 'shop' | 'action' | 'error' | 'info'
  img?: string
}

export type GameOptions = {
  back?: string | null
  cocktail?: string | null
  custom_seed?: string | null
  ruleset?: string | null
  different_decks?: boolean | null
  different_seeds?: boolean | null
  death_on_round_loss?: boolean | null
  gold_on_life_loss?: boolean | null
  no_gold_on_round_loss?: boolean | null
  starting_lives?: number | null
  stake?: number | null
}

type PackedJokerCard = {
  save_fields?: {
    center?: string | null
  } | null
  edition?: ({ type?: string | null } & Record<string, unknown>) | null
  ability?: {
    eternal?: boolean | null
    perishable?: boolean | null
    rental?: boolean | null
  } | null
}

type ParsedSentPayload = Record<string, string | number | boolean | null>

type ParsedLobbyInfo = {
  timestamp: Date
  host: string | null
  guest: string | null
  hostHash: string[]
  guestHash: string[]
  isHost: boolean | null
}

type GameStartInfo = {
  lobbyInfo: ParsedLobbyInfo | null
  seed: string | null
}

export type HandScore = {
  timestamp: Date
  gainedScore: number
  totalScore: number
  handsLeft: number
  isLogOwner: boolean
}

export type PvpBlind = {
  blindNumber: number
  startTimestamp: Date
  endTimestamp?: Date
  logOwnerScore: number
  opponentScore: number
  handScores: HandScore[]
  winner: 'logOwner' | 'opponent' | null
}

export type ParsedLogGame = {
  id: number
  host: string | null
  guest: string | null
  lobbyCode: string | null
  logOwnerName: string | null
  opponentName: string | null
  hostMods: string[]
  guestMods: string[]
  isHost: boolean | null
  deck: string | null
  cocktailDecks: string[] | null
  seed: string | null
  options: GameOptions | null
  moneyGained: number
  moneySpent: number
  opponentMoneySpent: number
  startDate: Date
  endDate: Date | null
  durationSeconds: number | null
  opponentLastLives: number
  opponentLastSkips: number
  moneySpentPerShop: (number | null)[]
  moneySpentPerShopOpponent: (number | null)[]
  logOwnerFinalJokers: string[]
  opponentFinalJokers: string[]
  logOwnerDeck: DeckCardSnapshot[]
  opponentDeck: DeckCardSnapshot[]
  events: LogEvent[]
  rerolls: number
  rerollCostTotal: number
  logOwnerVouchers: string[]
  opponentRerolls: number
  opponentRerollCostTotal: number
  opponentVouchers: string[]
  winner: 'logOwner' | 'opponent' | null
  pvpBlinds: PvpBlind[]
  currentPvpBlind: number | null
}

class LuaParser {
  private pos = 0
  private input = ''
  private currentChar: string | null | undefined = null

  constructor(input: string) {
    this.input = input.trim()
    this.currentChar = this.input[0] ?? null
  }

  private advance(): void {
    this.pos++
    this.currentChar =
      this.pos < this.input.length ? this.input[this.pos] : null
  }

  private skipWhitespace(): void {
    while (
      this.currentChar?.match(/\s/) !== null &&
      this.currentChar !== null
    ) {
      this.advance()
    }
  }

  private parseString(): string {
    let result = ''
    const quote = this.currentChar
    this.advance()

    while (this.currentChar !== null && this.currentChar !== quote) {
      if (this.currentChar === '\\') {
        this.advance()
        const escapedChar = this.currentChar as string | null
        if (escapedChar === 'n') {
          result += '\n'
        } else if (escapedChar === 't') {
          result += '\t'
        } else if (escapedChar === 'r') {
          result += '\r'
        } else if (escapedChar === 'b') {
          result += '\b'
        } else if (escapedChar === 'f') {
          result += '\f'
        } else if (
          escapedChar === '"' ||
          escapedChar === "'" ||
          escapedChar === '\\'
        ) {
          result += escapedChar
        } else {
          throw new Error(`Invalid escape sequence: \\${escapedChar}`)
        }
      } else {
        result += this.currentChar
      }
      this.advance()
    }

    if (this.currentChar === null) {
      throw new Error('Unterminated string')
    }

    this.advance()
    return result
  }

  private parseNumber(): number {
    let result = ''

    if (this.currentChar === '-') {
      result += this.currentChar
      this.advance()
    }

    while (
      this.currentChar?.match(/[\d.]/) !== null &&
      this.currentChar !== null
    ) {
      result += this.currentChar
      this.advance()
    }

    const parsed = Number.parseFloat(result)
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid number: ${result}`)
    }

    return parsed
  }

  private parseIdentifier(): string {
    let result = ''

    while (
      this.currentChar?.match(/[a-zA-Z0-9_]/) !== null &&
      this.currentChar !== null
    ) {
      result += this.currentChar
      this.advance()
    }

    return result
  }

  private parseValue(): LuaValue {
    this.skipWhitespace()

    if (this.currentChar === null) {
      throw new Error('Unexpected end of input')
    }

    switch (this.currentChar) {
      case '{':
        return this.parseTable()
      case '"':
      case "'":
        return this.parseString()
      case '-':
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        return this.parseNumber()
      default: {
        const identifier = this.parseIdentifier()
        switch (identifier.toLowerCase()) {
          case 'true':
            return true
          case 'false':
            return false
          case 'nil':
            return null
          default:
            throw new Error(`Unexpected identifier: ${identifier}`)
        }
      }
    }
  }

  private parseTable(): LuaTable | LuaValue[] {
    this.advance()
    this.skipWhitespace()

    const result: LuaTable = {}
    const array: LuaValue[] = []
    let isArray = true
    let index = 0

    while (this.currentChar !== null && this.currentChar !== '}') {
      this.skipWhitespace()

      if (this.currentChar === '[') {
        isArray = false
        this.advance()
        const key = this.parseValue()
        if (typeof key !== 'string' && typeof key !== 'number') {
          throw new Error('Table key must be string or number')
        }
        this.skipWhitespace()

        const currentChar = this.currentChar as string | null
        if (currentChar !== ']') {
          throw new Error("Expected ']'")
        }
        this.advance()
        this.skipWhitespace()

        const equalsChar = this.currentChar as string | null
        if (equalsChar !== '=') {
          throw new Error("Expected '='")
        }
        this.advance()

        const value = this.parseValue()
        result[String(key)] = value
      } else {
        const value = this.parseValue()
        if (isArray) {
          array.push(value)
          index++
        } else {
          result[String(index)] = value
          index++
        }
      }

      this.skipWhitespace()
      if (this.currentChar === ',') {
        this.advance()
      } else if (this.currentChar !== '}') {
        throw new Error("Expected ',' or '}'")
      }
    }

    if (this.currentChar === null) {
      throw new Error('Unterminated table')
    }

    this.advance()
    return isArray ? array : result
  }

  parse(): LuaValue {
    const result = this.parseValue()
    this.skipWhitespace()

    if (this.currentChar !== null) {
      throw new Error('Unexpected characters after end of input')
    }

    return result
  }
}

const initGame = (id: number, startDate: Date): ParsedLogGame => ({
  id,
  host: null,
  guest: null,
  lobbyCode: null,
  logOwnerName: null,
  opponentName: null,
  hostMods: [],
  guestMods: [],
  isHost: null,
  deck: null,
  cocktailDecks: null,
  seed: null,
  options: null,
  moneyGained: 0,
  moneySpent: 0,
  opponentMoneySpent: 0,
  startDate,
  endDate: null,
  durationSeconds: null,
  opponentLastLives: 4,
  opponentLastSkips: 0,
  moneySpentPerShop: [],
  moneySpentPerShopOpponent: [],
  logOwnerFinalJokers: [],
  opponentFinalJokers: [],
  logOwnerDeck: [],
  opponentDeck: [],
  events: [],
  rerolls: 0,
  rerollCostTotal: 0,
  logOwnerVouchers: [],
  opponentRerolls: 0,
  opponentRerollCostTotal: 0,
  opponentVouchers: [],
  winner: null,
  pvpBlinds: [],
  currentPvpBlind: null,
})

function parseClientSentPayload(line: string): ParsedSentPayload | null {
  const marker = 'Client sent message:'
  const markerIndex = line.indexOf(marker)
  if (markerIndex === -1) {
    return null
  }

  const payload = line.slice(markerIndex + marker.length).trim()
  if (!payload) {
    return null
  }

  if (payload.startsWith('{') && payload.endsWith('}')) {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>
      const normalized: ParsedSentPayload = {}

      for (const [key, value] of Object.entries(parsed)) {
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          value === null
        ) {
          normalized[key] = value
        }
      }

      return normalized
    } catch {
      return null
    }
  }

  const parsedPayload: ParsedSentPayload = {}
  for (const match of payload.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*):([^,]*)/g)) {
    const key = match[1]?.trim()
    const rawValue = match[2]?.trim()
    if (!key || rawValue === undefined) {
      continue
    }

    if (rawValue.toLowerCase() === 'true') {
      parsedPayload[key] = true
      continue
    }

    if (rawValue.toLowerCase() === 'false') {
      parsedPayload[key] = false
      continue
    }

    if (/^-?\d+$/.test(rawValue)) {
      parsedPayload[key] = Number.parseInt(rawValue, 10)
      continue
    }

    parsedPayload[key] = rawValue
  }

  return Object.keys(parsedPayload).length > 0 ? parsedPayload : null
}

function getPayloadString(
  payload: ParsedSentPayload | null,
  key: string
): string | null {
  if (!payload || !(key in payload)) {
    return null
  }

  const value = payload[key]
  if (value === null || value === undefined) {
    return null
  }

  return String(value)
}

function getPayloadNumber(
  payload: ParsedSentPayload | null,
  key: string
): number | null {
  if (!payload || !(key in payload)) {
    return null
  }

  const value = payload[key]
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? null : parsed
  }

  return null
}

function normalizeLobbyCode(code: string | null | undefined): string | null {
  if (!code) {
    return null
  }

  const normalized = code
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toUpperCase()

  if (!/^[A-Z0-9]+$/.test(normalized)) {
    return null
  }

  return normalized
}

function extractLobbyCodeFromLine(
  line: string,
  payload: ParsedSentPayload | null
): string | null {
  const sentAction = getPayloadString(payload, 'action')

  if (sentAction === 'joinLobby') {
    return normalizeLobbyCode(getPayloadString(payload, 'code'))
  }

  if (line.includes('Client got joinedLobby message')) {
    return normalizeLobbyCode(line.match(/\(code:\s*([A-Za-z0-9]+)\)/)?.[1])
  }

  return null
}

function extractReceivedNemesisDeckString(line: string) {
  const match = line.match(
    /cards:\s*(.*?)(?=\)\s+\(action:\s*receiveNemesisDeck\)|\)$)/
  )
  const deck = match?.[1]?.trim().replace(/,+$/, '')
  return deck || null
}

function applyLobbyOption(
  options: GameOptions,
  rawKey: string,
  rawValue: string | number | boolean | null | undefined
) {
  if (rawValue === null || rawValue === undefined) {
    return
  }

  const trimmedKey = rawKey.trim().replace(/^['"]/, '').replace(/['"]$/, '')
  if (!trimmedKey) {
    return
  }

  const normalizedRaw =
    typeof rawValue === 'string'
      ? rawValue.trim().replace(/^['"]/, '').replace(/['"]$/, '')
      : rawValue

  const normalizedString =
    typeof normalizedRaw === 'string' ? normalizedRaw : String(normalizedRaw)

  switch (trimmedKey) {
    case 'back':
      options.back = normalizedString
      break
    case 'cocktail':
      options.cocktail = normalizedString
      break
    case 'custom_seed':
      options.custom_seed = normalizedString
      break
    case 'ruleset':
      options.ruleset = normalizedString
      break
    case 'different_decks':
    case 'different_seeds':
    case 'death_on_round_loss':
    case 'gold_on_life_loss':
    case 'no_gold_on_round_loss':
      if (typeof normalizedRaw === 'boolean') {
        options[trimmedKey] = normalizedRaw
      } else {
        options[trimmedKey] = normalizedString.toLowerCase() === 'true'
      }
      break
    case 'starting_lives':
    case 'stake': {
      const numValue =
        typeof normalizedRaw === 'number'
          ? normalizedRaw
          : Number.parseInt(normalizedString, 10)
      if (!Number.isNaN(numValue)) {
        options[trimmedKey] = numValue
      }
      break
    }
  }
}

function parseLobbyOptions(
  optionsInput: string | ParsedSentPayload
): GameOptions | null {
  const options: GameOptions = {}

  if (typeof optionsInput === 'string') {
    const trimmedInput = optionsInput.trim()

    if (trimmedInput.startsWith('{') && trimmedInput.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmedInput) as ParsedSentPayload
        for (const [key, value] of Object.entries(parsed)) {
          applyLobbyOption(options, key, value)
        }
      } catch {
        return null
      }
    } else {
      for (const param of trimmedInput.split(',')) {
        const separatorIndex = param.indexOf(':')
        if (separatorIndex === -1) {
          continue
        }

        const key = param.slice(0, separatorIndex)
        const value = param.slice(separatorIndex + 1)
        applyLobbyOption(options, key, value)
      }
    }
  } else {
    for (const [key, value] of Object.entries(optionsInput)) {
      applyLobbyOption(options, key, value)
    }
  }

  return Object.keys(options).length > 0 ? options : null
}

function formatLocation(locCode: string): string {
  if (locCode === 'loc_shop') {
    return 'Shop'
  }

  if (locCode === 'loc_playing-bl_mp_nemesis') {
    return 'PvP Blind'
  }

  if (locCode.startsWith('loc_playing-')) {
    const subcode = locCode.slice('loc_playing-'.length)
    if (subcode.startsWith('bl_')) {
      const blindName = subcode
        .slice(3)
        .replace(/_/g, ' ')
        .replace(/\w\S*/g, (token) => {
          return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
        })
      return `${blindName} Blind`
    }

    const readable = subcode.replace(/_/g, ' ').replace(/\w\S*/g, (token) => {
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
    })
    return `Playing ${readable}`
  }

  return locCode.replace(/_/g, ' ').replace(/\w\S*/g, (token) => {
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  })
}

function parseLobbyInfoLine(line: string): ParsedLobbyInfo | null {
  const timeMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)
  const timestamp = timeMatch?.[1] ? new Date(timeMatch[1]) : new Date()
  const hostMatch = line.match(/host: ([^ )]+)/)
  const guestMatch = line.match(/guest: ([^ )]+)/)
  const hostHashMatch = line.match(/hostHash: ([^)]+)/)
  const guestHashMatch = line.match(/guestHash: ([^)]+)/)
  const isHostMatch = line.match(/isHost: (true|false)/)

  const cleanHash = (hashStr: string | null | undefined) => {
    if (!hashStr) {
      return []
    }

    return hashStr
      .replace(/[()]/g, '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  return {
    timestamp,
    host: hostMatch?.[1] || null,
    guest: guestMatch?.[1] || null,
    hostHash: cleanHash(hostHashMatch?.[1]),
    guestHash: cleanHash(guestHashMatch?.[1]),
    isHost: isHostMatch ? isHostMatch[1] === 'true' : null,
  }
}

function extractGameStartInfo(lines: string[]): GameStartInfo[] {
  const gameInfos: GameStartInfo[] = []
  let latestLobbyInfo: ParsedLobbyInfo | null = null
  let nextGameSeed: string | null = null

  for (const line of lines) {
    if (!line) {
      continue
    }

    const lineLower = line.toLowerCase()

    if (line.includes('Client got lobbyInfo message')) {
      try {
        latestLobbyInfo = parseLobbyInfoLine(line)
      } catch {
        latestLobbyInfo = null
      }
    }

    if (lineLower.includes('startgame message')) {
      const seedMatch = line.match(/seed:\s*([^) ]+)/)
      const startGameSeed = seedMatch?.[1] || null
      gameInfos.push({
        lobbyInfo: latestLobbyInfo,
        seed: startGameSeed ?? nextGameSeed,
      })
      latestLobbyInfo = null
      nextGameSeed = null
    }
  }

  return gameInfos
}

function getPackedJokerEdition(
  edition: PackedJokerCard['edition']
): string | null {
  if (!edition || typeof edition !== 'object') {
    return null
  }

  if (typeof edition.type === 'string' && edition.type) {
    return edition.type
  }

  return (
    Object.entries(edition).find(
      ([key, value]) => key !== 'type' && value === true
    )?.[0] ?? null
  )
}

function serializePackedJoker(card: PackedJokerCard): string | null {
  const jokerKey = card.save_fields?.center?.trim()
  if (!jokerKey) {
    return null
  }

  const edition = getPackedJokerEdition(card.edition) ?? 'none'
  const modifier = card.ability?.eternal
    ? 'eternal'
    : card.ability?.perishable
      ? 'perishable'
      : 'none'
  const rental = card.ability?.rental ? 'rental' : 'none'

  return [jokerKey, edition, modifier, rental].join('-')
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

function convertLuaToJson(luaString: string): string {
  const parser = new LuaParser(luaString)
  return JSON.stringify(parser.parse(), null, 2)
}

async function luaTableToJson(luaString: string) {
  const str = luaString.replace(/^return\s*/, '')
  return convertLuaToJson(str)
}

async function decodePackedString(encodedString: string): Promise<JsonValue> {
  const compressed = Buffer.from(encodedString, 'base64')
  const decompressedString = gunzipSync(compressed).toString('utf8')

  if (/[^"'\w_]function[^"'\w_]/.test(decompressedString)) {
    throw new Error('Function keyword detected')
  }

  const jsonString = await luaTableToJson(decompressedString)
  return JSON.parse(jsonString) as JsonValue
}

async function parseJokersFromString(str: string) {
  try {
    if (str.startsWith('H4')) {
      const decoded = await decodePackedString(str)
      if (decoded && typeof decoded === 'object' && 'cards' in decoded) {
        const { cards } = decoded as {
          cards: Record<string, PackedJokerCard> | PackedJokerCard[]
        }
        return Object.values(cards)
          .map(serializePackedJoker)
          .filter((joker): joker is string => Boolean(joker))
      }
    }
  } catch {
    return []
  }

  return str.split(';').filter(Boolean)
}

function normalizeParsedGames(games: ParsedLogGame[]) {
  return games.map((game) => ({
    ...game,
    cocktailDecks: Array.isArray(game.cocktailDecks)
      ? game.cocktailDecks.filter((deck): deck is string => !!deck)
      : null,
    logOwnerDeck: normalizeDeckCards(game.logOwnerDeck),
    opponentDeck: normalizeDeckCards(game.opponentDeck),
  }))
}

export async function parseLogSource(content: string) {
  const logLines = content.split('\n')
  const games: ParsedLogGame[] = []
  let currentGame: ParsedLogGame | null = null
  let lastSeenLobbyOptions: GameOptions | null = null
  let pendingLobbyCode: string | null = null
  let lastAssignedLobbyCode: string | null = null
  let gameCounter = 0
  const gameStartInfos = extractGameStartInfo(logLines)
  let gameInfoIndex = 0

  for (const line of logLines) {
    if (!line.trim()) {
      continue
    }

    const timeMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)
    const timestamp = timeMatch?.[1] ? new Date(timeMatch[1]) : new Date()
    const lineLower = line.toLowerCase()
    const sentPayload = parseClientSentPayload(line)
    const sentAction = getPayloadString(sentPayload, 'action')
    const lobbyCode = extractLobbyCodeFromLine(line, sentPayload)

    if (lobbyCode) {
      pendingLobbyCode = lobbyCode
    }

    if (line.includes('Client got receiveEndGameJokers message')) {
      if (currentGame) {
        if (!currentGame.endDate) {
          currentGame.endDate = timestamp
        }

        const keysMatch = line.match(/\(keys: ([^)]+)\)/)
        if (keysMatch?.[1]) {
          currentGame.opponentFinalJokers = await parseJokersFromString(
            keysMatch[1]
          )
        }

        const seedMatch = line.match(/seed: ([A-Z0-9]+)/)
        if (!currentGame.seed && seedMatch?.[1]) {
          currentGame.seed = seedMatch[1]
        }
      }

      continue
    }

    if (line.includes('Client got receiveNemesisDeck message')) {
      if (currentGame) {
        currentGame.opponentDeck = parseDeckCardsFromString(
          extractReceivedNemesisDeckString(line)
        )
      }

      continue
    }

    if (line.includes('Client got nemesisEndGameStats message')) {
      if (currentGame) {
        const rerollCountMatch = line.match(/\(reroll_count: (\d+)\)/)
        if (rerollCountMatch?.[1]) {
          currentGame.opponentRerolls = Number.parseInt(rerollCountMatch[1], 10)
        }

        const rerollCostMatch = line.match(/\(reroll_cost_total: (\d+)\)/)
        if (rerollCostMatch?.[1]) {
          currentGame.opponentRerollCostTotal = Number.parseInt(
            rerollCostMatch[1],
            10
          )
        }

        const vouchersMatch = line.match(/\(vouchers: ([^)]+)\)/)
        if (vouchersMatch?.[1]) {
          currentGame.opponentVouchers = vouchersMatch[1].split('-')
        }
      }

      continue
    }

    if (sentAction === 'receiveEndGameJokers') {
      if (currentGame) {
        if (!currentGame.endDate) {
          currentGame.endDate = timestamp
        }

        const str = getPayloadString(sentPayload, 'keys')
        if (str) {
          currentGame.logOwnerFinalJokers = await parseJokersFromString(str)
        }
      }

      continue
    }

    if (sentAction === 'receiveNemesisDeck') {
      if (currentGame) {
        currentGame.logOwnerDeck = parseDeckCardsFromString(
          getPayloadString(sentPayload, 'cards')
        )
      }

      continue
    }

    if (sentAction === 'nemesisEndGameStats') {
      if (currentGame) {
        const rerollCount = getPayloadNumber(sentPayload, 'reroll_count')
        if (rerollCount !== null) {
          currentGame.rerolls = rerollCount
        }

        const rerollCostTotal = getPayloadNumber(
          sentPayload,
          'reroll_cost_total'
        )
        if (rerollCostTotal !== null) {
          currentGame.rerollCostTotal = rerollCostTotal
        }

        const vouchers = getPayloadString(sentPayload, 'vouchers')
        if (vouchers) {
          currentGame.logOwnerVouchers = vouchers.split('-')
        }
      }

      continue
    }

    if (lineLower.includes('startgame message')) {
      if (currentGame) {
        if (!currentGame.endDate) {
          currentGame.endDate = timestamp
        }

        currentGame.durationSeconds = currentGame.endDate
          ? (currentGame.endDate.getTime() - currentGame.startDate.getTime()) /
            1000
          : null
        games.push(currentGame)
      }

      gameCounter++
      currentGame = initGame(gameCounter, timestamp)
      const currentInfo = gameStartInfos[gameInfoIndex++] ?? {
        lobbyInfo: null,
        seed: null,
      }

      currentGame.host = currentInfo.lobbyInfo?.host ?? null
      currentGame.guest = currentInfo.lobbyInfo?.guest ?? null
      currentGame.hostMods = currentInfo.lobbyInfo?.hostHash ?? []
      currentGame.guestMods = currentInfo.lobbyInfo?.guestHash ?? []
      currentGame.isHost = currentInfo.lobbyInfo?.isHost ?? null
      currentGame.lobbyCode = pendingLobbyCode ?? lastAssignedLobbyCode

      if (currentGame.lobbyCode) {
        lastAssignedLobbyCode = currentGame.lobbyCode
      }

      pendingLobbyCode = null

      if (currentGame.isHost !== null) {
        if (currentGame.isHost) {
          currentGame.logOwnerName = currentGame.host
          currentGame.opponentName = currentGame.guest
        } else {
          currentGame.logOwnerName = currentGame.guest
          currentGame.opponentName = currentGame.host
        }
      }

      if (!currentGame.logOwnerName && currentGame.isHost !== null) {
        currentGame.logOwnerName = currentGame.isHost ? 'Host' : 'Guest'
      }

      if (!currentGame.opponentName && currentGame.isHost !== null) {
        currentGame.opponentName = currentGame.isHost ? 'Guest' : 'Host'
      }

      currentGame.options = lastSeenLobbyOptions
      currentGame.deck = lastSeenLobbyOptions?.back ?? null
      currentGame.seed = currentInfo.seed ?? null
      if (currentGame.options?.starting_lives) {
        currentGame.opponentLastLives = currentGame.options.starting_lives
      }

      currentGame.events.push({
        timestamp,
        text: `Game ${gameCounter} Started`,
        type: 'system',
      })
      continue
    }

    if (line.includes('Client got receiveEndGameJokers')) {
      if (currentGame && !currentGame.endDate) {
        currentGame.endDate = timestamp
        const seedMatch = line.match(/seed: ([A-Z0-9]+)/)
        if (!currentGame.seed && seedMatch?.[1]) {
          currentGame.seed = seedMatch[1]
        }
      }

      continue
    }

    if (lineLower.includes('lobbyoptions')) {
      const parsedSentOptions =
        sentAction === 'lobbyOptions' && sentPayload
          ? parseLobbyOptions(sentPayload)
          : null
      const optionsStr = parsedSentOptions
        ? null
        : line.includes('Client got lobbyOptions message:  ')
          ? line
              .split(' Client got lobbyOptions message:  ')[1]
              ?.trim()
              ?.replaceAll('(', '')
              ?.replaceAll(')', ',')
          : line.split(' Client sent message:')[1]?.trim()
      const parsedOptions = parsedSentOptions
        ? parsedSentOptions
        : optionsStr
          ? parseLobbyOptions(optionsStr)
          : null

      if (parsedOptions) {
        lastSeenLobbyOptions = parsedOptions
        if (currentGame && !currentGame.options) {
          currentGame.options = lastSeenLobbyOptions
          currentGame.deck = lastSeenLobbyOptions.back ?? currentGame.deck
          if (lastSeenLobbyOptions.starting_lives) {
            currentGame.opponentLastLives = lastSeenLobbyOptions.starting_lives
          }
        }
      }

      continue
    }

    if (!currentGame) {
      continue
    }

    if (lineLower.includes('enemyinfo')) {
      const livesMatch = line.match(/lives: *(\d+)/)
      if (livesMatch?.[1]) {
        const newLives = Number.parseInt(livesMatch[1], 10)
        if (
          !Number.isNaN(newLives) &&
          newLives < currentGame.opponentLastLives
        ) {
          currentGame.events.push({
            timestamp,
            text: `Opponent lost a life (${currentGame.opponentLastLives} -> ${newLives})`,
            type: 'event',
          })
        }
        currentGame.opponentLastLives = newLives
      }

      const skipsMatch = line.match(/skips: *(\d+)/)
      if (skipsMatch?.[1]) {
        const newSkips = Number.parseInt(skipsMatch[1], 10)
        if (
          !Number.isNaN(newSkips) &&
          newSkips > currentGame.opponentLastSkips
        ) {
          const numSkipsOccurred = newSkips - currentGame.opponentLastSkips
          for (let index = 0; index < numSkipsOccurred; index++) {
            currentGame.moneySpentPerShopOpponent.push(null)
          }
          currentGame.events.push({
            timestamp,
            text: `Opponent skipped ${numSkipsOccurred} shop${numSkipsOccurred > 1 ? 's' : ''} (Total: ${newSkips})`,
            type: 'shop',
          })
          currentGame.opponentLastSkips = newSkips
        } else if (!Number.isNaN(newSkips)) {
          currentGame.opponentLastSkips = newSkips
        }
      }

      if (currentGame.currentPvpBlind !== null) {
        const scoreMatch = line.match(/score: *(\d+)/)
        const handsLeftMatch = line.match(/handsLeft: *(\d+)/)

        if (scoreMatch?.[1]) {
          const totalScore = Number.parseInt(scoreMatch[1], 10)
          const handsLeft = handsLeftMatch?.[1]
            ? Number.parseInt(handsLeftMatch[1], 10)
            : 0

          if (!Number.isNaN(totalScore)) {
            const currentBlindIndex = currentGame.currentPvpBlind - 1
            if (
              currentBlindIndex >= 0 &&
              currentBlindIndex < currentGame.pvpBlinds.length
            ) {
              const currentBlind = currentGame.pvpBlinds[currentBlindIndex]
              if (!currentBlind) {
                continue
              }

              const gainedScore = totalScore - currentBlind.opponentScore
              currentBlind.opponentScore = totalScore
              currentBlind.handScores.push({
                timestamp,
                gainedScore,
                totalScore,
                handsLeft,
                isLogOwner: false,
              })

              if (gainedScore > 0) {
                currentGame.events.push({
                  timestamp,
                  text: `Opponent scored: ${gainedScore} (Total: ${totalScore}, hands left: ${handsLeft})`,
                  type: 'event',
                })
              }
            }
          }
        }
      }

      continue
    }

    if (sentAction === 'soldCard') {
      const card = getPayloadString(sentPayload, 'card')
      if (card) {
        currentGame.events.push({
          timestamp,
          text: `Sold ${card}`,
          type: 'shop',
        })
      }
      continue
    }

    if (line.includes('Client got soldJoker message:  (action: soldJoker)')) {
      currentGame.events.push({
        timestamp,
        text: 'Opponent sold a joker',
        type: 'shop',
      })
    }

    if (line.includes(' Client got spentLastShop message')) {
      const match = line.match(/amount: (\d+)/)
      if (match?.[1]) {
        const amount = Number.parseInt(match[1], 10)
        if (!Number.isNaN(amount)) {
          currentGame.opponentMoneySpent += amount
          currentGame.moneySpentPerShopOpponent.push(amount)
          currentGame.events.push({
            timestamp,
            text: `Opponent spent $${amount} in shop`,
            type: 'shop',
          })
        }
      }
      continue
    }

    if (sentAction === 'spentLastShop') {
      const amount = getPayloadNumber(sentPayload, 'amount')
      if (amount !== null) {
        currentGame.moneySpentPerShop.push(amount)
        currentGame.events.push({
          timestamp,
          text: `Reported spending $${amount} last shop`,
          type: 'shop',
        })
      }
      continue
    }

    if (sentAction === 'skip') {
      currentGame.moneySpentPerShop.push(null)
      currentGame.events.push({
        timestamp,
        text: 'Skipped shop',
        type: 'shop',
      })
      continue
    }

    if (line.includes('Client got winGame message:  (action: winGame)')) {
      currentGame.winner = 'logOwner'
      currentGame.events.push({
        timestamp,
        text: 'You won the game!',
        type: 'system',
      })
      continue
    }

    if (line.includes('Client got loseGame message:  (action: loseGame)')) {
      currentGame.winner = 'opponent'
      currentGame.events.push({
        timestamp,
        text: 'You lost the game.',
        type: 'system',
      })
      continue
    }

    if (
      line.includes('Client got disconnected message:  (action: disconnected)')
    ) {
      currentGame.events.push({
        timestamp,
        text: 'Log owner disconnected',
        type: 'system',
      })
      continue
    }

    if (line.includes('Resetting game states')) {
      if (
        !currentGame.endDate &&
        timestamp.getTime() !== currentGame.startDate.getTime()
      ) {
        currentGame.endDate = timestamp
      }
      continue
    }

    if (line.includes('Client got endPvP message')) {
      if (currentGame.currentPvpBlind !== null) {
        const lostMatch = line.match(/lost: (true|false)/)
        if (lostMatch?.[1]) {
          const lost = lostMatch[1].toLowerCase() === 'true'
          const currentBlindIndex = currentGame.currentPvpBlind - 1

          if (
            currentBlindIndex >= 0 &&
            currentBlindIndex < currentGame.pvpBlinds.length
          ) {
            const currentBlind = currentGame.pvpBlinds[currentBlindIndex]
            if (!currentBlind) {
              continue
            }

            currentBlind.winner = lost ? 'opponent' : 'logOwner'
            currentBlind.endTimestamp = timestamp

            currentGame.events.push({
              timestamp,
              text: `Ended Blind #${currentBlind.blindNumber} - ${lost ? 'You lost' : 'You won'} (Your score: ${currentBlind.logOwnerScore}, Opponent score: ${currentBlind.opponentScore})`,
              type: 'event',
            })

            currentGame.currentPvpBlind = null
          }
        }
      }
      continue
    }

    if (lineLower.includes('client sent')) {
      if (sentAction === 'moneyMoved') {
        const amount = getPayloadNumber(sentPayload, 'amount')
        if (amount !== null) {
          if (amount >= 0) {
            currentGame.moneyGained += amount
            currentGame.events.push({
              timestamp,
              text: `Gained $${amount}`,
              type: 'event',
            })
          } else {
            const spent = Math.abs(amount)
            currentGame.moneySpent += spent
            currentGame.events.push({
              timestamp,
              text: `Spent $${spent}`,
              type: 'event',
            })
          }
        }
      } else if (sentAction === 'boughtCardFromShop') {
        const cardRaw = getPayloadString(sentPayload, 'card') ?? 'Unknown Card'
        const cardClean = cardRaw.replace(/^(c_mp_|j_mp_)/, '')
        const cost = getPayloadNumber(sentPayload, 'cost') ?? 0
        currentGame.events.push({
          timestamp,
          img: jokers[cardRaw]?.file,
          text: `Bought ${cardClean}${cost > 0 ? ` for $${cost}` : ''}`,
          type: 'shop',
        })
      } else if (sentAction === 'rerollShop') {
        const cost = getPayloadNumber(sentPayload, 'cost')
        if (cost !== null) {
          currentGame.events.push({
            timestamp,
            text: `Rerolled shop for $${cost}`,
            type: 'shop',
          })
        }
        currentGame.rerolls++
      } else if (sentAction === 'usedCard') {
        const raw = getPayloadString(sentPayload, 'card')
        if (raw) {
          const clean = raw
            .replace(/^(c_mp_|j_mp_)/, '')
            .replace(/_/g, ' ')
            .replace(/\w\S*/g, (token) => {
              return (
                token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
              )
            })
          currentGame.events.push({
            timestamp,
            text: `Used ${clean}`,
            type: 'action',
          })
        }
      } else if (sentAction === 'playHand') {
        if (currentGame.currentPvpBlind !== null) {
          const totalScore = getPayloadNumber(sentPayload, 'score')
          const handsLeft = getPayloadNumber(sentPayload, 'handsLeft') ?? 0

          if (totalScore !== null) {
            const currentBlindIndex = currentGame.currentPvpBlind - 1
            if (
              currentBlindIndex >= 0 &&
              currentBlindIndex < currentGame.pvpBlinds.length
            ) {
              const currentBlind = currentGame.pvpBlinds[currentBlindIndex]
              if (!currentBlind) {
                continue
              }

              const gainedScore = totalScore - currentBlind.logOwnerScore
              currentBlind.logOwnerScore = totalScore
              currentBlind.handScores.push({
                timestamp,
                gainedScore,
                totalScore,
                handsLeft,
                isLogOwner: true,
              })

              if (gainedScore > 0) {
                currentGame.events.push({
                  timestamp,
                  text: `You scored: ${gainedScore} (Total: ${totalScore}, hands left: ${handsLeft})`,
                  type: 'event',
                })
              }
            }
          }
        }
      } else if (sentAction === 'setLocation') {
        const locCode = getPayloadString(sentPayload, 'location')
        if (locCode && locCode !== 'loc_selecting') {
          currentGame.events.push({
            timestamp,
            text: `Moved to ${formatLocation(locCode)}`,
            type: 'status',
          })

          if (locCode.startsWith('loc_playing-bl_')) {
            const blindNumber = currentGame.pvpBlinds.length + 1
            currentGame.pvpBlinds.push({
              blindNumber,
              startTimestamp: timestamp,
              logOwnerScore: 0,
              opponentScore: 0,
              handScores: [],
              winner: null,
            })
            currentGame.currentPvpBlind = blindNumber
            currentGame.events.push({
              timestamp,
              text: `Started ${formatLocation(locCode)} (Blind #${blindNumber})`,
              type: 'event',
            })
          }
        }
      }
    }
  }

  if (currentGame) {
    if (currentGame.endDate) {
      currentGame.durationSeconds =
        (currentGame.endDate.getTime() - currentGame.startDate.getTime()) / 1000
      games.push(currentGame)
    }
  }

  return normalizeParsedGames(games)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (typeof value === 'boolean') {
    return true
  }

  if (value instanceof Date) {
    return !Number.isNaN(value.getTime())
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (isPlainObject(value)) {
    return Object.keys(value).length > 0
  }

  return true
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function pickDefined<T>(nextValue: T, prevValue: T): T {
  return isMeaningfulValue(nextValue)
    ? cloneValue(nextValue)
    : cloneValue(prevValue)
}

function chooseArray<T>(existingValue: unknown, nextValue: unknown): T[] {
  const existingArray = Array.isArray(existingValue)
    ? cloneValue(existingValue as T[])
    : []
  const nextArray = Array.isArray(nextValue) ? cloneValue(nextValue as T[]) : []

  if (nextArray.length > 0 || existingArray.length === 0) {
    return nextArray
  }

  return existingArray
}

function mergeUniquePrimitiveArray(
  existingValue: unknown,
  nextValue: unknown
): string[] {
  const merged: string[] = []
  const seen = new Set<string>()

  for (const value of [
    ...(Array.isArray(existingValue) ? existingValue : []),
    ...(Array.isArray(nextValue) ? nextValue : []),
  ]) {
    if (typeof value !== 'string') {
      continue
    }

    const normalized = value.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    merged.push(value)
  }

  return merged
}

function mergeNullableNumberArray(
  existingValue: unknown,
  nextValue: unknown
): (number | null)[] {
  const existingArray = Array.isArray(existingValue) ? existingValue : []
  const nextArray = Array.isArray(nextValue) ? nextValue : []
  const length = Math.max(existingArray.length, nextArray.length)
  const merged: (number | null)[] = []

  for (let index = 0; index < length; index++) {
    const nextEntry = nextArray[index]
    const existingEntry = existingArray[index]

    if (typeof nextEntry === 'number' && Number.isFinite(nextEntry)) {
      merged.push(nextEntry)
      continue
    }

    if (nextEntry === null && existingEntry === undefined) {
      merged.push(null)
      continue
    }

    if (typeof existingEntry === 'number' && Number.isFinite(existingEntry)) {
      merged.push(existingEntry)
      continue
    }

    if (existingEntry === null || nextEntry === null) {
      merged.push(null)
    }
  }

  return merged
}

function mergeDeckCards(
  existingValue: unknown,
  nextValue: unknown
): DeckCardSnapshot[] {
  return normalizeDeckCards(
    chooseArray<DeckCardSnapshot>(existingValue, nextValue)
  )
}

function mergeEventArray(
  existingValue: unknown,
  nextValue: unknown
): LogEvent[] {
  const existingArray = Array.isArray(existingValue) ? existingValue : []
  const nextArray = Array.isArray(nextValue) ? nextValue : []
  const merged: LogEvent[] = []
  const seen = new Set<string>()

  for (const event of [...existingArray, ...nextArray]) {
    if (!isPlainObject(event)) {
      continue
    }

    const key = JSON.stringify(event)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push(event as LogEvent)
  }

  merged.sort((left, right) => {
    const leftTime = new Date(left.timestamp).getTime()
    const rightTime = new Date(right.timestamp).getTime()
    return leftTime - rightTime
  })

  return merged
}

function mergeHandScores(
  existingValue: unknown,
  nextValue: unknown
): HandScore[] {
  const existingArray = Array.isArray(existingValue) ? existingValue : []
  const nextArray = Array.isArray(nextValue) ? nextValue : []
  const merged: HandScore[] = []
  const seen = new Set<string>()

  for (const score of [...existingArray, ...nextArray]) {
    if (!isPlainObject(score)) {
      continue
    }

    const key = JSON.stringify(score)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push(score as HandScore)
  }

  merged.sort((left, right) => {
    const leftTime = new Date(left.timestamp).getTime()
    const rightTime = new Date(right.timestamp).getTime()
    return leftTime - rightTime
  })

  return merged
}

function mergePvpBlinds(
  existingValue: unknown,
  nextValue: unknown
): PvpBlind[] {
  const existingArray = Array.isArray(existingValue) ? existingValue : []
  const nextArray = Array.isArray(nextValue) ? nextValue : []
  const byBlindNumber = new Map<number, PvpBlind>()

  for (const blind of existingArray) {
    if (!isPlainObject(blind) || typeof blind.blindNumber !== 'number') {
      continue
    }

    byBlindNumber.set(blind.blindNumber, cloneValue(blind as PvpBlind))
  }

  for (const blind of nextArray) {
    if (!isPlainObject(blind) || typeof blind.blindNumber !== 'number') {
      continue
    }

    const existingBlind = byBlindNumber.get(blind.blindNumber)
    const nextBlind = blind as PvpBlind
    byBlindNumber.set(blind.blindNumber, {
      ...(existingBlind ?? {}),
      ...(nextBlind ?? {}),
      blindNumber: blind.blindNumber,
      startTimestamp: pickDefined(
        nextBlind.startTimestamp,
        existingBlind?.startTimestamp ?? nextBlind.startTimestamp
      ),
      endTimestamp: pickDefined(
        nextBlind.endTimestamp,
        existingBlind?.endTimestamp
      ),
      logOwnerScore:
        typeof nextBlind.logOwnerScore === 'number'
          ? nextBlind.logOwnerScore
          : (existingBlind?.logOwnerScore ?? 0),
      opponentScore:
        typeof nextBlind.opponentScore === 'number'
          ? nextBlind.opponentScore
          : (existingBlind?.opponentScore ?? 0),
      handScores: mergeHandScores(
        existingBlind?.handScores,
        nextBlind.handScores
      ),
      winner:
        nextBlind.winner === 'logOwner' || nextBlind.winner === 'opponent'
          ? nextBlind.winner
          : (existingBlind?.winner ?? null),
    })
  }

  return [...byBlindNumber.values()].sort(
    (left, right) => left.blindNumber - right.blindNumber
  )
}

function mergeOptions(
  existingValue: unknown,
  nextValue: unknown
): GameOptions | null {
  const existingOptions = isPlainObject(existingValue)
    ? (existingValue as GameOptions)
    : null
  const nextOptions = isPlainObject(nextValue)
    ? (nextValue as GameOptions)
    : null

  if (!existingOptions && !nextOptions) {
    return null
  }

  return {
    ...existingOptions,
    ...nextOptions,
    back: pickDefined(nextOptions?.back, existingOptions?.back),
    cocktail: pickDefined(nextOptions?.cocktail, existingOptions?.cocktail),
    custom_seed: pickDefined(
      nextOptions?.custom_seed,
      existingOptions?.custom_seed
    ),
    ruleset: pickDefined(nextOptions?.ruleset, existingOptions?.ruleset),
    different_decks: pickDefined(
      nextOptions?.different_decks,
      existingOptions?.different_decks
    ),
    different_seeds: pickDefined(
      nextOptions?.different_seeds,
      existingOptions?.different_seeds
    ),
    death_on_round_loss: pickDefined(
      nextOptions?.death_on_round_loss,
      existingOptions?.death_on_round_loss
    ),
    gold_on_life_loss: pickDefined(
      nextOptions?.gold_on_life_loss,
      existingOptions?.gold_on_life_loss
    ),
    no_gold_on_round_loss: pickDefined(
      nextOptions?.no_gold_on_round_loss,
      existingOptions?.no_gold_on_round_loss
    ),
    starting_lives: pickDefined(
      nextOptions?.starting_lives,
      existingOptions?.starting_lives
    ),
    stake: pickDefined(nextOptions?.stake, existingOptions?.stake),
  }
}

function mergeGameLike(
  existingValue: unknown,
  nextValue: unknown,
  index: number
): unknown {
  if (!isPlainObject(existingValue)) {
    if (isPlainObject(nextValue)) {
      return cloneValue(nextValue)
    }

    return nextValue ?? existingValue
  }

  if (!isPlainObject(nextValue)) {
    return cloneValue(existingValue)
  }

  const existingGame = existingValue as ParsedLogGame
  const nextGame = nextValue as ParsedLogGame
  const merged: Record<string, unknown> = cloneValue(existingGame)

  for (const [key, value] of Object.entries(nextGame)) {
    if (!(key in merged) || isMeaningfulValue(value)) {
      merged[key] = cloneValue(value)
    }
  }

  merged.id =
    typeof nextGame.id === 'number'
      ? nextGame.id
      : (existingGame.id ?? index + 1)
  merged.host = pickDefined(nextGame.host, existingGame.host)
  merged.guest = pickDefined(nextGame.guest, existingGame.guest)
  merged.lobbyCode = pickDefined(nextGame.lobbyCode, existingGame.lobbyCode)
  merged.logOwnerName = pickDefined(
    nextGame.logOwnerName,
    existingGame.logOwnerName
  )
  merged.opponentName = pickDefined(
    nextGame.opponentName,
    existingGame.opponentName
  )
  merged.hostMods = mergeUniquePrimitiveArray(
    existingGame.hostMods,
    nextGame.hostMods
  )
  merged.guestMods = mergeUniquePrimitiveArray(
    existingGame.guestMods,
    nextGame.guestMods
  )
  merged.isHost = pickDefined(nextGame.isHost, existingGame.isHost)
  merged.deck = pickDefined(nextGame.deck, existingGame.deck)
  merged.seed = pickDefined(nextGame.seed, existingGame.seed)
  merged.options = mergeOptions(existingGame.options, nextGame.options)
  merged.moneyGained =
    typeof nextGame.moneyGained === 'number'
      ? nextGame.moneyGained
      : existingGame.moneyGained
  merged.moneySpent =
    typeof nextGame.moneySpent === 'number'
      ? nextGame.moneySpent
      : existingGame.moneySpent
  merged.opponentMoneySpent =
    typeof nextGame.opponentMoneySpent === 'number'
      ? nextGame.opponentMoneySpent
      : existingGame.opponentMoneySpent
  merged.startDate = pickDefined(nextGame.startDate, existingGame.startDate)
  merged.endDate = pickDefined(nextGame.endDate, existingGame.endDate)
  merged.durationSeconds = pickDefined(
    nextGame.durationSeconds,
    existingGame.durationSeconds
  )
  merged.opponentLastLives =
    typeof nextGame.opponentLastLives === 'number'
      ? nextGame.opponentLastLives
      : existingGame.opponentLastLives
  merged.opponentLastSkips =
    typeof nextGame.opponentLastSkips === 'number'
      ? nextGame.opponentLastSkips
      : existingGame.opponentLastSkips
  merged.moneySpentPerShop = mergeNullableNumberArray(
    existingGame.moneySpentPerShop,
    nextGame.moneySpentPerShop
  )
  merged.moneySpentPerShopOpponent = mergeNullableNumberArray(
    existingGame.moneySpentPerShopOpponent,
    nextGame.moneySpentPerShopOpponent
  )
  merged.logOwnerFinalJokers = chooseArray<string>(
    existingGame.logOwnerFinalJokers,
    nextGame.logOwnerFinalJokers
  )
  merged.opponentFinalJokers = chooseArray<string>(
    existingGame.opponentFinalJokers,
    nextGame.opponentFinalJokers
  )
  merged.logOwnerDeck = mergeDeckCards(
    existingGame.logOwnerDeck,
    nextGame.logOwnerDeck
  )
  merged.opponentDeck = mergeDeckCards(
    existingGame.opponentDeck,
    nextGame.opponentDeck
  )
  merged.events = mergeEventArray(existingGame.events, nextGame.events)
  merged.rerolls =
    typeof nextGame.rerolls === 'number'
      ? nextGame.rerolls
      : existingGame.rerolls
  merged.rerollCostTotal =
    typeof nextGame.rerollCostTotal === 'number'
      ? nextGame.rerollCostTotal
      : existingGame.rerollCostTotal
  merged.logOwnerVouchers = chooseArray<string>(
    existingGame.logOwnerVouchers,
    nextGame.logOwnerVouchers
  )
  merged.opponentRerolls =
    typeof nextGame.opponentRerolls === 'number'
      ? nextGame.opponentRerolls
      : existingGame.opponentRerolls
  merged.opponentRerollCostTotal =
    typeof nextGame.opponentRerollCostTotal === 'number'
      ? nextGame.opponentRerollCostTotal
      : existingGame.opponentRerollCostTotal
  merged.opponentVouchers = chooseArray<string>(
    existingGame.opponentVouchers,
    nextGame.opponentVouchers
  )
  merged.winner =
    nextGame.winner === 'logOwner' || nextGame.winner === 'opponent'
      ? nextGame.winner
      : existingGame.winner
  merged.pvpBlinds = mergePvpBlinds(existingGame.pvpBlinds, nextGame.pvpBlinds)
  merged.currentPvpBlind = pickDefined(
    nextGame.currentPvpBlind,
    existingGame.currentPvpBlind
  )

  return merged
}

export function mergeParsedGames(existingValue: unknown, nextValue: unknown) {
  const existingGames = Array.isArray(existingValue) ? existingValue : []
  const nextGames = Array.isArray(nextValue) ? nextValue : []

  if (existingGames.length === 0) {
    return cloneValue(nextGames)
  }

  if (nextGames.length === 0) {
    return cloneValue(existingGames)
  }

  const length = Math.max(existingGames.length, nextGames.length)
  const merged: unknown[] = []

  for (let index = 0; index < length; index++) {
    const existingGame = existingGames[index]
    const nextGame = nextGames[index]

    if (existingGame === undefined) {
      merged.push(cloneValue(nextGame))
      continue
    }

    if (nextGame === undefined) {
      merged.push(cloneValue(existingGame))
      continue
    }

    merged.push(mergeGameLike(existingGame, nextGame, index))
  }

  return merged
}
