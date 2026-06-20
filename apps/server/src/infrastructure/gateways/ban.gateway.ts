import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { playerBans } from '../db/schema.js'

export type BanType = 'chat' | 'queue' | 'account'

export const BAN_TYPES: readonly BanType[] = ['chat', 'queue', 'account']

export function isBanType(value: unknown): value is BanType {
	return typeof value === 'string' && BAN_TYPES.includes(value as BanType)
}

export interface BanRecord {
	id: string
	playerId: string
	banType: string
	expiresAt: Date | null
	issuedBy: string
	issuedAt: Date
	reason: string
	liftedAt: Date | null
	liftedBy: string | null
}

// A ban is active when it has not been lifted and has not expired.
const activeCondition = () =>
	and(
		isNull(playerBans.liftedAt),
		or(isNull(playerBans.expiresAt), gt(playerBans.expiresAt, sql`now()`)),
	)

/** Returns all currently-active bans for a player (any type). */
export async function getActiveBans(playerId: string): Promise<BanRecord[]> {
	return db
		.select()
		.from(playerBans)
		.where(and(eq(playerBans.playerId, playerId), activeCondition()))
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
	return db
		.select()
		.from(playerBans)
		.where(eq(playerBans.playerId, playerId))
		.orderBy(desc(playerBans.issuedAt))
}

export async function insertBan(data: {
	playerId: string
	banType: BanType
	expiresAt: Date | null
	issuedBy: string
	reason: string
}): Promise<BanRecord> {
	const [row] = await db
		.insert(playerBans)
		.values({
			playerId: data.playerId,
			banType: data.banType,
			expiresAt: data.expiresAt,
			issuedBy: data.issuedBy,
			reason: data.reason,
		})
		.returning()
	return row!
}

/**
 * Lifts a ban early. Returns the updated row, or null if no matching active
 * (not-yet-lifted) ban exists for that player.
 */
export async function liftBan(
	playerId: string,
	banId: string,
	liftedBy: string,
): Promise<BanRecord | null> {
	const [row] = await db
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
	return row ?? null
}
