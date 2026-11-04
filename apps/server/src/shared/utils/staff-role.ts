// The one staff role check. Every staff route and the privilege list the
// website reads go through it, so the owner rule and the role order live here
// and nowhere else.
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { env } from '../../env.js'
import { type StaffRole, roleOf } from '../../features/service-queue/types.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from './errors.js'

const RANK: Readonly<Record<StaffRole, number>> = { moderator: 0, admin: 1 }

// The owner is the player in OWNER_PLAYER_ID. With no id set nobody is.
export function isOwnerId(
	playerId: string,
	ownerId: string = env.OWNER_PLAYER_ID,
): boolean {
	return ownerId !== '' && playerId === ownerId
}

// The owner is always an admin, even with an empty privilege list.
export function staffRoleOf(
	playerId: string,
	privileges: readonly string[],
	ownerId: string = env.OWNER_PLAYER_ID,
): StaffRole | null {
	return isOwnerId(playerId, ownerId) ? 'admin' : roleOf(privileges)
}

// The privileges a player holds, with the owner's admin added.
export function effectivePrivileges(
	playerId: string,
	privileges: readonly string[],
	ownerId: string = env.OWNER_PLAYER_ID,
): string[] {
	return isOwnerId(playerId, ownerId) && !privileges.includes('admin')
		? [...privileges, 'admin']
		: [...privileges]
}

export function roleMeetsMinimum(
	role: StaffRole | null,
	least: StaffRole,
): boolean {
	return role !== null && RANK[role] >= RANK[least]
}

// The signed-in player's role, read fresh from the database so a grant or a
// revoke applies at once. Null for anyone who is not staff.
export async function currentStaffRole(
	req: Request,
): Promise<StaffRole | null> {
	if (!req.player) return null
	const player = await findPlayerById(req.player.playerId)
	return player ? staffRoleOf(req.player.playerId, player.privileges) : null
}

export async function requireRole(
	req: Request,
	least: StaffRole,
): Promise<StaffRole> {
	const role = await currentStaffRole(req)
	if (role === null || !roleMeetsMinimum(role, least)) {
		throw new AppError(
			least === 'admin' ? 'Admin privileges required' : 'Forbidden',
			403,
		)
	}
	return role
}

// Router-level guard: the request goes on only for a player with this role or above.
export function roleGuard(least: StaffRole): RequestHandler {
	return (req: Request, _res: Response, next: NextFunction) => {
		requireRole(req, least).then(() => next(), next)
	}
}

// Identity data a moderator never receives: Steam and Discord hashes and the
// linked Discord account. (Network data has its own admin-only route.)
const IDENTITY_FIELDS = [
	'steamIdHash',
	'discordIdHash',
	'discordUsername',
] as const

export function redactPlayerFor<T extends object>(
	role: StaffRole | null,
	player: T,
): Omit<T, (typeof IDENTITY_FIELDS)[number]> | T {
	if (role === 'admin') return player
	const copy: Record<string, unknown> = {
		...(player as Record<string, unknown>),
	}
	for (const field of IDENTITY_FIELDS) delete copy[field]
	return copy as Omit<T, (typeof IDENTITY_FIELDS)[number]>
}
