// The appeal rules as pure functions: when a player may appeal, who may decide
// an appeal, and what shortening a punishment means.
import { expiresAtOf } from '../service-queue/durations.js'
import type { Duration, StaffRole } from '../service-queue/types.js'

export const APPEAL_STATUSES = ['open', 'denied', 'granted'] as const
export type AppealStatus = (typeof APPEAL_STATUSES)[number]

// After a denial the player waits this long before the same punishment can be appealed again.
export const APPEAL_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000

export interface AppealFacts {
	status: AppealStatus
	decidedAt: Date | null
}

export type AppealRefusal =
	| { code: 'open' }
	| { code: 'granted' }
	| { code: 'cooling_down'; availableAt: Date }

// The appeals already made for one punishment (or for the network ban), then
// whether another may be made now. A player gets one appeal for each punishment:
// a granted one ends it, a denied one reopens it after the cooldown.
export function canSubmitAppeal(
	history: readonly AppealFacts[],
	now: Date,
): { ok: true } | { ok: false; refusal: AppealRefusal } {
	if (history.some((a) => a.status === 'open')) return { ok: false, refusal: { code: 'open' } }
	if (history.some((a) => a.status === 'granted')) return { ok: false, refusal: { code: 'granted' } }
	const denials = history.flatMap((a) => (a.decidedAt ? [a.decidedAt.getTime()] : []))
	if (denials.length === 0) return { ok: true }
	const availableAt = new Date(Math.max(...denials) + APPEAL_COOLDOWN_MS)
	return availableAt > now ? { ok: false, refusal: { code: 'cooling_down', availableAt } } : { ok: true }
}

// What a staff member may do with an appeal. A moderator denies; only an admin
// grants. Nobody below admin acts on an appeal of a punishment they gave.
// `issuedBy` is the punishment's 'role:playerId' actor, or null for a network ban.
export function decisionsFor(
	staff: { playerId: string; role: StaffRole },
	issuedBy: string | null,
): { deny: boolean; grant: boolean } {
	if (staff.role === 'admin') return { deny: true, grant: true }
	const own = issuedBy !== null && issuedBy.slice(issuedBy.indexOf(':') + 1) === staff.playerId
	return { deny: !own, grant: false }
}

// The new end when a granted appeal shortens a punishment: a preset length from
// now. It must end before the current end (null: it never ends).
export function shortenedEnd(
	duration: Duration,
	currentEnd: Date | null,
	now: Date,
): { ok: true; expiresAt: Date } | { ok: false } {
	const expiresAt = expiresAtOf(duration, now)
	if (!expiresAt) return { ok: false }
	if (currentEnd && expiresAt >= currentEnd) return { ok: false }
	return { ok: true, expiresAt }
}
