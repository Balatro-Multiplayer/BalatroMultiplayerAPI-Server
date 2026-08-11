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

/**
 * Gate for joining a ranked queue. A no-op for casual game modes and a no-op when
 * ranked play is enabled (the default); rejects ranked queue requests otherwise.
 */
export function assertRankedEnabled(isRankedGameMode: boolean): void {
	if (isRankedGameMode && getConfig().rankedEnabled === false) {
		throw new AppError('Ranked matchmaking is currently disabled.', 403)
	}
}
