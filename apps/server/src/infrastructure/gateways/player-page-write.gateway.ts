import type { Ladder } from '../../features/strikes/ladder.js'
import type { judgeOnLadder } from '../../features/strikes/strike.service.js'
import type { LoggedRole } from '../../shared/staff-log/actions.js'
import { db } from '../db/index.js'
import { liftWarning } from './appeal.gateway.js'
import { type PlayerNoteRecord, insertPlayerNote } from './player-page.gateway.js'
import { recordStaffAction } from './staff-log.gateway.js'
import { insertStrike } from './strike.gateway.js'
import { type WarningRecord, insertWarning } from './warning.gateway.js'

// The staff player page's writes. Each one stores the change and its staff
// log entry in one transaction, so neither stands without the other.

export interface PageStaff {
	playerId: string
	role: LoggedRole
}

export function saveNoteWithLog(
	staff: PageStaff,
	playerId: string,
	note: string,
): Promise<PlayerNoteRecord> {
	// The note is the reason: it is what the staff log shows for the action.
	return db.transaction(async (tx) => {
		const row = await insertPlayerNote(tx, { playerId, note, authorId: staff.playerId })
		await recordStaffAction(tx, {
			staff,
			action: 'note',
			targetPlayerId: playerId,
			reason: note,
		})
		return row
	})
}

export interface PageWarning {
	playerId: string
	message: string
	reason: string
	ladder: Ladder
	strike: Awaited<ReturnType<typeof judgeOnLadder>>
	now: Date
}

export function saveWarningWithLog(staff: PageStaff, warning: PageWarning): Promise<WarningRecord> {
	return db.transaction(async (tx) => {
		const row = await insertWarning(tx, {
			playerId: warning.playerId,
			itemId: null,
			message: warning.message,
			issuedBy: `${staff.role}:${staff.playerId}`,
		})
		await insertStrike(tx, {
			playerId: warning.playerId,
			ladder: warning.ladder,
			banId: null,
			warningId: row.id,
			recommendedStep: warning.strike.recommended,
			appliedStep: warning.strike.applied,
			deviationReason: warning.strike.deviationReason,
			issuedAt: warning.now,
		})
		await recordStaffAction(tx, {
			staff,
			action: 'warn',
			targetPlayerId: warning.playerId,
			reason: warning.reason,
			detail: {
				warningId: row.id,
				message: warning.message,
				strike: { ladder: warning.ladder, ...warning.strike },
			},
		})
		return row
	})
}

// Lifts a warning that is still standing; a lifted warning stops counting as
// a strike. False when it was already lifted.
export function liftWarningWithLog(
	staff: PageStaff,
	playerId: string,
	warningId: string,
	reason: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const lifted = await liftWarning(tx, warningId, `${staff.role}:${staff.playerId}`)
		if (!lifted) return false
		await recordStaffAction(tx, {
			staff,
			action: 'lift_warning',
			targetPlayerId: playerId,
			reason,
			detail: { warningId },
		})
		return true
	})
}
