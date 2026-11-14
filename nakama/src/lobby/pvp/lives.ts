// The life ledger of a refereed game (docs/pvp-match.md sections 4 and 6): the one
// writer of every life change. A life is charged (a player's own, or a team's
// pool), gained (a voucher), or a player is put out of the run (a forfeit or a left
// seat) or out of hands; a loss of the last life opens a pending death
// (deaths.ts). `consumeFacts` reads the facts the reducers logged (facts.ts) and
// applies each one here, once. Mode hooks only name losers and gainers; they never
// change a life. Pure: plain state in, plain state out.
import { onPvpBlind, openDeath } from './deaths'
import { handsDone } from './modes/common'
import type { LifePool, Mode, VoucherFact } from './modes/types'
import {
	type PvpLifePlayer,
	type RefereeState,
	inRunIgnoringLives,
	withMemo,
	withView,
} from './state'

function withSeat(
	state: RefereeState,
	id: string,
	seat: PvpLifePlayer,
): RefereeState {
	return {
		...state,
		lives: {
			...state.lives,
			players: { ...state.lives.players, [id]: seat },
		},
	}
}

// The one writer of a life loss. `key` is the event key (a blindKey, or
// "pvp:<roundId>", or null when the server made the run-out and does not know the
// blind). `guardKey` is the blind the loss is guarded on, or null for
// an unguarded loss: a guarded loss is spent once per (player, blind), so a
// failed round on the blind a PvP round was lost on costs nothing more
// (R2); an unguarded one (an ante-timer
// run-out) always costs and leaves the guard alone (R3). The loss of the last
// life on a non-PvP blind opens a pending death (R11, R21, R32).
function loseLife(
	state: RefereeState,
	mode: Mode,
	id: string,
	key: string | null,
	guardKey: string | null,
): RefereeState {
	const seat = state.lives.players[id]
	if (!seat || seat.lives <= 0 || !inRunIgnoringLives(seat)) return state
	// A player with no guarded blind yet has no entry in the map: a structural miss.
	const spent = state.facts.guarded[id] ?? []
	// A PvP loss is blocked only when a roundLost already charged a life on the blind
	// (a `seat.events` entry for the key), not when one was merely recorded. An
	// earlier PvP loss spent the same `<ante>:Boss` guard but each round is its own
	// loss (`pvp:<roundId>`), so two PvP losses with no pvp.progress between cost 2.
	const pvpLoss = key?.startsWith('pvp:') === true
	if (
		guardKey !== null &&
		spent.includes(guardKey) &&
		(!pvpLoss || seat.events.some((e) => e.key === guardKey))
	)
		return state

	const lives = seat.lives - 1
	let next = withSeat(state, id, {
		...seat,
		lives,
		eliminated: lives <= 0,
		events: [...seat.events, { delta: -1, key }],
	})
	if (guardKey !== null && !spent.includes(guardKey))
		next = withMemo(next, {
			guarded: { ...state.facts.guarded, [id]: [...spent, guardKey] },
		})
	return lives <= 0 ? openDeath(next, mode, id, key) : next
}

// R47, R48, R49 (a pooled game, Teams): a team's guard is spent by its first
// non-PvP blind failure and re-armed by the next progress of any member (a blind
// selected or skipped, an ante reached), so two teammates failing before anyone moves
// on cost the pool one life and a failure after a member moved on costs another. The
// facts are consumed in arrival order, so a failure is charged before a later select.
// `id` is the player whose loss it is (a pending death opens on them); the mode's
// `lifePool` says who shares the loss and takes the life off the pool. The spent
// guard is one `team:spent` entry in each member's memo `guarded` list. A
// lost PvP round is the team's too: it is guarded on the whole team (memo
// `guarded[<player id>]`). A failure of the PvP blind before the loss is the
// player's own, guarded like loseLife's, so each is charged and the loss then costs
// nothing more; failures after the loss cost nothing, whatever order they arrive in.
// A pool already at 0 costs nothing. There is no `inRunIgnoringLives` check on
// purpose, a team loses a life whether or not the player it is charged through is
// still in.
const TEAM_GUARD = 'team:spent'

// A member's progress re-arms the team guard of every teammate. The same state when
// the team has none spent or the mode has no pool.
function rearmTeamGuard(state: RefereeState, mode: Mode, id: string): RefereeState {
	if (!mode.lifePool) return state
	const guards = { ...state.facts.guarded }
	let changed = false
	for (const m of mode.lifePool.sharers(state, id)) {
		if (!guards[m]?.includes(TEAM_GUARD)) continue
		guards[m] = guards[m].filter((k) => k !== TEAM_GUARD)
		changed = true
	}
	return changed ? withMemo(state, { guarded: guards }) : state
}

function losePooledLife(
	state: RefereeState,
	mode: Mode,
	pool: LifePool,
	id: string,
	key: string | null,
	guardKey: string | null,
): RefereeState {
	const members = pool.sharers(state, id)
	if (members.length === 0) return state
	const pvpLoss = key?.startsWith('pvp:') === true
	if (!pvpLoss && key !== null && guardKey !== null && !onPvpBlind(state, id, key)) {
		if ((state.facts.guarded[id] ?? []).includes(TEAM_GUARD)) return state
		const charged = withView(state, pool.spend(state, id, key))
		const guards = { ...state.facts.guarded }
		for (const m of members)
			guards[m] = [...(guards[m] ?? []), TEAM_GUARD]
		const next = withMemo(charged, { guarded: guards })
		return next.lives.players[id].lives <= 0
			? openDeath(next, mode, id, key)
			: next
	}
	const guardedIds = pvpLoss ? members : [id]
	// A player with no guarded blind yet has no entry in the map: a structural miss.
	const spent = (m: string): string[] => state.facts.guarded[m] ?? []
	const spendGuards = (s: RefereeState): RefereeState => {
		if (
			guardKey === null ||
			guardedIds.every((m) => spent(m).includes(guardKey))
		)
			return s
		const guards = { ...state.facts.guarded }
		for (const m of guardedIds)
			if (!spent(m).includes(guardKey)) guards[m] = [...spent(m), guardKey]
		return withMemo(s, { guarded: guards })
	}
	if (
		guardKey !== null &&
		guardedIds.some((m) => spent(m).includes(guardKey)) &&
		(!pvpLoss || state.lives.players[id].events.some((e) => e.key === guardKey))
	)
		// Blocked: the blind was already charged. A lost PvP round still spends the
		// guard of every teammate, so the order of the reports does not matter.
		return spendGuards(state)

	const charged = withView(state, pool.spend(state, id, key))
	const next = spendGuards(charged)
	return next.lives.players[id].lives <= 0
		? openDeath(next, mode, id, key)
		: next
}

// Every life loss goes through here: the mode's shared pool when it has one
// (Teams), the player's own lives otherwise.
export function chargeLife(
	state: RefereeState,
	mode: Mode,
	id: string,
	key: string | null,
	guardKey: string | null,
): RefereeState {
	return mode.lifePool
		? losePooledLife(state, mode, mode.lifePool, id, key, guardKey)
		: loseLife(state, mode, id, key, guardKey)
}

// R42: one life for a seat still in the run with lives left. A seat at 0, out
// of the run or unknown gets nothing: a gain never revives (docs/pvp-match.md section 4).
function gainLife(state: RefereeState, id: string): RefereeState {
	const seat = state.lives.players[id]
	if (!seat || seat.lives <= 0 || !inRunIgnoringLives(seat)) return state
	return withSeat(state, id, {
		...seat,
		lives: seat.lives + 1,
		events: [...seat.events, { delta: 1, key: null }],
	})
}

// A voucher fact: the mode names the gainers, the tick gives each one life.
// The same state back when the mode has no voucher rule.
export function gainVoucherLives(
	state: RefereeState,
	mode: Mode,
	fact: VoucherFact,
): RefereeState {
	// A pooled game's lives are the team's: a gain never moves a pool, so it
	// cannot move one member away from it either.
	if (!mode.voucherGainers || mode.lifePool) return state
	const gainers = new Set(mode.voucherGainers(state, fact))
	return [...gainers].reduce(gainLife, state)
}

// R34 (fail_round, fail_timer): in a game of 3+ players a lost blind or an
// ante-timer run-out puts the player out of hands, so the round does not wait on
// a count that will never move. The one fact is `handsSpent` (handsLeft stays as
// the player reported it, handRound is only a real hand's stamp); the player's
// later hand is refused `hands_spent` (facts.ts).
function outOfHands(state: RefereeState, mode: Mode, id: string): RefereeState {
	if (!mode.outOfHandsOnFail || state.round.phase !== 'playing') return state
	const prior = state.round.players[id]
	if (!prior || handsDone(prior)) return state
	return {
		...state,
		round: {
			...state.round,
			players: { ...state.round.players, [id]: { ...prior, handsSpent: true } },
		},
	}
}

// The one run-out of an Ante timer, counted by the server's expiry in deadlineStep.
// While the player has run-outs forgiven left it only uses one up; otherwise a life
// is lost, unguarded (R3), and in a game of 3+ the player is out of hands (R34).
// The server does not know the blind the player was on, so the event has no key:
// no blind is recorded failed, and a last life opens a death with no blind to wait
// on (deaths.ts).
export function runOut(
	state: RefereeState,
	mode: Mode,
	id: string,
): RefereeState {
	const forgiveness =
		state.rules.runId === null ? 0 : state.rules.timerForgiveness
	// A player with no run-out forgiven yet has no entry: a structural miss.
	const used = state.facts.forgiven[id] ?? 0
	if (used < forgiveness)
		return {
			...state,
			facts: {
				...state.facts,
				forgiven: { ...state.facts.forgiven, [id]: used + 1 },
			},
		}
	return outOfHands(chargeLife(state, mode, id, null, null), mode, id)
}

// Reads the log past the cursor: each fact costs what it costs, once. The whole
// batch is consumed before the round is resolved, so a run-out that eliminates a
// player and the hand that ends the round, arriving in one loop, skip the resolve
// (one player is left: the frozen decided game and the pending death settle it).
export function consumeFacts(
	state: RefereeState,
	mode: Mode,
): { state: RefereeState; gone: string[] } {
	const log = state.facts.log
	if (state.facts.applied >= log.length) return { state, gone: [] }
	let next = state
	const gone: string[] = []
	for (const fact of log.slice(state.facts.applied)) {
		switch (fact.type) {
			case 'forfeit': {
				const seat = next.lives.players[fact.playerId]
				if (seat && !seat.forfeited) {
					next = withSeat(next, fact.playerId, { ...seat, forfeited: true })
					gone.push(fact.playerId)
				}
				break
			}
			case 'blind':
				// Only the fail_round fact costs the guarded life (R4); a recorded
				// failure alone costs nothing.
				if (
					fact.roundLost &&
					next.rules.runId !== null &&
					next.rules.deathOnRoundLoss
				)
					next = chargeLife(
						next,
						mode,
						fact.playerId,
						fact.blindKey,
						fact.blindKey,
					)
				if (fact.roundLost) next = outOfHands(next, mode, fact.playerId)
				break
			case 'progress':
				next = rearmTeamGuard(next, mode, fact.playerId)
				break
			case 'voucher':
				next = gainVoucherLives(next, mode, {
					playerId: fact.playerId,
					voucherKey: fact.voucherKey,
				})
				break
			default:
				break
		}
	}
	return {
		state: { ...next, facts: { ...next.facts, applied: log.length } },
		gone,
	}
}

// A seat that left the lobby is out of the run, the same as a forfeit.
export function markLeft(
	state: RefereeState,
	startedIds: string[],
	seatedIds: string[],
): { state: RefereeState; gone: string[] } {
	let next = state
	const gone: string[] = []
	const seated = new Set(seatedIds)
	for (const id of startedIds) {
		const seat = next.lives.players[id]
		if (seat && !seat.left && !seated.has(id)) {
			next = withSeat(next, id, { ...seat, left: true })
			gone.push(id)
		}
	}
	return { state: next, gone }
}
