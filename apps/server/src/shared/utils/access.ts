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

/**
 * Gate for joining the casual (non-ranked) queue. A no-op for ranked game
 * modes (see assertRankedEnabled for that gate) and a no-op when casual play
 * is enabled (the default); rejects casual queue requests otherwise.
 */
export function assertCasualQueueEnabled(isRankedGameMode: boolean): void {
	if (!isRankedGameMode && getConfig().casualQueueEnabled === false) {
		throw new AppError('Casual matchmaking is currently disabled.', 403)
	}
}

/**
 * Gate for manually creating a lobby (POST /lobbies). Does not affect lobbies
 * the matchmaking system auto-creates on match found -- see
 * assertRankedEnabled/assertCasualQueueEnabled for that.
 */
export function assertLobbyCreationEnabled(): void {
	if (getConfig().lobbyCreationEnabled === false) {
		throw new AppError('Lobby creation is currently disabled.', 403)
	}
}

/**
 * Gate for sending a chat message. A no-op when chat is enabled; rejects
 * otherwise. Per-account chatEnabled/chatBlocked and active bans are checked
 * separately by the caller.
 */
export function assertChatEnabled(): void {
	if (!getConfig().chatEnabled) {
		throw new AppError('Chat is not enabled', 403)
	}
}
