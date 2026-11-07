import type { Request } from 'express'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from './errors.js'
import { isOwnerId } from './staff-role.js'

// The owner is the player in OWNER_PLAYER_ID, always an admin.
export function isOwner(playerId: string): boolean {
	return isOwnerId(playerId)
}

export async function requireOwner(req: Request): Promise<void> {
	const playerId = req.player!.playerId
	const player = await findPlayerById(playerId)
	if (!player || !isOwner(playerId)) {
		throw new AppError('Owner privileges required', 403)
	}
}
