// The pending-death rules (a port of lib/pending_death.lua, PD.record and
// PD.decide). A player who loses their last life on a non-PvP blind X does not
// end the match at once: the other side must beat the same blind X. Pure.
//
// The blind results are not part of the ModeView: the tick reads them from
// `facts.blinds` (deaths.ts) and passes them in.

export type BlindResult = 'beaten' | 'failed'

// results[playerId][blindKey]
export interface BlindResults {
	[playerId: string]: { [blindKey: string]: BlindResult }
}

export type PendingOutcome =
	| { outcome: 'pending'; winner: null }
	| { outcome: 'win'; winner: string }
	| { outcome: 'draw'; winner: null }

// The recorded result of a player on a blind; none for a death with no blind.
function resultOn(
	results: BlindResults,
	playerId: string,
	key: string | null,
): BlindResult | undefined {
	return key === null ? undefined : results[playerId]?.[key]
}

// pending = the dead player and the blind they died on;
// opponent = whether the opponent is still in the match and their lives left.
export function decidePending(
	pending: { playerId: string; blindKey: string },
	opponentId: string,
	results: BlindResults,
	opponent: RosterSeat,
): PendingOutcome {
	const result = results[opponentId]?.[pending.blindKey]
	if (result === 'beaten') return { outcome: 'win', winner: opponentId }
	if (opponent.lives <= 0) return { outcome: 'draw', winner: null }
	// Failing the blind costs a life; one who still has lives left wins.
	if (result === 'failed') return { outcome: 'win', winner: opponentId }
	if (!opponent.present || opponent.forfeited)
		return { outcome: 'win', winner: pending.playerId }
	return { outcome: 'pending', winner: null }
}

// Matches of 3 or more players: several pending deaths can exist at once, one
// per dead player. outBefore[id] is true for every player already out of lives
// when this one died.
export interface PendingDeath {
	playerId: string
	blindKey: string | null
	outBefore: { [playerId: string]: boolean }
}

// `lives` is the seat's real lives; a forfeiter keeps them and is flagged, and
// the rules below read the flag.
export interface RosterSeat {
	present: boolean
	lives: number
	forfeited: boolean
}

const standing = (seat: RosterSeat): boolean =>
	seat.present && seat.lives > 0 && !seat.forfeited

export interface Roster {
	[playerId: string]: RosterSeat
}

export function findPending(
	pendings: readonly PendingDeath[],
	playerId: string,
): PendingDeath | null {
	return pendings.find((p) => p.playerId === playerId) ?? null
}

// Adds a pending death for playerId once. Returns the list.
export function addPending(
	pendings: readonly PendingDeath[],
	playerId: string,
	key: string | null,
	outBefore: { [playerId: string]: boolean } = {},
): PendingDeath[] {
	if (findPending(pendings, playerId)) return [...pendings]
	return [...pendings, { playerId, blindKey: key, outBefore }]
}

function hasResult(
	results: BlindResults,
	playerId: string,
	key: string | null,
): boolean {
	// A death with no blind waits on no one.
	return key === null || results[playerId]?.[key] !== undefined
}

// True when every pending death has heard from every other player: a result
// for its blind, elimination or leaving.
export function manyResolved(
	pendings: readonly PendingDeath[],
	results: BlindResults,
	roster: Roster,
): boolean {
	for (const pending of pendings)
		for (const [id, seat] of Object.entries(roster))
			if (
				id !== pending.playerId &&
				standing(seat) &&
				!hasResult(results, id, pending.blindKey)
			)
				return false
	return true
}

// Places for the roster once the result is final: tied players share a place, the next
// place skips the tied count (1, 2, 2, 4). A player ranks by a key, lower is
// better. The last survivor starts at 0 and everyone else at 1. A player who
// died on a blind or failed it moves to 1 plus the number of such blinds. A
// player who was out before a death (or left without a result for its blind)
// drops 2 more for each such death.
export function places(
	pendings: readonly PendingDeath[],
	results: BlindResults,
	roster: Roster,
): { [playerId: string]: number } {
	const ids = Object.keys(roster)
	const keys: { [playerId: string]: number } = {}
	for (const [id, seat] of Object.entries(roster)) {
		let key = standing(seat) ? 0 : 1
		let involved = 0
		let dropped = 0
		for (const pending of pendings) {
			const result = resultOn(results, id, pending.blindKey)
			if (id === pending.playerId || result === 'failed') involved += 1
			else if (
				result === undefined &&
				(pending.outBefore[id] === true || !seat.present)
			)
				dropped += 1
		}
		if (involved > 0) key = Math.max(key, 1 + involved)
		keys[id] = key + 2 * dropped
	}
	const out: { [playerId: string]: number } = {}
	for (const id of ids)
		out[id] = 1 + ids.filter((other) => keys[other] < keys[id]).length
	return out
}

// Manhunt and Teams: a whole side is pending on key. The players of the other
// side must beat the same blind. WIN means the other side wins: any one of its
// players beat the blind. DRAW means every one of them failed it, is out of
// lives or has left without beating it.
export function decideTeam(
	key: string,
	results: BlindResults,
	roster: Roster,
): 'pending' | 'win' | 'draw' {
	let open = false
	for (const [id, seat] of Object.entries(roster)) {
		const result = results[id]?.[key]
		if (result === 'beaten') return 'win'
		if (result === undefined && standing(seat)) open = true
	}
	return open ? 'pending' : 'draw'
}
