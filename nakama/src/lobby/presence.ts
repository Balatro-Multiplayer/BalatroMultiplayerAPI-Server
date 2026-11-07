// The seat changes of a running game, kept for the finished run's record so a
// later look can tell a leave from a disconnect, a kick or a timeout.
import type { PresenceEvent } from './protocol'
import type { Lobby } from './state'

// A bound on match state: a seat that flaps all game cannot grow it forever.
export const PRESENCE_CAP = 400

// The lobby with `event` added to its running game. Nothing is kept with no
// game running: the record is per game.
export function withPresence(lobby: Lobby, event: PresenceEvent): Lobby {
	if (!lobby.game.started) return lobby
	const kept = (lobby.game.presence ?? []).concat([event]).slice(-PRESENCE_CAP)
	return { ...lobby, game: { ...lobby.game, presence: kept } }
}
