import type { Request } from 'express'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { staffRoleOf } from '../../shared/utils/staff-role.js'
import type { Staff } from './dispatcher.js'

// The signed-in staff member and their role, or null for anyone else.
export async function staffOf(req: Request): Promise<Staff | null> {
	if (!req.player) return null
	const { playerId } = req.player
	const player = await findPlayerById(playerId)
	const role = player ? staffRoleOf(playerId, player.privileges) : null
	return role ? { playerId, role } : null
}
