import type { Request } from 'express'
import { db } from '../../infrastructure/db/index.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import { type StaffActionEntry, parseReason } from '../../shared/staff-log/actions.js'
import { AppError } from '../../shared/utils/errors.js'
import { staffOf } from '../service-queue/staff.js'

// The reason a staff action carries, read from the request body. A request
// with no usable reason is a 400, so check it before the action runs.
export function requireReason(req: Request): string {
	const checked = parseReason((req.body as { reason?: unknown } | undefined)?.reason)
	if (!checked.ok) throw new AppError(checked.message, 400)
	return checked.reason
}

// Writes the staff log entry for an action the signed-in staff member took.
export async function logStaffAction(
	req: Request,
	entry: Omit<StaffActionEntry, 'staff'>,
): Promise<void> {
	const staff = await staffOf(req)
	if (!staff) throw new AppError('Staff only', 403)
	await recordStaffAction(db, { ...entry, staff })
}
