import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { and, desc, eq, lte, sql } from 'drizzle-orm'
import { env } from '@/env'
import {
  extractGameRows,
  extractLogConnectionIds,
  extractLogFilePlayers,
  extractLogLobbyCodes,
  extractLogOwnerConnectionIds,
} from '@/lib/log-file-players'
import { mergeParsedGames, parseLogSource } from '@/lib/log-source-parser'
import { db } from '@/server/db'
import {
  games,
  logFileConnections,
  logFileLobbyCodes,
  logFileOwnerConnections,
  logFilePlayers,
  logFiles,
} from '@/server/db/schema'
import { minioClient } from '@/server/minio'

const DEFAULT_BATCH_SIZE = 25
const DEFAULT_STATE_FILE = '.reparse-logs/state.json'
const LOG_FETCH_TIMEOUT_MS = 30_000
const LOG_STREAM_TIMEOUT_MS = 30_000
const PROCESS_RETRY_ATTEMPTS = 3
const PROCESS_RETRY_DELAY_MS = 1_000

type Args = {
  batchSize: number
  limit: number | null
  reset: boolean
  stateFile: string
}

type Cursor = {
  id: number
}

type ReparseFailure = {
  attempts: number
  error: string
  failedAt: string
  fileName: string
  id: number
}

type ReparseState = {
  version: 2
  snapshotMaxId: number
  cursor: Cursor | null
  processed: number
  succeeded: number
  failed: number
  failures: ReparseFailure[]
  startedAt: string
  completedAt: string | null
}

type LogRow = {
  id: number
  fileName: string
  fileUrl: string
  createdAt: Date
  parsedJson: unknown
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    batchSize: DEFAULT_BATCH_SIZE,
    limit: null,
    reset: false,
    stateFile: resolve(process.cwd(), DEFAULT_STATE_FILE),
  }

  for (const arg of argv) {
    if (arg === '--reset') {
      args.reset = true
      continue
    }

    if (arg.startsWith('--batch-size=')) {
      const value = Number.parseInt(arg.split('=')[1] ?? '', 10)
      if (Number.isFinite(value) && value > 0) {
        args.batchSize = value
      }
      continue
    }

    if (arg.startsWith('--limit=')) {
      const value = Number.parseInt(arg.split('=')[1] ?? '', 10)
      if (Number.isFinite(value) && value > 0) {
        args.limit = value
      }
      continue
    }

    if (arg.startsWith('--state-file=')) {
      const value = arg.split('=')[1]?.trim()
      if (value) {
        args.stateFile = resolve(process.cwd(), value)
      }
    }
  }

  return args
}

async function readState(path: string): Promise<ReparseState | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ReparseState>
    return {
      version: 2,
      snapshotMaxId: parsed.snapshotMaxId ?? 0,
      cursor: parsed.cursor ?? null,
      processed: parsed.processed ?? 0,
      succeeded: parsed.succeeded ?? 0,
      failed: parsed.failed ?? 0,
      failures: parsed.failures ?? [],
      startedAt: parsed.startedAt ?? new Date().toISOString(),
      completedAt: parsed.completedAt ?? null,
    }
  } catch {
    return null
  }
}

async function writeState(path: string, state: ReparseState) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

function isMinioLogUrl(fileUrl: string) {
  const protocol = env.MINIO_USE_SSL === 'true' ? 'https' : 'http'
  return fileUrl.startsWith(`${protocol}://${env.MINIO_ENDPOINT}/`)
}

async function streamToText(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function fetchLogSource(fileUrl: string) {
  if (isMinioLogUrl(fileUrl)) {
    const parsedUrl = new URL(fileUrl)
    const [, bucketName, ...objectNameParts] = parsedUrl.pathname.split('/')
    const objectName = objectNameParts
      .map((part) => decodeURIComponent(part))
      .join('/')

    if (bucketName && objectName) {
      try {
        const stream = await withTimeout(
          minioClient.getObject(bucketName, objectName),
          LOG_FETCH_TIMEOUT_MS,
          `MinIO fetch ${bucketName}/${objectName}`
        )
        return withTimeout(
          streamToText(stream),
          LOG_STREAM_TIMEOUT_MS,
          `MinIO stream ${bucketName}/${objectName}`
        )
      } catch (error) {
        console.warn(
          `MinIO fetch failed for ${bucketName}/${objectName}, falling back to HTTP:`,
          error
        )
      }
    }
  }

  const response = await fetch(fileUrl, {
    signal: AbortSignal.timeout(LOG_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch source: ${response.status} ${response.statusText}`
    )
  }

  return withTimeout(
    response.text(),
    LOG_STREAM_TIMEOUT_MS,
    `HTTP stream ${fileUrl}`
  )
}

function buildCursorWhere(state: ReparseState) {
  if (!state.cursor) {
    return lte(logFiles.id, state.snapshotMaxId)
  }

  return and(
    lte(logFiles.id, state.snapshotMaxId),
    sql`${logFiles.id} < ${state.cursor.id}`
  )
}

async function getOrCreateState(path: string) {
  const existing = await readState(path)
  if (existing) {
    return existing
  }

  const [latest] = await db
    .select({
      maxId: sql<number>`coalesce(max(${logFiles.id}), 0)::int`,
    })
    .from(logFiles)

  return {
    version: 2,
    snapshotMaxId: latest?.maxId ?? 0,
    cursor: null,
    processed: 0,
    succeeded: 0,
    failed: 0,
    failures: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  } satisfies ReparseState
}

async function getTotalForSnapshot(snapshotMaxId: number) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
    })
    .from(logFiles)
    .where(lte(logFiles.id, snapshotMaxId))

  return row?.total ?? 0
}

async function getNextBatch(state: ReparseState, batchSize: number) {
  return db
    .select({
      id: logFiles.id,
      fileName: logFiles.fileName,
      fileUrl: logFiles.fileUrl,
      createdAt: logFiles.createdAt,
      parsedJson: logFiles.parsedJson,
    })
    .from(logFiles)
    .where(buildCursorWhere(state))
    .orderBy(desc(logFiles.id))
    .limit(batchSize)
}

async function replaceDerivedData(
  logFileId: number,
  mergedParsedJson: unknown
) {
  const players = extractLogFilePlayers(mergedParsedJson)
  const ownerConnectionIds = extractLogOwnerConnectionIds(mergedParsedJson)
  const connectionIds = extractLogConnectionIds(mergedParsedJson)
  const lobbyCodes = extractLogLobbyCodes(mergedParsedJson)
  const gameRows = extractGameRows(mergedParsedJson, logFileId)

  await db.transaction(async (tx) => {
    await tx
      .update(logFiles)
      .set({ parsedJson: mergedParsedJson })
      .where(eq(logFiles.id, logFileId))

    await tx
      .delete(logFilePlayers)
      .where(eq(logFilePlayers.logFileId, logFileId))
    await tx
      .delete(logFileOwnerConnections)
      .where(eq(logFileOwnerConnections.logFileId, logFileId))
    await tx
      .delete(logFileConnections)
      .where(eq(logFileConnections.logFileId, logFileId))
    await tx
      .delete(logFileLobbyCodes)
      .where(eq(logFileLobbyCodes.logFileId, logFileId))
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

    if (ownerConnectionIds.length > 0) {
      await tx.insert(logFileOwnerConnections).values(
        ownerConnectionIds.map((connectionId) => ({
          logFileId,
          connectionId,
          connectionIdLower: connectionId.toLowerCase(),
        }))
      )
    }

    if (connectionIds.length > 0) {
      await tx.insert(logFileConnections).values(
        connectionIds.map((connectionId) => ({
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
}

async function processLog(row: LogRow) {
  const sourceContent = await fetchLogSource(row.fileUrl)
  const reparsedGames = await parseLogSource(sourceContent)
  const mergedParsedJson = mergeParsedGames(row.parsedJson, reparsedGames)

  await replaceDerivedData(row.id, mergedParsedJson)

  return {
    reparsedGames: reparsedGames.length,
    mergedGames: Array.isArray(mergedParsedJson) ? mergedParsedJson.length : 0,
  }
}

async function processLogWithRetry(row: LogRow) {
  let lastError: unknown

  for (let attempt = 1; attempt <= PROCESS_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return {
        ...(await processLog(row)),
        attempts: attempt,
      }
    } catch (error) {
      lastError = error

      if (attempt >= PROCESS_RETRY_ATTEMPTS) {
        break
      }

      console.warn(
        `Retrying #${row.id} ${row.fileName} (${attempt}/${PROCESS_RETRY_ATTEMPTS}) after: ${errorMessage(error)}`
      )
      await delay(PROCESS_RETRY_DELAY_MS * attempt)
    }
  }

  throw lastError
}

function recordFailure(
  state: ReparseState,
  row: LogRow,
  attempts: number,
  error: unknown
) {
  const failure: ReparseFailure = {
    attempts,
    error: errorMessage(error),
    failedAt: new Date().toISOString(),
    fileName: row.fileName,
    id: row.id,
  }

  state.failures = [
    ...state.failures.filter((entry) => entry.id !== row.id),
    failure,
  ]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.reset) {
    await rm(args.stateFile, { force: true })
  }

  const state = await getOrCreateState(args.stateFile)
  await writeState(args.stateFile, state)

  const total = await getTotalForSnapshot(state.snapshotMaxId)
  console.log(
    `Reparsing logs newest->oldest. snapshot<=${state.snapshotMaxId}, processed=${state.processed}/${total}, succeeded=${state.succeeded}, failed=${state.failed}`
  )

  let processedThisRun = 0

  while (true) {
    if (args.limit !== null && processedThisRun >= args.limit) {
      console.log(`Hit --limit=${args.limit}. state kept at ${args.stateFile}`)
      process.exit(0)
    }

    const remainingLimit =
      args.limit === null
        ? args.batchSize
        : Math.min(args.batchSize, args.limit - processedThisRun)
    const rows = await getNextBatch(state, remainingLimit)

    if (rows.length === 0) {
      state.completedAt = new Date().toISOString()
      await writeState(args.stateFile, state)
      if (state.failed > 0) {
        console.error(
          `Complete with failures. failed=${state.failed}. state kept at ${args.stateFile}`
        )
        process.exit(1)
      }
      console.log(`Complete. state kept at ${args.stateFile}`)
      process.exit(0)
    }

    for (const row of rows) {
      try {
        const result = await processLogWithRetry(row)
        state.cursor = {
          id: row.id,
        }
        state.processed += 1
        state.succeeded += 1
        processedThisRun += 1
        await writeState(args.stateFile, state)
        console.log(
          `[${state.processed}/${total}] #${row.id} ${row.fileName} reparsed=${result.reparsedGames} merged=${result.mergedGames} attempts=${result.attempts}`
        )
      } catch (error) {
        state.cursor = {
          id: row.id,
        }
        state.processed += 1
        state.failed += 1
        processedThisRun += 1
        recordFailure(state, row, PROCESS_RETRY_ATTEMPTS, error)
        await writeState(args.stateFile, state)
        console.error(
          `[${state.processed}/${total}] failed #${row.id} ${row.fileName} after ${PROCESS_RETRY_ATTEMPTS} attempts: ${errorMessage(error)}`
        )
        console.error(`Continuing. failed rows saved in ${args.stateFile}`)
      }

      if (args.limit !== null && processedThisRun >= args.limit) {
        console.log(
          `Hit --limit=${args.limit}. state kept at ${args.stateFile}`
        )
        process.exit(0)
      }
    }
  }
}

main().catch((error) => {
  console.error('Reparse failed:', error)
  process.exit(1)
})
