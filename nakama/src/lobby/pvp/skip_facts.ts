// The fact reducers for the skip requests (docs/pvp-match.md section 3). Like
// facts.ts they only RECORD what the client reports; the bank derived from it is
// in skips.ts and the tick (deadline.ts) charges the deadline time.
import {
	type TimerWorld,
	holderAfter,
	plainDeadline,
	roundOpen,
} from './deadline'
import { isCount, isRecord } from './payload'
import {
	type FactResult,
	PVP_SKIPS_KEY,
	gate,
	refuse,
	runIdOf,
	unchanged,
} from './reducer'
import { isBlindKey, isSkippableBlind } from './settings'
import { skipCap, skipsReported, spentOut } from './skips'
import { type RefereeState, withFact } from './state'

function withSkips(
	state: RefereeState,
	skips: RefereeState['facts']['skips'],
): FactResult {
	if (skips === state.facts.skips) return unchanged(state)
	return {
		ok: true,
		state: { ...state, facts: { ...state.facts, skips } },
		changed: [PVP_SKIPS_KEY],
	}
}

// pvp.skip {runId, skips, blindKey}: the sender's run total of skips (G.GAME.skips)
// after skipping the Small or Big `blindKey`. Never lower than the recorded total
// (`stale_skips`); an equal one is a harmless resend. The total is capped by the
// ante the sender reported (pvp.progress): no progress is `no_progress` (unknown is
// refused, never 0), a blind past it `ahead_of_progress`, a total over two skips
// per ante `over_cap`.
export function reduceSkip(
	state: RefereeState,
	id: string,
	args: unknown,
): FactResult {
	const runId = runIdOf(args)
	if (runId === null || !isRecord(args) || !isCount(args.skips))
		return refuse('bad_payload')
	if (!isBlindKey(args.blindKey)) return refuse('bad_payload')
	if (!isSkippableBlind(args.blindKey)) return refuse('not_skippable')
	const refused = gate(state, id, runId)
	if (refused) return refused
	if (state.rules.runId !== state.runId) return refuse('not_running')
	const recorded = state.facts.skips[id]?.skips ?? null
	if (recorded !== null && args.skips < recorded) return refuse('stale_skips')
	const ante = state.round.players[id]?.ante ?? null
	if (ante === null) return refuse('no_progress')
	if (Number(args.blindKey.split(':')[0]) > ante)
		return refuse('ahead_of_progress')
	if (args.skips > skipCap(ante, state.rules.mode)) return refuse('over_cap')
	return withSkips(state, skipsReported(state.facts.skips, id, args.skips))
}

// pvp.timer_spend {runId, ms}: the Score Preview integration's cost per preview.
// Refused while the sender holds a deadline or is timed by one: the running clock is
// charged by the tick, and a spend on top would count the same time twice.
// Bank ruleset: paid out of the sender's own Ante bank, taken as reported, down to
// the 10 s floor (a client can only lower its own bank). Personal-clock ruleset:
// `ms` must be the ruleset's preview cost; refused `in_pvp` while a PvP round is
// open, and recorded as a `preview_charge` fact for the tick to charge (D10).
export function reduceTimerSpend(
	state: RefereeState,
	id: string,
	args: unknown,
	world: TimerWorld,
): FactResult {
	const runId = runIdOf(args)
	if (runId === null || !isRecord(args) || !isCount(args.ms))
		return refuse('bad_payload')
	const refused = gate(state, id, runId)
	if (refused) return refused
	const rules = state.rules
	if (rules.runId !== state.runId) return refuse('not_running')
	const personal = rules.clocks.personal
	if (personal === null && args.ms <= 0) return refuse('bad_payload')
	if (personal !== null && args.ms !== personal.previewCostMs)
		return refuse('bad_payload')
	const running = plainDeadline(state.facts.deadline)
	if (running?.against.includes(id))
		return refuse('timer_running')
	const unapplied = state.facts.log.slice(state.facts.applied)
	if (holderAfter(running, unapplied) === id) return refuse('timer_running')
	if (personal !== null) {
		if (roundOpen(state)) return refuse('in_pvp')
		// No clock yet (the tick has not made one): unknown, never a free spend.
		if (state.facts.clocks[id] === undefined) return refuse('no_clock')
		// A free preview (Speedlatro) has nothing to charge.
		if (personal.previewCostMs === 0) return unchanged(state)
		// The charge is the tick's: the clock accrues while it runs, so only the tick
		// knows its live value (the floor, the cost, the new n).
		return {
			ok: true,
			state: withFact(state, { type: 'preview_charge', playerId: id }),
			changed: [],
		}
	}
	return withSkips(
		state,
		spentOut(rules, state.facts.skips, id, args.ms, world.opponentOf),
	)
}
