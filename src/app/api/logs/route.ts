import { asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  extractLogOwnerConnectionIds,
  extractLogOwnerNames,
} from '@/lib/log-file-players'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { db } from '@/server/db'
import {
  logFileConnections,
  logFileLobbyCodes,
  logFileOwnerConnections,
  logFilePlayers,
  logFiles,
  users,
} from '@/server/db/schema'

function buildPlayerSearchFilter(search: string) {
  const searchTerm = `%${search.trim().toLowerCase()}%`

  return sql`
    exists (
      select 1
      from ${logFilePlayers}
      where
        ${logFilePlayers.logFileId} = ${logFiles.id}
        and ${logFilePlayers.playerNameLower} like ${searchTerm}
    )
  `
}

function buildConnectionIdSearchFilter(search: string) {
  const searchTerm = `%${search.trim().toLowerCase()}%`

  return sql`
    exists (
      select 1
      from ${logFileConnections}
      where
        ${logFileConnections.logFileId} = ${logFiles.id}
        and ${logFileConnections.connectionIdLower} like ${searchTerm}
    )
  `
}

function buildLobbyCodeSearchFilter(search: string) {
  const searchTerm = `%${search.trim().toLowerCase()}%`

  return sql`
    exists (
      select 1
      from ${logFileLobbyCodes}
      where
        ${logFileLobbyCodes.logFileId} = ${logFiles.id}
        and ${logFileLobbyCodes.lobbyCodeLower} like ${searchTerm}
    )
  `
}

type DedupedLogRow = {
  id: number
  fileUrl: string
  fileName: string
  createdAt: Date
  logIds: number[]
  ownerConnectionIds: string[]
  uploadedBy: string[]
  uploadedBySort: string
  mergedCount: number
}

type LogListItem = {
  id: number
  logIds: number[]
  fileName: string
  fileUrl: string
  createdAt: Date
  lobbyCodes: string[]
  ownerConnectionIds: string[]
  ownerNames: string[]
  uploadedBy: string[]
  mergedCount: number
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const value of values) {
    const normalized = value.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    deduped.push(value)
  }

  return deduped.sort((a, b) => a.localeCompare(b))
}

function buildOwnerNamesByLogIds(
  rows: Array<{ id: number; parsedJson: unknown }>
): Map<number, string[]> {
  return new Map(
    rows.map((row) => [row.id, extractLogOwnerNames(row.parsedJson)] as const)
  )
}

function buildStringValuesByLogFileId<T extends { logFileId: number }>(
  rows: T[],
  getValue: (row: T) => string
) {
  const valuesByLogFileId = new Map<number, string[]>()

  for (const row of rows) {
    const currentValues = valuesByLogFileId.get(row.logFileId) ?? []
    currentValues.push(getValue(row))
    valuesByLogFileId.set(row.logFileId, currentValues)
  }

  return valuesByLogFileId
}

async function getLobbyCodesByLogFileId(logIds: number[]) {
  if (logIds.length === 0) {
    return new Map<number, string[]>()
  }

  const rows = await db
    .select({
      logFileId: logFileLobbyCodes.logFileId,
      lobbyCode: logFileLobbyCodes.lobbyCode,
    })
    .from(logFileLobbyCodes)
    .where(inArray(logFileLobbyCodes.logFileId, logIds))

  return buildStringValuesByLogFileId(rows, (row) => row.lobbyCode)
}

function buildDedupedSearchWhere(search: string) {
  if (!search) {
    return sql``
  }

  const searchTerm = `%${search}%`
  const searchTermLower = `%${search.toLowerCase()}%`

  return sql`
    where
      g.file_name ilike ${searchTerm}
      or exists (
        select 1
        from ${logFiles}
        left join ${users} on ${users.id} = ${logFiles.userId}
        where
          ${logFiles.id} = any(g.log_ids)
          and coalesce(${users.name}, ${users.email}, 'Anonymous') ilike ${searchTerm}
      )
      or exists (
        select 1
        from ${logFilePlayers}
        where
          ${logFilePlayers.logFileId} = any(g.log_ids)
          and ${logFilePlayers.playerNameLower} like ${searchTermLower}
      )
      or exists (
        select 1
        from ${logFileConnections}
        where
          ${logFileConnections.logFileId} = any(g.log_ids)
          and ${logFileConnections.connectionIdLower} like ${searchTermLower}
      )
      or exists (
        select 1
        from ${logFileLobbyCodes}
        where
          ${logFileLobbyCodes.logFileId} = any(g.log_ids)
          and ${logFileLobbyCodes.lobbyCodeLower} like ${searchTermLower}
      )
  `
}

function buildDedupedOrderBy(sortBy: string, sortOrder: 'asc' | 'desc') {
  const direction = sql.raw(sortOrder === 'asc' ? 'asc' : 'desc')

  if (sortBy === 'fileName') {
    return sql`g.file_name ${direction}, g.created_at desc, g.id desc`
  }

  if (sortBy === 'userName') {
    return sql`g.uploaded_by_sort ${direction}, g.created_at desc, g.id desc`
  }

  return sql`g.created_at ${direction}, g.id desc`
}

async function getDedupedLogs({
  page,
  pageSize,
  offset,
  sortBy,
  sortOrder,
  search,
}: {
  page: number
  pageSize: number
  offset: number
  sortBy: string
  sortOrder: 'asc' | 'desc'
  search: string
}) {
  const groupedLogsSql = sql`
    with grouped_logs as (
      select
        (array_agg(${logFiles.id} order by ${logFiles.createdAt} desc, ${logFiles.id} desc))[1] as id,
        (array_agg(${logFiles.fileUrl} order by ${logFiles.createdAt} desc, ${logFiles.id} desc))[1] as file_url,
        ${logFiles.fileName} as file_name,
        max(${logFiles.createdAt}) as created_at,
        array_agg(${logFiles.id} order by ${logFiles.createdAt} desc, ${logFiles.id} desc) as log_ids,
        coalesce(
          array_remove(array_agg(distinct ${logFileOwnerConnections.connectionId}), null),
          '{}'::text[]
        ) as owner_connection_ids,
        coalesce(
          array_remove(
            array_agg(distinct coalesce(${users.name}, ${users.email}, 'Anonymous')),
            null
          ),
          '{}'::text[]
        ) as uploaded_by,
        min(coalesce(${users.name}, ${users.email}, 'Anonymous')) as uploaded_by_sort,
        count(*)::int as merged_count
      from ${logFiles}
      left join ${users} on ${users.id} = ${logFiles.userId}
      left join ${logFileOwnerConnections}
        on ${logFileOwnerConnections.logFileId} = ${logFiles.id}
      group by
        ${logFiles.fileName},
        coalesce(${logFileOwnerConnections.connectionIdLower}, '')
    ),
    filtered_logs as (
      select *
      from grouped_logs g
      ${buildDedupedSearchWhere(search)}
    )
  `

  const [{ total } = { total: 0 }] = await db.execute<{ total: number }>(sql`
    ${groupedLogsSql}
    select count(*)::int as total
    from filtered_logs
  `)

  const logs = await db.execute<DedupedLogRow>(sql`
    ${groupedLogsSql}
    select
      g.id,
      g.file_url as "fileUrl",
      g.file_name as "fileName",
      g.created_at as "createdAt",
      g.log_ids as "logIds",
      g.owner_connection_ids as "ownerConnectionIds",
      g.uploaded_by as "uploadedBy",
      g.uploaded_by_sort as "uploadedBySort",
      g.merged_count as "mergedCount"
    from filtered_logs g
    order by ${buildDedupedOrderBy(sortBy, sortOrder)}
    limit ${pageSize}
    offset ${offset}
  `)

  const logIds = [...new Set(logs.flatMap((log) => log.logIds))]

  const parsedLogs =
    logIds.length > 0
      ? await db
          .select({
            id: logFiles.id,
            parsedJson: logFiles.parsedJson,
          })
          .from(logFiles)
          .where(inArray(logFiles.id, logIds))
      : []

  const ownerNamesByLogId = buildOwnerNamesByLogIds(parsedLogs)
  const lobbyCodesByLogId = await getLobbyCodesByLogFileId(logIds)
  const data: LogListItem[] = logs.map((log) => ({
    id: log.id,
    logIds: log.logIds,
    fileName: log.fileName,
    fileUrl: log.fileUrl,
    createdAt: log.createdAt,
    lobbyCodes: uniqueStrings(
      log.logIds.flatMap((logId) => lobbyCodesByLogId.get(logId) ?? [])
    ),
    ownerConnectionIds: uniqueStrings(log.ownerConnectionIds),
    ownerNames: uniqueStrings(
      log.logIds.flatMap((logId) => ownerNamesByLogId.get(logId) ?? [])
    ),
    uploadedBy: uniqueStrings(log.uploadedBy),
    mergedCount: log.mergedCount,
  }))

  const totalNum = Number(total ?? 0)

  return {
    data,
    page,
    pageSize,
    total: totalNum,
    totalPages: Math.max(1, Math.ceil(totalNum / pageSize)),
    search: search || null,
  }
}

export async function GET(req: NextRequest) {
  try {
    // Get the log file ID from the request
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const pageParam = searchParams.get('page')
    const pageSizeParam = searchParams.get('pageSize')
    const dedupeParam = searchParams.get('dedupe')
    const sortBy = (searchParams.get('sortBy') ?? 'createdAt').trim()
    const sortOrder = (searchParams.get('sortOrder') ?? 'desc').trim() as
      | 'asc'
      | 'desc'
    const search = (
      searchParams.get('search') ??
      searchParams.get('q') ??
      ''
    ).trim()

    // Check if user is authenticated
    const session = await auth()

    if (id) {
      const idNum = Number.parseInt(id, 10)
      if (Number.isNaN(idNum)) {
        return NextResponse.json(
          { error: 'Invalid log file id' },
          { status: 400 }
        )
      }

      // Fetching a specific log file by ID
      // For specific log files, we allow access to the owner or admins
      const logFile = await db
        .select({
          id: logFiles.id,
          fileName: logFiles.fileName,
          fileUrl: logFiles.fileUrl,
          parsedJson: logFiles.parsedJson,
          createdAt: logFiles.createdAt,
          userId: logFiles.userId,
          userName: users.name,
          userEmail: users.email,
        })
        .from(logFiles)
        .leftJoin(users, eq(logFiles.userId, users.id))
        .where(eq(logFiles.id, idNum))
        .limit(1)

      if (logFile.length === 0) {
        return NextResponse.json(
          { error: 'Log file not found' },
          { status: 404 }
        )
      }

      const selectedLogFile = logFile.at(0)
      if (!selectedLogFile) {
        return NextResponse.json(
          { error: 'Log file not found' },
          { status: 404 }
        )
      }

      // Check if user is authorized to access this log file
      // Allow access if user is admin or the owner of the log file
      if (
        !session ||
        (!hasPermission(session.user, 'logs.manage') &&
          selectedLogFile.userId !== session.user.id)
      ) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      return NextResponse.json({
        ...selectedLogFile,
        ownerConnectionIds: extractLogOwnerConnectionIds(
          selectedLogFile.parsedJson
        ),
        ownerNames: extractLogOwnerNames(selectedLogFile.parsedJson),
      })
    }
    // Fetching all log files (admin only)
    if (!hasPermission(session?.user, 'logs.manage')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1)
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(pageSizeParam ?? '50', 10) || 50)
    )
    const offset = (page - 1) * pageSize
    const dedupe = dedupeParam !== 'false'

    if (dedupe) {
      return NextResponse.json(
        await getDedupedLogs({
          page,
          pageSize,
          offset,
          sortBy,
          sortOrder,
          search,
        })
      )
    }

    const dir = sortOrder === 'asc' ? asc : desc
    const orderBy =
      sortBy === 'fileName'
        ? [dir(logFiles.fileName), desc(logFiles.createdAt), desc(logFiles.id)]
        : sortBy === 'userName'
          ? [
              dir(users.name),
              dir(users.email),
              desc(logFiles.createdAt),
              desc(logFiles.id),
            ]
          : [dir(logFiles.createdAt), desc(logFiles.id)]

    const where = search
      ? or(
          ilike(logFiles.fileName, `%${search}%`),
          ilike(users.name, `%${search}%`),
          ilike(users.email, `%${search}%`),
          buildPlayerSearchFilter(search),
          buildConnectionIdSearchFilter(search),
          buildLobbyCodeSearchFilter(search)
        )
      : undefined

    const [{ total } = { total: 0 }] = await (where
      ? db
          .select({ total: sql<string>`count(*)::int` })
          .from(logFiles)
          .leftJoin(users, eq(logFiles.userId, users.id))
          .where(where)
      : db
          .select({ total: sql<string>`count(*)::int` })
          .from(logFiles)
          .leftJoin(users, eq(logFiles.userId, users.id)))

    // Get paginated log files with user info
    const logs = await (where
      ? db
          .select({
            id: logFiles.id,
            fileName: logFiles.fileName,
            fileUrl: logFiles.fileUrl,
            createdAt: logFiles.createdAt,
            parsedJson: logFiles.parsedJson,
            userId: logFiles.userId,
            userName: users.name,
            userEmail: users.email,
          })
          .from(logFiles)
          .leftJoin(users, eq(logFiles.userId, users.id))
          .where(where)
          .orderBy(...orderBy)
          .limit(pageSize)
          .offset(offset)
      : db
          .select({
            id: logFiles.id,
            fileName: logFiles.fileName,
            fileUrl: logFiles.fileUrl,
            createdAt: logFiles.createdAt,
            parsedJson: logFiles.parsedJson,
            userId: logFiles.userId,
            userName: users.name,
            userEmail: users.email,
          })
          .from(logFiles)
          .leftJoin(users, eq(logFiles.userId, users.id))
          .orderBy(...orderBy)
          .limit(pageSize)
          .offset(offset))

    const totalNum = Number(total ?? 0)
    const totalPages = Math.max(1, Math.ceil(totalNum / pageSize))
    const logIds = logs.map((log) => log.id)
    const lobbyCodesByLogId = await getLobbyCodesByLogFileId(logIds)

    return NextResponse.json({
      data: logs.map(({ parsedJson, userName, userEmail, ...log }) => ({
        ...log,
        logIds: [log.id],
        lobbyCodes: uniqueStrings(lobbyCodesByLogId.get(log.id) ?? []),
        ownerConnectionIds: extractLogOwnerConnectionIds(parsedJson),
        ownerNames: extractLogOwnerNames(parsedJson),
        uploadedBy: [userName || userEmail || 'Anonymous'],
        mergedCount: 1,
      })),
      page,
      pageSize,
      total: totalNum,
      totalPages,
      search: search || null,
    })
  } catch (error) {
    console.error('Error fetching log files:', error)
    return NextResponse.json(
      { error: 'Failed to fetch log files' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!hasPermission(session?.user, 'logs.manage')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the log file ID from the request
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Log file ID is required' },
        { status: 400 }
      )
    }

    // Delete the log file from the database
    await db.delete(logFiles).where(eq(logFiles.id, Number.parseInt(id, 10)))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting log file:', error)
    return NextResponse.json(
      { error: 'Failed to delete log file' },
      { status: 500 }
    )
  }
}
