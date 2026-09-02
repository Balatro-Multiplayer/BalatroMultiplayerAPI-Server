import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from './errors.js'

/**
 * Extracted from config.route.ts's original private helper (§6.4) --
 * service-queue.route.ts (destructive queue actions) is now a second call
 * site, matching the same "admin-only, not just admin-or-moderator" gate
 * for self-inflicted-blast-radius actions.
 */
export async function requireAdmin(req: import('express').Request): Promise<void> {
	const actingPlayer = await findPlayerById(req.player!.playerId)
	if (!actingPlayer?.privileges.includes('admin')) {
		throw new AppError('Admin privileges required', 403)
	}
}
