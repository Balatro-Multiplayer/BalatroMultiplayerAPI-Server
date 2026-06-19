import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { games } from '@/server/db/schema'

type SortBy =
  | 'host'
  | 'guest'
  | 'deck'
  | 'stake'
  | 'durationSeconds'
  | 'startDate'
  | 'moneySpent'
  | 'rerolls'

function isSortBy(value: string): value is SortBy {
  return (
    value === 'host' ||
    value === 'guest' ||
    value === 'deck' ||
    value === 'stake' ||
    value === 'durationSeconds' ||
    value === 'startDate' ||
    value === 'moneySpent' ||
    value === 'rerolls'
  )
}

function buildOrderBy(sortBy: SortBy, sortOrder: 'asc' | 'desc') {
  const direction = sortOrder === 'asc' ? asc : desc

  switch (sortBy) {
    case 'host':
      return [
        direction(games.host),
        desc(games.startDate),
        desc(games.id),
      ] as const
    case 'guest':
      return [
        direction(games.guest),
        desc(games.startDate),
        desc(games.id),
      ] as const
    case 'deck':
      return [
        direction(games.deck),
        desc(games.startDate),
        desc(games.id),
      ] as const
    case 'stake':
      return [
        direction(games.stake),
        desc(games.startDate),
        desc(games.id),
      ] as const
    case 'durationSeconds':
      return [
        direction(games.durationSeconds),
        desc(games.startDate),
        desc(games.id),
      ] as const
    case 'moneySpent':
      return [
        direction(games.moneySpent),
        desc(games.startDate),
        desc(games.id),
      ] as const
    case 'rerolls':
      return [
        direction(games.rerolls),
        desc(games.startDate),
        desc(games.id),
      ] as const
    default:
      return [direction(games.startDate), desc(games.id)] as const
  }
}

async function getDistinctValues(
  column: typeof games.deck | typeof games.ruleset
) {
  const rows = await db.execute<{ value: string }>(sql`
    select distinct ${column} as value
    from ${games}
    where ${column} is not null and ${column} <> ''
    order by 1 asc
  `)

  return rows.map((row) => row.value)
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()

    if (!hasPermission(session?.user, 'games.view')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(
      1,
      Number.parseInt(searchParams.get('page') ?? '1', 10) || 1
    )
    const pageSize = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(searchParams.get('pageSize') ?? '50', 10) || 50
      )
    )
    const search = (searchParams.get('search') ?? '').trim()
    const deck = (searchParams.get('deck') ?? '').trim()
    const ruleset = (searchParams.get('ruleset') ?? '').trim()
    const winner = searchParams.get('winner')
    const stakeParam = searchParams.get('stake')
    const sortByParam = (searchParams.get('sortBy') ?? 'startDate').trim()
    const sortBy = isSortBy(sortByParam) ? sortByParam : 'startDate'
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc'
    const stake = stakeParam?.trim() ? Number.parseInt(stakeParam, 10) : null
    const offset = (page - 1) * pageSize

    const filters = []

    if (search) {
      const searchTerm = `%${search}%`
      filters.push(
        or(
          ilike(games.host, searchTerm),
          ilike(games.guest, searchTerm),
          ilike(games.hostConnectionId, searchTerm),
          ilike(games.guestConnectionId, searchTerm),
          ilike(games.hostEncryptId, searchTerm),
          ilike(games.guestEncryptId, searchTerm),
          ilike(games.seed, searchTerm),
          ilike(games.deck, searchTerm),
          sql`${games.logOwnerFinalJokers}::text ilike ${searchTerm}`,
          sql`${games.opponentFinalJokers}::text ilike ${searchTerm}`,
          sql`${games.logOwnerVouchers}::text ilike ${searchTerm}`,
          sql`${games.opponentVouchers}::text ilike ${searchTerm}`
        )
      )
    }

    if (deck) {
      filters.push(eq(games.deck, deck))
    }

    if (ruleset) {
      filters.push(eq(games.ruleset, ruleset))
    }

    if (!Number.isNaN(stake ?? Number.NaN)) {
      filters.push(eq(games.stake, stake as number))
    }

    if (winner === 'logOwner' || winner === 'opponent') {
      filters.push(eq(games.winner, winner))
    }

    const where = filters.length > 0 ? and(...filters) : undefined
    const [countRow, availableDecks, availableRulesets] = await Promise.all([
      where
        ? db
            .select({ total: sql<number>`count(*)::int` })
            .from(games)
            .where(where)
            .then((rows) => rows.at(0))
        : db
            .select({ total: sql<number>`count(*)::int` })
            .from(games)
            .then((rows) => rows.at(0)),
      getDistinctValues(games.deck),
      getDistinctValues(games.ruleset),
    ])

    const rows = await (where
      ? db
          .select()
          .from(games)
          .where(where)
          .orderBy(...buildOrderBy(sortBy, sortOrder))
          .limit(pageSize)
          .offset(offset)
      : db
          .select()
          .from(games)
          .orderBy(...buildOrderBy(sortBy, sortOrder))
          .limit(pageSize)
          .offset(offset))

    const total = Number(countRow?.total ?? 0)

    return NextResponse.json({
      data: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      availableDecks,
      availableRulesets,
    })
  } catch (error) {
    console.error('Error fetching games:', error)
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    )
  }
}
