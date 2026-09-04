import { createSession, getSession, type PlayerSession } from '../../state/index.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { dbPlayerToSessionInit } from './auth.service.js'

/**
 * Return the player's in-memory session, rebuilding it from the durable player
 * record when it is missing.
 *
 * Sessions are in-memory only, so they are lost on a server restart or when the
 * EMQX disconnect webhook reaps a non-lobby player — yet the player's JWT is
 * stateless and outlives them. Without this, any session-gated route would 401
 * a still-authenticated player with no way to recover (see issue #32). Falling
 * back to the DB lets a known player transparently continue; a player who does
 * not exist in the DB at all is genuinely unknown and is rejected.
 */
export async function ensureSession(playerId: string): Promise<PlayerSession> {
	const existing = getSession(playerId)
	if (existing) return existing

	const dbPlayer = await findPlayerById(playerId)
	if (!dbPlayer) throw new AppError('Player not found', 404)

	return createSession(dbPlayer.steamName, dbPlayerToSessionInit(dbPlayer))
}
