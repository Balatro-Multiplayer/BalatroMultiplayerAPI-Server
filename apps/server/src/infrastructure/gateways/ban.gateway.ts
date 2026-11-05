import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { playerBans } from '../db/schema.js'
import type { BanType } from '../../shared/types/index.js'

export type { BanType } from '../../shared/types/index.js'

export const BAN_TYPES: readonly BanType[] = ['chat', 'queue', 'account']

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
