import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/env'
import { detectCheatFlags } from '@/lib/log-cheat-flags'
import {
  extractGameRows,
  extractLogConnectionIds,
  extractLogFilePlayers,
  extractLogLobbyCodes,
  extractLogOwnerConnectionIds,
} from '@/lib/log-file-players'
import { type ParsedLogGame, parseLogSource } from '@/lib/log-source-parser'
import { auth } from '@/server/auth'
import { fetchCocktailDecks } from '@/server/api/routers/logs'
import {
  type BannedUserMatch,
  listBannedUserRegistryEntries,
} from '@/server/banned-users'
import { db } from '@/server/db'
import {
  games,
  logFileConnections,
  logFileLobbyCodes,
  logFileOwnerConnections,
  logFilePlayers,
  logFiles,
} from '@/server/db/schema'
import {
  getHashedObjectName,
  getObjectNameFromUrl,
  getObjectUrl,
  objectExists,
  uploadFile,
} from '@/server/minio'
import { botlatro_service } from '@/server/services/botlatro.service'
import {
  fetchWarningGameContext,
  formatWarningGameContextLines,
  type WarningGameContext,
} from '@/server/services/warning-context'

function getSiteBaseUrl() {
  if (env.NODE_ENV === 'production') return 'https://balatromp.com'
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`

  return `http://localhost:${env.PORT ?? 3000}`
}

function formatCurrency(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2)
}

function formatWarningDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return `<t:${Math.floor(date.getTime() / 1000)}:F>`
}

const DECK_NAMES: Record<string, string> = {
  abandoned: 'Abandoned Deck',
  anaglyph: 'Anaglyph Deck',
  black: 'Black Deck',
  blue: 'Blue Deck',
  checkered: 'Checkered Deck',
  cocktail: 'Cocktail Deck',
  echo: 'Echo Deck',
  echodeck: 'Echo Deck',
  erratic: 'Erratic Deck',
  ghost: 'Ghost Deck',
  gradient: 'Gradient Deck',
  green: 'Green Deck',
  heidelberg: 'Heidelberg Deck',
  indigo: 'Indigo Deck',
  magic: 'Magic Deck',
  nebula: 'Nebula Deck',
  orange: 'Orange Deck',
  oracle: 'Oracle Deck',
  painted: 'Painted Deck',
  plasma: 'Plasma Deck',
  red: 'Red Deck',
  violet: 'Violet Deck',
  white: 'White Deck',
  yellow: 'Yellow Deck',
  zodiac: 'Zodiac Deck',
}

const RULESET_NAMES: Record<string, string> = {
  badlatro: 'Badlatro',
  blitz: 'Standard',
  legacyranked: 'Legacy Ranked',
  legacy_ranked: 'Legacy Ranked',
  majorleague: 'Major League',
  minorleague: 'Minor League',
  sandbox: 'Sandbox: Extra Credit',
  smallworld: 'Small World',
  speedlatro: 'Speedlatro',
  standardranked: 'Standard Ranked',
  standard_ranked: 'Standard Ranked',
  traditional: 'Traditional',
  vanilla: 'Vanilla',
  weekly: 'Weekly',
}

function normalizeLookupKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^ruleset_mp_/, '')
    .replace(/^b_mp_/, '')
    .replace(/^b_/, '')
    .replace(/ deck$/i, '')
    .replace(/[^a-z0-9_]+/g, '')
}

function formatDeckName(deck: string) {
  const normalizedKey = normalizeLookupKey(deck)
  if (DECK_NAMES[normalizedKey]) {
    return DECK_NAMES[normalizedKey]
  }

  if (/deck$/i.test(deck)) {
    return deck
  }

  return `${deck} Deck`
}

function formatRulesetName(gameMode: string) {
  const normalizedKey = normalizeLookupKey(gameMode)
  return RULESET_NAMES[normalizedKey] ?? gameMode
}

function getResolvedCocktailDecks(game: unknown) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) {
    return []
  }

  const candidate = game as {
    cocktailDecks?: unknown
  }

  if (!Array.isArray(candidate.cocktailDecks)) {
    return []
  }

  return candidate.cocktailDecks.filter(
    (deck): deck is string => typeof deck === 'string' && deck.trim().length > 0
  )
}

function formatWarningDeckLabel(game: unknown, fallbackDeck: string) {
  const deckName = formatDeckName(fallbackDeck)
  if (normalizeLookupKey(fallbackDeck) !== 'cocktail') {
    return deckName
  }

  const resolvedDecks = getResolvedCocktailDecks(game)
  if (resolvedDecks.length === 0) {
    return deckName
  }

  return `${deckName} (${resolvedDecks.join(', ')})`
}

function getEventsBeforeFirstShop(game: unknown) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) {
    return []
  }

  const events = (game as { events?: unknown }).events
  if (!Array.isArray(events)) {
    return []
  }

  const collected: string[] = []

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const text = typeof event.text === 'string' ? event.text.trim() : null
    if (!text) continue

    if (text === 'Moved to Shop' || event.type === 'shop') {
      break
    }

    collected.push(text)
  }

  return collected
}

function formatCheatFlagDetails(
  flag: ReturnType<typeof detectCheatFlags>[number],
  issueNumber: number,
  parsedGame: unknown
) {
  if (flag.type === 'first_round_overearn') {
    const lines = [
      `Issue ${issueNumber} · first-round over-earn`,
      `- Blind: ${flag.blindName}`,
      `- Player: ${flag.playerName}`,
      `- Earned before shop: $${formatCurrency(flag.actualEarned)} (max $${formatCurrency(flag.expectedEarned)})`,
      `- Total money: $${formatCurrency(flag.actualMoney)} (max $${formatCurrency(flag.expectedMoney)})`,
    ]

    const preShopEvents = getEventsBeforeFirstShop(parsedGame)
    if (preShopEvents.length > 0) {
      lines.push('- Events before first shop:')
      for (const event of preShopEvents) {
        lines.push(`  · ${event}`)
      }
    }

    return lines
  }

  return [
    `Issue ${issueNumber} · first-shop overspend`,
    `- Threshold: $${formatCurrency(flag.threshold)}`,
    ...flag.offenders.map(
      (offender, index) =>
        `  ${index + 1}. ${offender.playerName} spent $${formatCurrency(offender.amount)}`
    ),
  ]
}

function formatGroupedCheatWarningLines(
  flags: ReturnType<typeof detectCheatFlags>,
  logUrl: string,
  parsedGames: unknown,
  contextByGameIndex = new Map<number, WarningGameContext>()
) {
  const groupedFlags = new Map<number, ReturnType<typeof detectCheatFlags>>()

  for (const flag of flags) {
    const existing = groupedFlags.get(flag.gameIndex)
    if (existing) {
      existing.push(flag)
      continue
    }

    groupedFlags.set(flag.gameIndex, [flag])
  }

  const lines: string[] = []

  for (const [index, gameFlags] of [...groupedFlags.entries()].sort(
    ([left], [right]) => left - right
  )) {
    const firstFlag = gameFlags[0]
    if (!firstFlag) {
      continue
    }

    if (lines.length > 0) {
      lines.push('---')
    }

    const gameUrl = new URL(logUrl)
    gameUrl.searchParams.set('game', index.toString())
    const parsedGame =
      Array.isArray(parsedGames) && index >= 0 ? parsedGames[index] : null

    lines.push(
      `Game ${index + 1} · ${formatWarningDeckLabel(parsedGame, firstFlag.deck)} · ${formatRulesetName(firstFlag.gameMode)} · ${firstFlag.stake}`
    )

    if (firstFlag.startDate) {
      lines.push(`Started: ${formatWarningDate(firstFlag.startDate)}`)
    }

    const contextLines = formatWarningGameContextLines(
      contextByGameIndex.get(index) ?? {
        firstAnte: null,
        shopQueuePreview: [],
      }
    )

    if (contextLines.length > 0) {
      lines.push(...contextLines)
    }

    for (const [issueIndex, flag] of gameFlags.entries()) {
      lines.push(...formatCheatFlagDetails(flag, issueIndex + 1, parsedGame))
    }

    lines.push(`View: ${gameUrl.toString()}`)
  }

  return lines
}

function sanitizeWarningLines(lines: string[]) {
  return lines.flatMap((line) => {
    const normalized = line.trimEnd()
    return normalized.length > 0 ? [normalized] : []
  })
}

function getWarningContextInput(game: unknown) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) {
    return null
  }

  const parsedGame = game as {
    deck?: unknown
    options?: unknown
    seed?: unknown
  }
  const options =
    parsedGame.options &&
    typeof parsedGame.options === 'object' &&
    !Array.isArray(parsedGame.options)
      ? (parsedGame.options as {
          back?: unknown
          custom_seed?: unknown
        })
      : null

  const deckValue =
    typeof parsedGame.deck === 'string' && parsedGame.deck.trim()
      ? parsedGame.deck
      : typeof options?.back === 'string' && options.back.trim()
        ? options.back
        : null
  const seedValue =
    typeof parsedGame.seed === 'string' && parsedGame.seed.trim()
      ? parsedGame.seed
      : typeof options?.custom_seed === 'string' && options.custom_seed.trim()
        ? options.custom_seed
        : null

  if (!deckValue || !seedValue) {
    return null
  }

  return {
    deck: formatDeckName(deckValue),
    seed: seedValue,
  }
}

async function buildWarningContextByGameIndex(
  parsedGames: unknown,
  gameIndexes: number[]
) {
  if (!Array.isArray(parsedGames) || gameIndexes.length === 0) {
    return new Map<number, WarningGameContext>()
  }

  const uniqueGameIndexes = [...new Set(gameIndexes)].sort((a, b) => a - b)
  const requestCache = new Map<string, Promise<WarningGameContext | null>>()
  const entries = await Promise.all(
    uniqueGameIndexes.map(async (gameIndex) => {
      const input = getWarningContextInput(parsedGames[gameIndex])
      if (!input) {
        return [gameIndex, null] as const
      }

      const cacheKey = `${input.seed}:${input.deck}`
      let request = requestCache.get(cacheKey)

      if (!request) {
        request = fetchWarningGameContext(input)
        requestCache.set(cacheKey, request)
      }

      return [gameIndex, await request] as const
    })
  )

  return new Map(
    entries.filter(
      (entry): entry is readonly [number, WarningGameContext] =>
        entry[1] !== null
    )
  )
}

function formatBannedUserWarningLines(
  matches: BannedUserMatch[],
  logUrl: string,
  lobbyCodes: string[]
) {
  const lines = [`Log: ${logUrl}`]

  for (const lobbyCode of lobbyCodes) {
    lines.push(
      `- Lobby code: ${lobbyCode} → ${getSiteBaseUrl()}/admin/lobby-codes?search=${encodeURIComponent(lobbyCode)}`
    )
  }

  for (const match of matches) {
    if (lines.length > 1) {
      lines.push('---')
    }

    lines.push(`- Label: ${match.label}`)

    if (match.matchedAliases.length > 0) {
      lines.push(`- Aliases: ${match.matchedAliases.join(', ')}`)
    }

    if (match.matchedIds.length > 0) {
      lines.push(`- Ids: ${match.matchedIds.join(', ')}`)
    }
  }

  return lines
}

async function resolveCocktailDecksForGames(
  parsedGames: ParsedLogGame[]
): Promise<ParsedLogGame[]> {
  const requestCache = new Map<string, Promise<string[] | null>>()
  let changed = false

  const resolved = await Promise.all(
    parsedGames.map(async (game) => {
      if (
        normalizeLookupKey(game.deck ?? '') !== 'cocktail' ||
        !game.seed ||
        !game.options?.cocktail
      ) {
        return game
      }

      const cacheKey = `${game.seed}:${game.options.cocktail}`
      let request = requestCache.get(cacheKey)

      if (!request) {
        request = fetchCocktailDecks(game.seed, game.options.cocktail)
        requestCache.set(cacheKey, request)
      }

      const decks = await request
      if (decks) {
        changed = true
        return { ...game, cocktailDecks: decks }
      }

      return game
    })
  )

  return changed ? resolved : parsedGames
}

async function parseAndSaveGames(
  logFileId: number,
  fileContent: string,
  isFirstParse: boolean
) {
  const parsedGames = await resolveCocktailDecksForGames(
    await parseLogSource(fileContent)
  )

  const players = extractLogFilePlayers(parsedGames)
  const allConnectionIds = extractLogConnectionIds(parsedGames)
  const connectionIds = extractLogOwnerConnectionIds(parsedGames)
  const lobbyCodes = extractLogLobbyCodes(parsedGames)
  const gameRows = extractGameRows(parsedGames, logFileId)
  const cheatFlags = detectCheatFlags(parsedGames)
  const extractedIdSet = new Set(
    allConnectionIds.map((connectionId) => connectionId.toLowerCase())
  )
  const bannedMatches = (await listBannedUserRegistryEntries()).flatMap(
    (entry) => {
      const matchedIds = entry.ids.filter((value) =>
        extractedIdSet.has(value.toLowerCase())
      )

      if (matchedIds.length === 0) {
        return []
      }

      return [
        {
          entryId: entry.id,
          label: entry.label,
          matchedAliases: entry.aliases,
          matchedIds,
        },
      ]
    }
  )

  await db.transaction(async (tx) => {
    await tx
      .update(logFiles)
      .set({ parsedJson: parsedGames })
      .where(eq(logFiles.id, logFileId))

    await tx
      .delete(logFilePlayers)
      .where(eq(logFilePlayers.logFileId, logFileId))

    await tx
      .delete(logFileConnections)
      .where(eq(logFileConnections.logFileId, logFileId))

    await tx
      .delete(logFileLobbyCodes)
      .where(eq(logFileLobbyCodes.logFileId, logFileId))

    await tx
      .delete(logFileOwnerConnections)
      .where(eq(logFileOwnerConnections.logFileId, logFileId))

    await tx.delete(games).where(eq(games.logFileId, logFileId))

    if (players.length > 0) {
      await tx.insert(logFilePlayers).values(
        players.map((player) => ({
          logFileId,
          playerName: player.playerName,
          playerNameLower: player.playerNameLower,
        }))
      )
    }

    if (connectionIds.length > 0) {
      await tx.insert(logFileOwnerConnections).values(
        connectionIds.map((connectionId) => ({
          logFileId,
          connectionId,
          connectionIdLower: connectionId.toLowerCase(),
        }))
      )
    }

    if (allConnectionIds.length > 0) {
      await tx.insert(logFileConnections).values(
        allConnectionIds.map((connectionId) => ({
          logFileId,
          connectionId,
          connectionIdLower: connectionId.toLowerCase(),
        }))
      )
    }

    if (lobbyCodes.length > 0) {
      await tx.insert(logFileLobbyCodes).values(
        lobbyCodes.map((lobbyCode) => ({
          logFileId,
          lobbyCode,
          lobbyCodeLower: lobbyCode.toLowerCase(),
        }))
      )
    }

    if (gameRows.length > 0) {
      await tx.insert(games).values(gameRows)
    }
  })

  if (isFirstParse && cheatFlags.length > 0) {
    const logUrl = `${getSiteBaseUrl()}/log-parser?logId=${logFileId}`

    void buildWarningContextByGameIndex(
      parsedGames,
      cheatFlags.map((flag) => flag.gameIndex)
    )
      .then((contextByGameIndex) =>
        botlatro_service.sendWarning({
          title: `Warning: suspicious early economy detected in uploaded log #${logFileId}`,
          lines: sanitizeWarningLines([
            `Log: ${logUrl}`,
            ...formatGroupedCheatWarningLines(
              cheatFlags,
              logUrl,
              parsedGames,
              contextByGameIndex
            ),
          ]),
        })
      )
      .catch((error) => {
        console.error(
          `Failed to send cheat warning for log ${logFileId}:`,
          error
        )
      })
  }

  if (isFirstParse && bannedMatches.length > 0) {
    const logUrl = `${getSiteBaseUrl()}/log-parser?logId=${logFileId}`

    botlatro_service
      .sendWarning({
        title: `Warning: banned user match detected in uploaded log #${logFileId}`,
        lines: formatBannedUserWarningLines(bannedMatches, logUrl, lobbyCodes),
      })
      .catch((error) => {
        console.error(
          `Failed to send banned user warning for log ${logFileId}:`,
          error
        )
      })
  }

  return parsedGames
}

export async function POST(req: NextRequest) {
  try {
    // Check if user is authenticated (optional)
    const session = await auth()
    const userId = session?.user?.id

    // Parse the multipart form data
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Convert the file to a buffer and text
    const buffer = Buffer.from(await file.arrayBuffer())
    const fileContent = await file.text()
    const shouldBypassDedupe =
      env.NODE_ENV !== 'production' && env.LOG_DEDUPE_BYPASS === 'true'
    const fileHash = createHash('sha256').update(buffer).digest('hex')

    const existingLogFile = shouldBypassDedupe
      ? null
      : await db.query.logFiles.findFirst({
          columns: {
            id: true,
            fileName: true,
            fileUrl: true,
            parsedJson: true,
            createdAt: true,
          },
          where: eq(logFiles.fileHash, fileHash),
        })

    if (existingLogFile) {
      const existingObjectName = getObjectNameFromUrl(existingLogFile.fileUrl)

      if (existingObjectName && (await objectExists(existingObjectName))) {
        return NextResponse.json({
          id: existingLogFile.id,
          fileName: existingLogFile.fileName,
          fileUrl: existingLogFile.fileUrl,
          createdAt: existingLogFile.createdAt,
          parsedGames: existingLogFile.parsedJson,
          userId,
          userName: session?.user?.name ?? null,
          userEmail: session?.user?.email ?? null,
        })
      }
    }

    const fileUrl = shouldBypassDedupe
      ? await uploadFile(buffer, file.name, file.type)
      : (await objectExists(getHashedObjectName(fileHash)))
        ? getObjectUrl(getHashedObjectName(fileHash))
        : await uploadFile(
            buffer,
            file.name,
            file.type,
            env.MINIO_BUCKET_NAME,
            {
              objectName: getHashedObjectName(fileHash),
            }
          )

    if (existingLogFile) {
      const [restoredLogFile] = await db
        .update(logFiles)
        .set({
          fileHash,
          fileUrl,
        })
        .where(eq(logFiles.id, existingLogFile.id))
        .returning()

      if (!restoredLogFile) {
        return NextResponse.json(
          { error: 'This should never happen, hopefully' },
          { status: 500 }
        )
      }

      const parsedGames = await parseAndSaveGames(
        restoredLogFile.id,
        fileContent,
        !Array.isArray(existingLogFile.parsedJson)
      )

      return NextResponse.json({
        id: restoredLogFile.id,
        fileName: restoredLogFile.fileName,
        fileUrl: restoredLogFile.fileUrl,
        createdAt: restoredLogFile.createdAt,
        parsedGames,
        userId,
        userName: session?.user?.name ?? null,
        userEmail: session?.user?.email ?? null,
      })
    }
    const [insertedLogFile] = await db
      .insert(logFiles)
      .values({
        userId,
        fileName: file.name,
        fileHash: shouldBypassDedupe ? null : fileHash,
        fileUrl,
        parsedJson: {},
      })
      .onConflictDoNothing({
        target: logFiles.fileHash,
      })
      .returning()
    const logFile =
      insertedLogFile ??
      (await db.query.logFiles.findFirst({
        columns: {
          id: true,
          fileName: true,
          fileUrl: true,
          createdAt: true,
        },
        where: eq(logFiles.fileHash, fileHash),
      }))
    if (!logFile) {
      return NextResponse.json(
        { error: 'This should never happen, hopefully' },
        { status: 500 }
      )
    }
    const parsedGames = await parseAndSaveGames(logFile.id, fileContent, true)

    return NextResponse.json({
      id: logFile.id,
      fileName: logFile.fileName,
      fileUrl: logFile.fileUrl,
      createdAt: logFile.createdAt,
      parsedGames,
      userId,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
    })
  } catch (error) {
    console.error('Error uploading log file:', error)
    return NextResponse.json(
      { error: 'Failed to upload log file' },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    const data = await req.json()
    const { logFileId } = data

    if (!logFileId) {
      return NextResponse.json(
        { error: 'No log file ID provided' },
        { status: 400 }
      )
    }

    const logFile = await db.query.logFiles.findFirst({
      columns: {
        id: true,
        fileUrl: true,
        parsedJson: true,
      },
      where: eq(logFiles.id, logFileId),
    })

    if (!logFile?.fileUrl) {
      return NextResponse.json(
        { error: 'Log file not found or has no stored file' },
        { status: 404 }
      )
    }

    const response = await fetch(logFile.fileUrl)
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch stored log file' },
        { status: 500 }
      )
    }

    const fileContent = await response.text()
    const parsedGames = await parseAndSaveGames(
      logFileId,
      fileContent,
      !Array.isArray(logFile.parsedJson)
    )

    return NextResponse.json({ success: true, parsedGames })
  } catch (error) {
    console.error('Error reparsing log file:', error)
    return NextResponse.json(
      { error: 'Failed to reparse log file' },
      { status: 500 }
    )
  }
}
