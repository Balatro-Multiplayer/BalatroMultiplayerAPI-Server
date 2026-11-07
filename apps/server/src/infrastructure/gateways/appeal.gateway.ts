import { and, desc, eq, isNull } from 'drizzle-orm'
import type { AppealDecision, AppealRow, NewAppeal, PunishmentRef } from '../../features/appeals/appeals.service.js'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { appeals, playerBans, playerWarnings } from '../db/schema.js'

function toRow(row: typeof appeals.$inferSelect): AppealRow {
	return { ...row, networkBanIds: (row.networkBanIds as string[]) ?? [] } as AppealRow
}

export async function insertAppeal(data: NewAppeal, exec: DbExecutor = db): Promise<AppealRow> {
	const [row] = await exec.insert(appeals).values(data).returning()
	return toRow(row!)
}

export async function getAppealById(id: string): Promise<AppealRow | null> {
	const [row] = await db.select().from(appeals).where(eq(appeals.id, id)).limit(1)
	return row ? toRow(row) : null
}

// The appeals a player made for one punishment, or (null) for a network ban.
export async function appealHistory(playerId: string, punishmentId: string | null): Promise<AppealRow[]> {
	const rows = await db
		.select()
		.from(appeals)
		.where(
			and(
				eq(appeals.playerId, playerId),
				punishmentId === null ? isNull(appeals.punishmentId) : eq(appeals.punishmentId, punishmentId),
			),
		)
		.orderBy(desc(appeals.createdAt))
	return rows.map(toRow)
}

// Every appeal a player made, newest first.
export async function listAppealsOf(playerId: string): Promise<AppealRow[]> {
	const rows = await db.select().from(appeals).where(eq(appeals.playerId, playerId)).orderBy(desc(appeals.createdAt))
	return rows.map(toRow)
}

// Closes an open appeal with its decision. False when it was not open.
export async function settleAppealRow(exec: DbExecutor, id: string, decision: AppealDecision): Promise<boolean> {
	const rows = await exec
		.update(appeals)
		.set(decision)
		.where(and(eq(appeals.id, id), eq(appeals.status, 'open')))
		.returning({ id: appeals.id })
	return rows.length > 0
}

// A ban or a warning by id (the two tables never share an id).
export async function findPunishmentRef(id: string): Promise<PunishmentRef | null> {
	const [ban] = await db.select().from(playerBans).where(eq(playerBans.id, id)).limit(1)
	if (ban)
		return {
			id: ban.id,
			playerId: ban.playerId,
			kind: 'ban',
			banType: ban.banType as PunishmentRef['banType'],
			issuedBy: ban.issuedBy,
			reason: ban.reason,
			expiresAt: ban.expiresAt,
			liftedAt: ban.liftedAt,
		}
	const [warning] = await db.select().from(playerWarnings).where(eq(playerWarnings.id, id)).limit(1)
	return warning
		? {
				id: warning.id,
				playerId: warning.playerId,
				kind: 'warning',
				banType: null,
				issuedBy: warning.issuedBy,
				reason: warning.message,
				expiresAt: null,
				liftedAt: warning.liftedAt,
			}
		: null
}

export async function liftWarning(exec: DbExecutor, id: string, liftedBy: string): Promise<boolean> {
	const rows = await exec
		.update(playerWarnings)
		.set({ liftedAt: new Date(), liftedBy })
		.where(and(eq(playerWarnings.id, id), isNull(playerWarnings.liftedAt)))
		.returning({ id: playerWarnings.id })
	return rows.length > 0
}

// A new, earlier end for a ban that has not been lifted.
export async function setBanEnd(exec: DbExecutor, id: string, expiresAt: Date): Promise<boolean> {
	const rows = await exec
		.update(playerBans)
		.set({ expiresAt })
		.where(and(eq(playerBans.id, id), isNull(playerBans.liftedAt)))
		.returning({ id: playerBans.id })
	return rows.length > 0
}
