import { getConfig } from '../../state/config.js'
import type { PlayerSession } from '../../state/player.js'
import { AppError } from './errors.js'

/**
 * Gate for "play" actions (creating a lobby, joining matchmaking). When the server
 * is in testing mode, only players holding the 'tester' privilege are allowed
 * through; everyone else is rejected. A no-op when testing mode is off.
 */
export function assertCanPlay(session: PlayerSession): void {
	if (getConfig().testingMode && !session.privileges.includes('tester')) {
		throw new AppError(
			'The server is in testing mode. Tester access is required to play.',
			403,
		)
	}
}
