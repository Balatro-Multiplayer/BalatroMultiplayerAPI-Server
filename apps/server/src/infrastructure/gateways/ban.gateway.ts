import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { playerBans, players } from '../db/schema.js'
import { banNameFor } from '../../shared/players/shown-name.js'
import type { BanType } from '../../shared/types/index.js'

export type { BanType } from '../../shared/types/index.js'

export const BAN_TYPES: readonly BanType[] = ['chat', 'queue', 'account', 'username']

export function isBanType(value: unknown): value is BanType {
	return typeof value === 'string' && BAN_TYPES.includes(value as BanType)
}

export interface BanRecord {
	id: string
	playerId: string
	banType: BanType
	expiresAt: Date | null
	issuedBy: string
	issuedAt: Date
	reason: string
	liftedAt: Date | null
	liftedBy: string | null
}

function toRecord(row: typeof playerBans.$inferSelect): BanRecord {
	return row as BanRecord
}

// A ban is active when it has not been lifted and has not expired.
const activeCondition = () =>
	and(
		isNull(playerBans.liftedAt),
		or(isNull(playerBans.expiresAt), gt(playerBans.expiresAt, sql`now()`)),
	)

/** Returns all currently-active bans for a player (any type). */
export async function getActiveBans(playerId: string): Promise<BanRecord[]> {
	const rows = await db
		.select()
		.from(playerBans)
		.where(and(eq(playerBans.playerId, playerId), activeCondition()))
	return rows.map(toRecord)
}

/** True if the player has an active ban of the given type. */
export async function hasActiveBan(
	playerId: string,
	banType: BanType,
): Promise<boolean> {
	const rows = await db
		.select({ id: playerBans.id })
		.from(playerBans)
		.where(
			and(
				eq(playerBans.playerId, playerId),
				eq(playerBans.banType, banType),
				activeCondition(),
			),
		)
		.limit(1)
	return rows.length > 0
}

/** The players among playerIds with a username ban in force. */
export async function usernameBannedAmong(playerIds: readonly string[]): Promise<Set<string>> {
	if (playerIds.length === 0) return new Set()
	const rows = await db
		.selectDistinct({ playerId: playerBans.playerId })
		.from(playerBans)
		.where(
			and(
				inArray(playerBans.playerId, [...playerIds]),
				eq(playerBans.banType, 'username'),
				activeCondition(),
			),
		)
	return new Set(rows.map((r) => r.playerId))
}

/**
 * SQL for "this player has a username ban in force", for a query that already
 * has `players` as `p` (the leaderboard).
 */
export const usernameBannedSql = sql`EXISTS (
	SELECT 1 FROM player_bans ub
	WHERE ub.player_id = p.id AND ub.ban_type = 'username' AND ub.lifted_at IS NULL
	  AND (ub.expires_at IS NULL OR ub.expires_at > now())
)`

/** The player's Ban name while a username ban is in force, else null. */
export async function banNameWhileBanned(playerId: string): Promise<string | null> {
	if (!(await hasActiveBan(playerId, 'username'))) return null
	const [row] = await db
		.select({ nakamaUserId: players.nakamaUserId })
		.from(players)
		.where(eq(players.id, playerId))
		.limit(1)
	return banNameFor({ id: playerId, nakamaUserId: row?.nakamaUserId ?? null })
}

/** Names staff see: the Steam name, or the Ban name with the real name next to it. */
export async function staffNamesOf(
	rows: readonly { id: string; nakamaUserId: string | null; steamName: string }[],
): Promise<Map<string, string>> {
	const banned = await usernameBannedAmong(rows.map((r) => r.id))
	return new Map(
		rows.map((r) => [
			r.id,
			banned.has(r.id) ? `${banNameFor({ id: r.id, nakamaUserId: r.nakamaUserId })} (${r.steamName})` : r.steamName,
		]),
	)
}

/** Lists every ban for a player — active, expired, and lifted — newest first. */
export async function listBans(playerId: string): Promise<BanRecord[]> {
	const rows = await db
		.select()
		.from(playerBans)
		.where(eq(playerBans.playerId, playerId))
		.orderBy(desc(playerBans.issuedAt))
	return rows.map(toRecord)
}

export async function insertBan(data: {
	playerId: string
	banType: BanType
	expiresAt: Date | null
	issuedBy: string
	reason: string
}, exec: DbExecutor = db): Promise<BanRecord> {
	const [row] = await exec
		.insert(playerBans)
		.values({
			playerId: data.playerId,
			banType: data.banType,
			expiresAt: data.expiresAt,
			issuedBy: data.issuedBy,
			reason: data.reason,
		})
		.returning()
	return toRecord(row!)
}

/**
 * Lifts a ban early. Returns the updated row, or null if no matching active
 * (not-yet-lifted) ban exists for that player.
 */
export async function liftBan(
	playerId: string,
	banId: string,
	liftedBy: string,
	exec: DbExecutor = db,
): Promise<BanRecord | null> {
	const [row] = await exec
		.update(playerBans)
		.set({ liftedAt: new Date(), liftedBy })
		.where(
			and(
				eq(playerBans.id, banId),
				eq(playerBans.playerId, playerId),
				isNull(playerBans.liftedAt),
			),
		)
		.returning()
	return row ? toRecord(row) : null
}

export async function getBanById(banId: string): Promise<BanRecord | null> {
	const [row] = await db.select().from(playerBans).where(eq(playerBans.id, banId)).limit(1)
	return row ? toRecord(row) : null
}

export interface EndedBan {
	id: string
	playerId: string
	banType: BanType
}

// Bans that ended (ran out or were lifted early) whose player has not been
// told yet, oldest first.
export async function listEndedBansToTell(limit = 200): Promise<EndedBan[]> {
	const rows = await db
		.select({ id: playerBans.id, playerId: playerBans.playerId, banType: playerBans.banType })
		.from(playerBans)
		.where(
			and(
				isNull(playerBans.endNotifiedAt),
				or(
					isNotNull(playerBans.liftedAt),
					and(isNotNull(playerBans.expiresAt), lte(playerBans.expiresAt, sql`now()`)),
				),
			),
		)
		.orderBy(asc(playerBans.issuedAt))
		.limit(limit)
	return rows as EndedBan[]
}

export async function markBanEndNotified(banId: string, exec: DbExecutor = db): Promise<void> {
	await exec
		.update(playerBans)
		.set({ endNotifiedAt: new Date() })
		.where(and(eq(playerBans.id, banId), isNull(playerBans.endNotifiedAt)))
}
