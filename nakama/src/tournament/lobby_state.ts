// Which match lobbies the server should close: the match is decided (its
// clock closed), its pairing was reset by a correction (no clock), or the
// tournament is over. Closing sends both players back to the tournament.
// Pure; used by lifecycle.ts (to wake the clock) and effects.ts (to close).
import type { Tournament } from './model'

export function lobbiesToClose(t: Tournament): { matchId: string; code: string }[] {
	const out: { matchId: string; code: string }[] = []
	if (!t.lobbies) return out
	for (const matchId of Object.keys(t.lobbies)) {
		const lobby = t.lobbies[matchId]
		if (lobby.status !== 'open' && lobby.status !== 'disputed') continue
		const clock = t.clock ? t.clock.matches[matchId] : undefined
		if (t.status !== 'running' || !clock || clock.phase === 'closed') out.push({ matchId, code: lobby.code })
	}
	return out
}
