// The fact reducers for the PvP timer requests (docs/pvp-match.md sections 3 and 8):
// a timer start, a timer pause and the animating flag (pvp.animating). Like facts.ts
// they only RECORD; the deadline step (deadline.ts) opens, drops and runs out the
// deadline from what they log. No client
// ever reports a run-out: the server counts every clock and makes every run-out.
import {
	type TimerWorld,
	holderAfter,
	plainDeadline,
	wouldTime,
} from './deadline'
import { isCount, isRecord } from './payload'
import {
	type FactResult,
	gate,
	refuse,
	runIdOf,
	unchanged,
} from './reducer'
import { type RefereeState, withFact } from './state'

// pvp.timer_start {runId, kind, roundId?}: a timer the sender starts. Records the
// start; the tick opens the deadline. The server counts, so the request never says
// who does or how long: a payload with a `clock` or an `ms` is `bad_payload`. A
// ruleset with no clock of the kind (Ante: none; PvP: no hand timer) is `no_timer`.
// A start while a timer runs answers ok and changes nothing: the first press wins.
export function reduceTimerStart(
	state: RefereeState,
	id: string,
	args: unknown,
	world: TimerWorld,
): FactResult {
	const runId = runIdOf(args)
	if (runId === null || !isRecord(args)) return refuse('bad_payload')
	const kind = args.kind
	if (kind !== 'ante' && kind !== 'pvp') return refuse('bad_payload')
	if ('clock' in args || 'ms' in args) return refuse('bad_payload')
	if (kind === 'pvp' && !isCount(args.roundId)) return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	const rules = state.rules
	if (rules.runId !== state.runId) return refuse('not_running')
	if (kind === 'ante' ? rules.clocks.ante === 'none' : rules.clocks.pvp === null)
		return refuse('no_timer')
	if (kind === 'pvp') {
		if (args.roundId !== state.round.roundId) return refuse('round_over')
		if (state.round.phase !== 'playing') return refuse('not_playing')
	}
	const timing = wouldTime(kind, id, state, world)
	if (!timing.ok) return refuse(timing.reason)
	const unapplied = state.facts.log.slice(state.facts.applied)
	if (holderAfter(plainDeadline(state.facts.deadline), unapplied) !== null)
		return unchanged(state)
	return {
		ok: true,
		state: withFact(state, { type: 'timer_start', playerId: id, kind }),
		changed: [],
	}
}

// pvp.animating {runId, animating}: the sender's client began or stopped animating. Records
// who is animating (facts.animating); the tick holds the timers that count the sender's
// time while they are (deadline.ts, clocks.ts). The same value again is ok and changes
// nothing; a value that is not a boolean is `bad_payload`.
export function reduceAnimating(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (runId === null || !isRecord(args)) return refuse('bad_payload')
	const animating = args.animating
	if (typeof animating !== 'boolean') return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	const now = state.facts.animating
	if (now.includes(id) === animating) return unchanged(state)
	const next = animating ? [...now, id].sort() : now.filter((p) => p !== id)
	return {
		ok: true,
		state: { ...state, facts: { ...state.facts, animating: next } },
		changed: [],
	}
}

// pvp.timer_pause {runId}: the starter stops the timer. Records the pause; the tick
// drops the deadline. Nothing running is ok and changes nothing.
export function reduceTimerPause(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (runId === null) return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	const unapplied = state.facts.log.slice(state.facts.applied)
	const holder = holderAfter(plainDeadline(state.facts.deadline), unapplied)
	if (holder === null) return unchanged(state)
	if (holder !== id) return refuse('not_starter')
	return {
		ok: true,
		state: withFact(state, { type: 'timer_pause', playerId: id }),
		changed: [],
	}
}
