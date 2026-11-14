// The pending deaths of a refereed game (R11, R21, R32, R45, R53): a last life
// lost on a non-PvP blind waits on what the others did on the same blind. This maps the
// referee state to pending.ts (the rules) and back; the tick (lives.ts) calls
// `openDeath` when a life is lost and `settlePending` once per step.
import { aliveIds } from './modes/common'
import type { Mode } from './modes/types'
import {
	type BlindResults,
	type PendingDeath,
	type Roster,
	addPending,
	decidePending,
	decideTeam,
	manyResolved,
	places,
} from './pending'
import { withResult, withTeamResult } from './result'
import {
	type PvpResult,
	type PvpTeam,
	type RefereeState,
	inRunIgnoringLives,
	withMemo,
} from './state'

// R11, R21: a duel's last life lost on a non-PvP blind waits on the opponent.
function withDuelPending(
	state: RefereeState,
	id: string,
	key: string,
): RefereeState {
	const opponent = Object.keys(state.lives.players).find((o) => o !== id)
	if (opponent === undefined) return state
	return {
		...state,
		lives: {
			...state.lives,
			pending: [
				...state.lives.pending,
				{ playerId: id, blindKey: key, waitsOn: [opponent] },
			],
		},
	}
}

// R32 (begin_many_pending_death): the same in a game of 3+ players. The death
// waits on every other player still in the run, and a record of it (with who
// was already out) is kept for the places.
function withManyDeath(
	state: RefereeState,
	id: string,
	key: string | null,
): RefereeState {
	const others = Object.keys(state.lives.players).filter((o) => o !== id)
	const outBefore: { [playerId: string]: boolean } = {}
	// Already out is what rosterOf reads: no lives left, or forfeited (a forfeiter
	// keeps their lives).
	for (const o of others) {
		const seat = state.lives.players[o]
		if (seat.lives <= 0 || seat.forfeited) outBefore[o] = true
	}
	const recorded = withMemo(state, {
		deaths: addPending(state.facts.deaths, id, key, outBefore),
	})
	// A server run-out (no blind) is a record for the places and waits on no one.
	if (key === null) return recorded
	return {
		...recorded,
		lives: {
			...recorded.lives,
			pending: [
				...recorded.lives.pending,
				{
					playerId: id,
					blindKey: key,
					waitsOn: others.filter((o) =>
						inRunIgnoringLives(state.lives.players[o]),
					),
				},
			],
		},
	}
}

// The side that wins when `team` is beaten.
function otherSide(team: PvpTeam | undefined): PvpTeam | null {
	switch (team) {
		case 'A':
			return 'B'
		case 'B':
			return 'A'
		case 'RUNNER':
			return 'HUNTER'
		case 'HUNTER':
			return 'RUNNER'
		default:
			return null
	}
}

// The members of `team` still in the run, in id order.
function membersInRun(state: RefereeState, team: PvpTeam): string[] {
	return Object.keys(state.lives.players)
		.filter(
			(id) =>
				state.teams.teams[id] === team &&
				inRunIgnoringLives(state.lives.players[id]),
		)
		.sort()
}

// R45 (begin_team_pending_death): only a dying Runner opens one in Manhunt, a
// Hunter at 0 is simply out; in Teams the player whose loss emptied the pool
// does. One at a time, and it waits on the other side's members in the run.
function withTeamDeath(
	state: RefereeState,
	mode: Mode,
	id: string,
	key: string,
): RefereeState {
	const team = state.teams.teams[id]
	const other = otherSide(team)
	if (other === null || state.lives.pending.length > 0) return state
	if (mode.opensSideDeath && !mode.opensSideDeath(state, id)) return state
	return {
		...state,
		lives: {
			...state.lives,
			pending: [
				{ playerId: id, blindKey: key, waitsOn: membersInRun(state, other) },
			],
		},
	}
}

// A blind is a PvP blind for `id` when a round they started in was played on it:
// the tick keeps one key per round a player started in (the Boss they Readied on),
// and that list is the one source of "a PvP blind".
export function onPvpBlind(
	state: RefereeState,
	id: string,
	blindKey: string,
): boolean {
	const keys = state.facts.pvpBlinds[id]
	return keys?.includes(blindKey) === true
}

// The tick calls this when `id` lost their last life on event `key` (a blindKey,
// "pvp:<roundId>", or null for a server-made run-out, whose blind is unknown). A
// PvP loss and a loss on a PvP blind open nothing: a PvP blind is answered by
// nobody (no client reports pvp.blind for it), so the player is simply out. Any
// other death is recorded as the mode's death policy says. A null key has no blind
// to wait on and opens no pending death: Royale keeps the record for the places, a
// duel and a side mode settle from the standings.
export function openDeath(
	state: RefereeState,
	mode: Mode,
	id: string,
	key: string | null,
): RefereeState {
	if (key !== null && (key.startsWith('pvp:') || onPvpBlind(state, id, key)))
		return state
	switch (mode.deathPolicy) {
		case 'opponent':
			return key === null ? state : withDuelPending(state, id, key)
		case 'everyone':
			return withManyDeath(state, id, key)
		case 'side':
			return key === null ? state : withTeamDeath(state, mode, id, key)
		case 'none':
			return state
	}
}

// The blind results the pending rules read: a failure is final, which the
// merged record already holds.
function blindResultsOf(state: RefereeState): BlindResults {
	const results: BlindResults = {}
	for (const id of Object.keys(state.facts.blinds)) {
		results[id] = {}
		for (const key of Object.keys(state.facts.blinds[id]))
			results[id][key] = state.facts.blinds[id][key].beaten
				? 'beaten'
				: 'failed'
	}
	return results
}

// What the pending rules read of the lobby seats: who is still there and with
// how many lives. A forfeiter keeps the lives they had and is flagged; the pending
// rules read the flag (pending.ts).
function rosterOf(state: RefereeState): Roster {
	const roster: Roster = {}
	for (const [id, seat] of Object.entries(state.lives.players))
		roster[id] = {
			present: !seat.left,
			lives: seat.lives,
			forfeited: seat.forfeited,
		}
	return roster
}

// `lives.pending` shows only the deaths that still wait on someone.
function withWaiting(
	state: RefereeState,
	deaths: PendingDeath[],
	results: BlindResults,
	roster: Roster,
): RefereeState {
	const waiting = new Set(
		deaths
			.filter((death) => !manyResolved([death], results, roster))
			.map((death) => death.playerId),
	)
	const pending = state.lives.pending.filter((p) => waiting.has(p.playerId))
	if (pending.length === state.lives.pending.length) return state
	return { ...state, lives: { ...state.lives, pending } }
}

// R32 (settle_many_pending): once one player or none is left and every death has
// heard from every other player, the game ends with the places pending.ts works
// out: a win when exactly one player holds place 1, else a draw.
function settleMany(state: RefereeState): RefereeState {
	const deaths = state.facts.deaths
	if (state.result.kind !== null || deaths.length === 0) return state
	const results = blindResultsOf(state)
	const roster = rosterOf(state)
	const next = withWaiting(state, deaths, results, roster)
	if (aliveIds(next).length > 1 || !manyResolved(deaths, results, roster))
		return next
	const ids = Object.keys(next.lives.players).sort()
	const placeOf = places(deaths, results, roster)
	const first = ids.filter((id) => placeOf[id] === 1)
	const result: PvpResult = {
		runId: next.rules.runId,
		kind: first.length === 1 ? 'win' : 'draw',
		winnerId: first.length === 1 ? first[0] : null,
		winnerTeam: null,
		places: ids.map((playerId) => ({ playerId, place: placeOf[playerId] })),
	}
	return { ...next, result }
}

// PD.decide for a duel's pending deaths.
function settleDuel(state: RefereeState): RefereeState {
	if (state.result.kind !== null) return state
	const results = blindResultsOf(state)
	const waiting = state.lives.pending
	for (let i = 0; i < waiting.length; i++) {
		const pending = waiting[i]
		const opponentId = Object.keys(state.lives.players).find(
			(id) => id !== pending.playerId,
		)
		if (opponentId === undefined) continue
		const opponent = state.lives.players[opponentId]
		const decided = decidePending(pending, opponentId, results, {
			present: !opponent.left,
			lives: opponent.lives,
			forfeited: opponent.forfeited,
		})
		if (decided.outcome === 'pending') continue
		const resolved: RefereeState = {
			...state,
			lives: {
				...state.lives,
				pending: waiting.filter((_, at) => at !== i),
			},
		}
		return decided.outcome === 'win'
			? withResult(resolved, 'win', decided.winner)
			: withResult(resolved, 'draw', null)
	}
	return state
}

// R45 (resolve_team_pending): the other side's roster and the blind results go
// to decideTeam. One of them beating the blind wins it for their side; all
// failing, out of lives or gone is a draw.
function settleTeam(state: RefereeState): RefereeState {
	const pending = state.lives.pending[0]
	if (state.result.kind !== null || pending === undefined) return state
	const winner = otherSide(state.teams.teams[pending.playerId])
	if (winner === null) return state
	const roster: Roster = {}
	const all = rosterOf(state)
	for (const id of Object.keys(all))
		if (state.teams.teams[id] === winner) roster[id] = all[id]
	const outcome = decideTeam(pending.blindKey, blindResultsOf(state), roster)
	if (outcome === 'pending') return state
	const resolved: RefereeState = {
		...state,
		lives: { ...state.lives, pending: state.lives.pending.slice(1) },
	}
	return withTeamResult(resolved, outcome, outcome === 'win' ? winner : null)
}

// The pending deaths of the mode's death policy are settled here.
export function settlePending(state: RefereeState, mode: Mode): RefereeState {
	switch (mode.deathPolicy) {
		case 'opponent':
			return settleDuel(state)
		case 'everyone':
			return settleMany(state)
		case 'side':
			return settleTeam(state)
		case 'none':
			return state
	}
}

// One expiry batch is one moment: the server run-outs charged together (the death
// records from index `from` on) do not count each other as out before, so the order
// the ids were charged in never ranks them. `before` is the state ahead of the batch;
// whoever was already out then still counts.
export function asOneMoment(
	state: RefereeState,
	before: RefereeState,
	from: number,
	batch: readonly string[],
): RefereeState {
	const deaths = state.facts.deaths
	if (deaths.length <= from) return state
	const alreadyOut = (id: string): boolean => {
		const seat = before.lives.players[id]
		return seat.lives <= 0 || seat.forfeited
	}
	const simultaneous = batch.filter((id) => !alreadyOut(id))
	return withMemo(state, {
		deaths: deaths.map((death, at) => {
			if (at < from) return death
			const outBefore = { ...death.outBefore }
			for (const id of simultaneous) delete outBefore[id]
			return { ...death, outBefore }
		}),
	})
}
