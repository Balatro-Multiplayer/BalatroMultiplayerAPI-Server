import { type SQL, and, count, desc, eq, gte, ilike, isNotNull, lt, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { StaffAction, StaffActionEntry } from '../../shared/staff-log/actions.js'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { players, staffLog } from '../db/schema.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The one write every staff action makes. Pass the open transaction when the
// action itself is in one, so the entry and the action stand or fall together.
export async function recordStaffAction(exec: DbExecutor, entry: StaffActionEntry): Promise<void> {
	await exec.insert(staffLog).values({
		staffPlayerId: entry.staff.playerId,
		staffRole: entry.staff.role,
		action: entry.action,
		targetPlayerId: entry.targetPlayerId ?? null,
		itemId: entry.itemId ?? null,
		reason: entry.reason,
		detail: entry.detail ?? null,
	})
}

export interface StaffLogFilters {
	// A player id, or part of a name.
	staff?: string
	player?: string
	action?: StaffAction
	from?: Date
	// Exclusive upper bound.
	to?: Date
	page: number
	limit: number
}

// Who is reading: an admin reads all; a moderator reads their own actions and
// the actions taken on queue items.
export interface StaffLogViewer {
	playerId: string
	role: 'moderator' | 'admin'
}

export interface StaffLogRow {
	id: number
	staffPlayerId: string
	staffName: string | null
	staffRole: string
	action: string
	targetPlayerId: string | null
	targetName: string | null
	itemId: number | null
	reason: string
	detail: unknown
	at: Date
}

const staffPlayer = alias(players, 'staff_player')
const targetPlayer = alias(players, 'target_player')

export async function listStaffLog(
	viewer: StaffLogViewer,
	filters: StaffLogFilters,
): Promise<{ entries: StaffLogRow[]; total: number }> {
	const where: (SQL | undefined)[] = []
	if (viewer.role !== 'admin')
		where.push(or(eq(staffLog.staffPlayerId, viewer.playerId), isNotNull(staffLog.itemId)))
	if (filters.staff)
		where.push(
			UUID.test(filters.staff)
				? eq(staffLog.staffPlayerId, filters.staff)
				: ilike(staffPlayer.steamName, `%${filters.staff}%`),
		)
	if (filters.player)
		where.push(
			UUID.test(filters.player)
				? eq(staffLog.targetPlayerId, filters.player)
				: ilike(targetPlayer.steamName, `%${filters.player}%`),
		)
	if (filters.action) where.push(eq(staffLog.action, filters.action))
	if (filters.from) where.push(gte(staffLog.at, filters.from))
	if (filters.to) where.push(lt(staffLog.at, filters.to))
	const condition = and(...where)

	const joined = () =>
		db
			.select({
				id: staffLog.id,
				staffPlayerId: staffLog.staffPlayerId,
				staffName: staffPlayer.steamName,
				staffRole: staffLog.staffRole,
				action: staffLog.action,
				targetPlayerId: staffLog.targetPlayerId,
				targetName: targetPlayer.steamName,
				itemId: staffLog.itemId,
				reason: staffLog.reason,
				detail: staffLog.detail,
				at: staffLog.at,
			})
			.from(staffLog)
			.leftJoin(staffPlayer, eq(staffPlayer.id, staffLog.staffPlayerId))
			.leftJoin(targetPlayer, eq(targetPlayer.id, staffLog.targetPlayerId))
			.where(condition)

	const [entries, [totals]] = await Promise.all([
		joined()
			.orderBy(desc(staffLog.at), desc(staffLog.id))
			.limit(filters.limit)
			.offset((filters.page - 1) * filters.limit),
		db
			.select({ total: count() })
			.from(staffLog)
			.leftJoin(staffPlayer, eq(staffPlayer.id, staffLog.staffPlayerId))
			.leftJoin(targetPlayer, eq(targetPlayer.id, staffLog.targetPlayerId))
			.where(condition),
	])
	return { entries, total: Number(totals?.total ?? 0) }
}

