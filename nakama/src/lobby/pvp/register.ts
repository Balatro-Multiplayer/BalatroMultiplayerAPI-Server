// The PvP request types and the reducer each one runs, as one static table
// (PVP_REQUESTS) that requests.ts reads. The match keys they show are in
// match_state.ts.
import type { StepContext } from '../../actions/registry'
import { changedKeys } from '../match_state'
import type { Reducer } from '../request_types'
import { type Lobby, findPlayer } from '../state'
import { type TimerWorld, worldOf } from './deadline'
import { FACT_REDUCERS } from './facts'
import { frozenState, runFrozen, setupPending } from './freeze_env'
import { modeOfGame } from './modes'
import { reduceEffect, reduceSell, reduceShop } from './opponent_facts'
import type { OpponentReply, OpponentResult } from './opponent_state'
import {
	pvpOf,
	readyIdsOf,
	readyReducer,
	requiredIds,
	unreadyReducer,
} from './ready'
import type { FactResult } from './reducer'
import { modeOfQueue } from './settings'
import { reduceTimerSpend } from './skip_facts'
import {
	type PvpTeam,
	type RefereeState,
	refereeOf,
	withReferee,
} from './state'
import {
	reduceAnimating,
	reduceTimerPause,
	reduceTimerStart,
} from './timer_facts'
import { reduceTrapFire, reduceTrapLost, reduceTrapPlant } from './traps'
import { PVP_PROJECTIONS, PVP_TEAMS_KEY, TEAMS_OF_MODE } from './view'

// A reducer names the keys it wrote. A key derived from other state (the
// targets, from the scores) can change with it, so every PvP key whose
// projection differs before and after counts too.
function derivedKeys(before: Lobby, after: Lobby): string[] {
	return changedKeys(before, after).filter((key) =>
		Object.prototype.hasOwnProperty.call(PVP_PROJECTIONS, key),
	)
}

// The lobby-level gate (a running PvP game, a seat in it), then the fact reducer.
// A fact no key shows (a blind result) still stores its state.
//
// `freezes`: the request freezes the game's rules first (D1d), from the metadata as it
// stands, so the fact reads a frozen game. Every kind does but pvp.forfeit and pvp.vote.
function lobbyReducer(
	fact: (
		state: RefereeState,
		senderId: string,
		payload: unknown,
		lobby: Lobby,
	) => FactResult,
	freezes = true,
): Reducer {
	return {
		keys: PVP_PROJECTIONS,
		reduce: (lobby, senderId, payload, ctx) => {
			const state = refereeOf(lobby)
			const started = lobby.game.started
			if (!state || !started) return { ok: false, reason: 'not_running' }
			if (!started.players.some((p) => p.id === senderId))
				return { ok: false, reason: 'no_seat' }
			const frozen = frozenFor(freezes, lobby, state, ctx)
			if (!frozen.ok) return frozen
			const base =
				frozen.state === state ? lobby : withReferee(lobby, frozen.state)
			const result = fact(frozen.state, senderId, payload, base)
			if (!result.ok) return result
			const next =
				result.state === state ? lobby : withReferee(lobby, result.state)
			return {
				ok: true,
				lobby: next,
				changed: [...new Set([...result.changed, ...derivedKeys(lobby, next)])],
			}
		},
	}
}

// The referee state a request reads: frozen first when the request freezes (D1d). A
// freeze that finds the metadata unfit is the request's `bad_rules` refusal.
function frozenFor(
	freezes: boolean,
	lobby: Lobby,
	state: RefereeState,
	ctx: StepContext,
):
	| { ok: true; state: RefereeState }
	| { ok: false; reason: string; key?: string } {
	if (!freezes) return { ok: true, state }
	// Before the freeze, while Setup is not finished nothing freezes the rules: a freeze
	// now would pin the pre-vote ruleset and refuse the vote's result as bad_rules. Once
	// the rules are frozen or the race began this never applies (a step cannot be opened
	// then either, actions/setup.ts), so no host request can hold the opponent's facts.
	if (!runFrozen(lobby) && lobby.game.started?.raceStartedAt === undefined && setupPending(lobby))
		return { ok: false, reason: 'setup_open' }
	const frozen = frozenState(lobby, state, ctx)
	return frozen.ok
		? frozen
		: { ok: false, reason: frozen.reason, key: frozen.key }
}

// A request that reads the lobby itself (Ready) freezes the rules first like every other
// pvp.* kind (D1d), so the freeze point never depends on which request comes first.
function freezingReducer(inner: Reducer): Reducer {
	return {
		keys: inner.keys,
		reduce: (lobby, senderId, payload, ctx) => {
			const state = refereeOf(lobby)
			if (!state || !lobby.game.started)
				return inner.reduce(lobby, senderId, payload, ctx)
			const frozen = frozenFor(true, lobby, state, ctx)
			if (!frozen.ok) return frozen
			const base =
				frozen.state === state ? lobby : withReferee(lobby, frozen.state)
			const result = inner.reduce(base, senderId, payload, ctx)
			if (!result.ok) return result
			return {
				...result,
				changed: [
					...new Set([...result.changed, ...derivedKeys(lobby, result.lobby)]),
				],
			}
		},
	}
}

// What the wire says of a reply. An accepted request answers ok. A refusal the
// server recorded answers `ok: false` with its reason, the state change still
// stored and announced. The `implausible` counts are for the log and never reach
// the answer.
function refusalOf(
	reply: OpponentReply,
): { reason: string; detail?: string } | undefined {
	if (reply.kind === 'accepted') return undefined
	return reply.detail === undefined
		? { reason: reply.reason }
		: {
				reason: reply.reason,
				detail: `count ${reply.detail.count} cap ${reply.detail.cap} window ${reply.detail.window}`,
			}
}

// The opponent-fact requests behind the same lobby gate. Their reducers answer with
// a `reply`, which can be a recorded refusal.
function opponentReducer(
	fact: (state: RefereeState, senderId: string, payload: unknown) => OpponentResult,
): Reducer {
	return {
		keys: PVP_PROJECTIONS,
		reduce: (lobby, senderId, payload, ctx) => {
			const state = refereeOf(lobby)
			const started = lobby.game.started
			if (!state || !started) return { ok: false, reason: 'not_running' }
			if (!started.players.some((p) => p.id === senderId))
				return { ok: false, reason: 'no_seat' }
			const frozen = frozenFor(true, lobby, state, ctx)
			if (!frozen.ok) return frozen
			const result = fact(frozen.state, senderId, payload)
			if (!result.ok) return result
			const next =
				result.state === state ? lobby : withReferee(lobby, result.state)
			const refusal = refusalOf(result.reply)
			return {
				ok: true,
				lobby: next,
				changed: [...new Set([...result.changed, ...derivedKeys(lobby, next)])],
				...(refusal ? { refusal } : {}),
			}
		},
	}
}

// The timer starts refuse on the Ready state and the round's targets, so they read
// the lobby, like pvp.ready: the same `wouldTime` the tick uses names who is timed.
// Null while the game's rules are not frozen: there is no mode to time under.
function timerWorldOf(lobby: Lobby, state: RefereeState): TimerWorld | null {
	const mode = modeOfGame(state)
	if (mode === null) return null
	const ready = pvpOf(lobby)
	return worldOf(
		state,
		mode,
		ready ? readyIdsOf(ready) : [],
		requiredIds(lobby),
	)
}

export type TeamCheck =
	| { ok: true; team: PvpTeam }
	| { ok: false; reason: 'no_seat' | 'running' | 'bad_team' }

// Whether `senderId` may pick the team the payload names: seated, before the
// start, and a team this lobby's mode offers. Pure.
export function checkTeamPick(
	lobby: Lobby,
	senderId: string,
	payload: unknown,
): TeamCheck {
	if (!findPlayer(lobby, senderId)) return { ok: false, reason: 'no_seat' }
	if (lobby.game.started) return { ok: false, reason: 'running' }
	const mode = modeOfQueue(lobby.metadata.queue_mode)
	const offered = mode === null ? [] : (TEAMS_OF_MODE[mode] ?? [])
	const team =
		typeof payload === 'object' && payload !== null
			? (payload as { team?: unknown }).team
			: undefined
	const picked = offered.find((t) => t === team)
	return picked ? { ok: true, team: picked } : { ok: false, reason: 'bad_team' }
}

// pvp.team works with no game running, so it sits outside the fact reducers. A player
// picks for themself only; the start rule settles several RUNNER picks.
const teamReducer: Reducer = {
	keys: PVP_PROJECTIONS,
	reduce: (lobby, senderId, payload) => {
		const check = checkTeamPick(lobby, senderId, payload)
		if (!check.ok) return check
		if (lobby.teamPicks?.[senderId] === check.team)
			return { ok: true, lobby, changed: [] }
		return {
			ok: true,
			lobby: {
				...lobby,
				teamPicks: { ...lobby.teamPicks, [senderId]: check.team },
			},
			changed: [PVP_TEAMS_KEY],
		}
	},
}

// A forfeit during a 3+ player Setup must not freeze the stale pre-vote ruleset, and a
// vote is refused before the freeze anyway (D1d).
const NEVER_FREEZE = ['pvp.forfeit', 'pvp.vote']

// Each fact reducer behind the lobby gate. A plain loop: the bundle targets
// ES2015, which has no Object.fromEntries.
function gatedFactReducers(): { [type: string]: Reducer } {
	const gated: { [type: string]: Reducer } = {}
	for (const type of Object.keys(FACT_REDUCERS))
		gated[type] = lobbyReducer(
			FACT_REDUCERS[type],
			!NEVER_FREEZE.includes(type),
		)
	return gated
}

// Every PvP request type with the reducer that answers it. The fact requests
// (FACT_REDUCERS) pass through the lobby gate; the timer starts also read the
// lobby for who is timed.
export const PVP_REQUESTS: { [type: string]: Reducer } = {
	'pvp.ready': freezingReducer(readyReducer),
	'pvp.unready': freezingReducer(unreadyReducer),
	'pvp.team': teamReducer,
	...gatedFactReducers(),
	'pvp.timer_start': lobbyReducer((state, senderId, payload, lobby) => {
		const world = timerWorldOf(lobby, state)
		if (world === null) return { ok: false, reason: 'not_running' }
		return reduceTimerStart(state, senderId, payload, world)
	}),
	'pvp.timer_spend': lobbyReducer((state, senderId, payload, lobby) => {
		const world = timerWorldOf(lobby, state)
		if (world === null) return { ok: false, reason: 'not_running' }
		return reduceTimerSpend(state, senderId, payload, world)
	}),
	'pvp.timer_pause': lobbyReducer(reduceTimerPause),
	'pvp.animating': lobbyReducer(reduceAnimating),
	'pvp.sell': opponentReducer(reduceSell),
	'pvp.shop': opponentReducer(reduceShop),
	'pvp.effect': opponentReducer(reduceEffect),
	'pvp.trap_plant': opponentReducer(reduceTrapPlant),
	'pvp.trap_fire': opponentReducer(reduceTrapFire),
	'pvp.trap_lost': opponentReducer(reduceTrapLost),
}
