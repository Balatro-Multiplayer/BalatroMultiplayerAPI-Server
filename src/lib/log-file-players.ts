import type { InsertGame } from '@/server/db/types'

type ParsedGameLike = {
  deck?: unknown
  durationSeconds?: unknown
  endDate?: unknown
  guest?: unknown
  guestEncryptId?: unknown
  host?: unknown
  hostEncryptId?: unknown
  guestMods?: unknown
  hostMods?: unknown
  isHost?: unknown
  lobbyCode?: unknown
  logOwnerFinalJokers?: unknown
  logOwnerName?: unknown
  logOwnerVouchers?: unknown
  moneyGained?: unknown
  moneySpent?: unknown
  opponentFinalJokers?: unknown
  opponentMoneySpent?: unknown
  opponentName?: unknown
  opponentRerollCostTotal?: unknown
  opponentRerolls?: unknown
  opponentVouchers?: unknown
  options?: unknown
  rerollCostTotal?: unknown
  rerolls?: unknown
  seed?: unknown
  startDate?: unknown
  winner?: unknown
}

const CONNECTION_ID_REGEX = /^serversideConnectionID=(.+)$/i
const ENCRYPT_ID_REGEX = /^encryptID=(.+)$/i
const POSTGRES_INT_MIN = -2147483648
const POSTGRES_INT_MAX = 2147483647

function collectUniqueNames(
  parsedGames: unknown,
  selector: (game: ParsedGameLike) => unknown | unknown[],
  options?: { skip?: string[] }
) {
  if (!Array.isArray(parsedGames)) {
    return []
  }

  const skip = new Set(
    (options?.skip ?? []).map((value) => value.toLowerCase())
  )
  const seen = new Set<string>()
  const names: string[] = []

  for (const game of parsedGames) {
    if (!game || typeof game !== 'object') {
      continue
    }

    const values = selector(game as ParsedGameLike)

    for (const value of Array.isArray(values) ? values : [values]) {
      if (typeof value !== 'string') {
        continue
      }

      const name = value.trim()
      if (!name) {
        continue
      }

      const normalizedName = name.toLowerCase()
      if (skip.has(normalizedName) || seen.has(normalizedName)) {
        continue
      }

      seen.add(normalizedName)
      names.push(name)
    }
  }

  return names
}

export function extractLogFilePlayers(parsedGames: unknown) {
  return collectUniqueNames(parsedGames, (game) => [game.host, game.guest]).map(
    (playerName) => ({
      playerName,
      playerNameLower: playerName.toLowerCase(),
    })
  )
}

export function extractLogOwnerNames(parsedGames: unknown) {
  return collectUniqueNames(parsedGames, (game) => game.logOwnerName, {
    skip: ['Host', 'Guest'],
  })
}

export function extractLogLobbyCodes(parsedGames: unknown) {
  return collectUniqueNames(parsedGames, (game) => game.lobbyCode)
}

function getModsForLogOwner(game: ParsedGameLike) {
  const logOwnerName =
    typeof game.logOwnerName === 'string' ? game.logOwnerName.trim() : null
  const host = typeof game.host === 'string' ? game.host.trim() : null
  const guest = typeof game.guest === 'string' ? game.guest.trim() : null

  const ownerIsHost =
    typeof game.isHost === 'boolean'
      ? game.isHost
      : logOwnerName && host && logOwnerName === host
        ? true
        : logOwnerName && guest && logOwnerName === guest
          ? false
          : null

  if (ownerIsHost === true) {
    return Array.isArray(game.hostMods) ? game.hostMods : []
  }

  if (ownerIsHost === false) {
    return Array.isArray(game.guestMods) ? game.guestMods : []
  }

  return []
}

function extractModValues(mods: unknown, pattern: RegExp) {
  if (!Array.isArray(mods)) {
    return []
  }

  const seen = new Set<string>()
  const values: string[] = []

  for (const modEntry of mods) {
    if (typeof modEntry !== 'string') {
      continue
    }

    const match = modEntry.match(pattern)
    if (!match?.[1]) {
      continue
    }

    const value = match[1].trim()
    if (!value) {
      continue
    }

    const normalizedValue = value.toLowerCase()
    if (seen.has(normalizedValue)) {
      continue
    }

    seen.add(normalizedValue)
    values.push(value)
  }

  return values
}

function extractConnectionIdsFromMods(mods: unknown) {
  return extractModValues(mods, CONNECTION_ID_REGEX)
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const normalized = normalizeString(entry)
    return normalized ? [normalized] : []
  })
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

  const truncated = Math.trunc(normalized)

  if (truncated < POSTGRES_INT_MIN || truncated > POSTGRES_INT_MAX) {
    return null
  }

  return truncated
}

function normalizeBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  return null
}

function normalizeDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return null
}

function normalizeOptions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const options = { ...(value as Record<string, unknown>) }

  delete options.back
  delete options.stake
  delete options.ruleset

  return Object.keys(options).length > 0 ? options : null
}

function resolveOwnerAndOpponent(game: ParsedGameLike) {
  const host = normalizeString(game.host)
  const guest = normalizeString(game.guest)
  const logOwnerName = normalizeString(game.logOwnerName)
  const opponentName = normalizeString(game.opponentName)
  const isHost = normalizeBoolean(game.isHost)

  if (isHost === true) {
    return {
      host,
      guest,
      isHost,
      logOwnerName: logOwnerName ?? host ?? 'Host',
      opponentName: opponentName ?? guest ?? 'Guest',
    }
  }

  if (isHost === false) {
    return {
      host,
      guest,
      isHost,
      logOwnerName: logOwnerName ?? guest ?? 'Guest',
      opponentName: opponentName ?? host ?? 'Host',
    }
  }

  return {
    host,
    guest,
    isHost,
    logOwnerName,
    opponentName,
  }
}

export function extractConnectionId(mods: unknown) {
  return extractConnectionIdsFromMods(mods).at(0) ?? null
}

export function extractEncryptId(mods: unknown) {
  return extractModValues(mods, ENCRYPT_ID_REGEX).at(0) ?? null
}

export function extractGameRows(
  parsedGames: unknown,
  logFileId: number
): InsertGame[] {
  if (!Array.isArray(parsedGames)) {
    return []
  }

  return parsedGames.flatMap((game, gameIndex) => {
    if (!game || typeof game !== 'object') {
      return []
    }

    const parsedGame = game as ParsedGameLike
    const startDate = normalizeDate(parsedGame.startDate)
    if (!startDate) {
      return []
    }

    const options = normalizeOptions(parsedGame.options)
    const resolvedNames = resolveOwnerAndOpponent(parsedGame)

    return [
      {
        logFileId,
        gameIndex,
        host: resolvedNames.host,
        guest: resolvedNames.guest,
        logOwnerName: resolvedNames.logOwnerName,
        opponentName: resolvedNames.opponentName,
        isHost: resolvedNames.isHost,
        hostConnectionId: extractConnectionId(parsedGame.hostMods),
        guestConnectionId: extractConnectionId(parsedGame.guestMods),
        hostEncryptId: extractEncryptId(parsedGame.hostMods),
        guestEncryptId: extractEncryptId(parsedGame.guestMods),
        deck:
          normalizeString(parsedGame.deck) ??
          normalizeString(options?.back) ??
          null,
        seed:
          normalizeString(parsedGame.seed) ??
          normalizeString(options?.custom_seed) ??
          null,
        stake: normalizeInteger(options?.stake),
        ruleset: normalizeString(options?.ruleset),
        options,
        winner:
          parsedGame.winner === 'logOwner' || parsedGame.winner === 'opponent'
            ? parsedGame.winner
            : null,
        startDate,
        endDate: normalizeDate(parsedGame.endDate),
        durationSeconds: normalizeInteger(parsedGame.durationSeconds),
        moneyGained: normalizeInteger(parsedGame.moneyGained),
        moneySpent: normalizeInteger(parsedGame.moneySpent),
        opponentMoneySpent: normalizeInteger(parsedGame.opponentMoneySpent),
        rerolls: normalizeInteger(parsedGame.rerolls),
        rerollCostTotal: normalizeInteger(parsedGame.rerollCostTotal),
        opponentRerolls: normalizeInteger(parsedGame.opponentRerolls),
        opponentRerollCostTotal: normalizeInteger(
          parsedGame.opponentRerollCostTotal
        ),
        logOwnerFinalJokers: normalizeStringArray(
          parsedGame.logOwnerFinalJokers
        ),
        opponentFinalJokers: normalizeStringArray(
          parsedGame.opponentFinalJokers
        ),
        logOwnerVouchers: normalizeStringArray(parsedGame.logOwnerVouchers),
        opponentVouchers: normalizeStringArray(parsedGame.opponentVouchers),
      },
    ]
  })
}

export function extractLogConnectionIds(parsedGames: unknown) {
  if (!Array.isArray(parsedGames)) {
    return []
  }

  const seen = new Set<string>()
  const connectionIds: string[] = []

  for (const game of parsedGames) {
    if (!game || typeof game !== 'object') {
      continue
    }

    const parsedGame = game as ParsedGameLike
    const ids = [
      ...extractConnectionIdsFromMods(parsedGame.hostMods),
      ...extractConnectionIdsFromMods(parsedGame.guestMods),
    ]

    for (const connectionId of ids) {
      const normalizedConnectionId = connectionId.toLowerCase()
      if (seen.has(normalizedConnectionId)) {
        continue
      }

      seen.add(normalizedConnectionId)
      connectionIds.push(connectionId)
    }
  }

  return connectionIds
}

export function extractLogOwnerConnectionIds(parsedGames: unknown) {
  if (!Array.isArray(parsedGames)) {
    return []
  }

  const seen = new Set<string>()
  const connectionIds: string[] = []

  for (const game of parsedGames) {
    if (!game || typeof game !== 'object') {
      continue
    }

    for (const connectionId of extractConnectionIdsFromMods(
      getModsForLogOwner(game as ParsedGameLike)
    )) {
      const normalizedConnectionId = connectionId.toLowerCase()
      if (seen.has(normalizedConnectionId)) {
        continue
      }

      seen.add(normalizedConnectionId)
      connectionIds.push(connectionId)
    }
  }

  return connectionIds
}
