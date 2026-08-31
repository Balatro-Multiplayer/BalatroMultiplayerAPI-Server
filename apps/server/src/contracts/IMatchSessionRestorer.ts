import type { PlayerSession } from '../state/player.js'

export interface IMatchSessionRestorer {
	restorePlayerMatchSession(session: PlayerSession): Promise<void>
}
