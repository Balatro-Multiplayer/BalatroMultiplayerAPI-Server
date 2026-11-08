// An organiser's message to players in their match lobbies (the
// tournament_message RPC): which lobbies, and whose. Pure.
import { resolveBracket } from './engine/resolve'
import { type Tournament, isFakeEntrant } from './model'

export interface MessageTarget {
	matchId: string
	code: string
	players: string[]
}

// The live lobbies (open, or waiting on a disputed result) of one match, or
// of every match when matchId is null, with their real players.
export function messageTargets(t: Tournament, matchId: string | null): MessageTarget[] {
	if (!t.bracket || !t.lobbies) return []
	const resolved = resolveBracket(t.bracket, t.dropped)
	const out: MessageTarget[] = []
	for (const id of Object.keys(t.lobbies)) {
		if (matchId !== null && id !== matchId) continue
		const lobby = t.lobbies[id]
		if (lobby.status !== 'open' && lobby.status !== 'disputed') continue
		const m = resolved.matches.find((x) => x.def.id === id)
		const players = m ? m.players.filter((p): p is string => typeof p === 'string' && !isFakeEntrant(p)) : []
		out.push({ matchId: id, code: lobby.code, players })
	}
	return out
}
