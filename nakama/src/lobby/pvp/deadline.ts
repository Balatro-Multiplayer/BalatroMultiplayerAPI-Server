// The timers of a PvP game, as the server sees them: which players a started timer
// times, and when its deadline opens, drops, refreshes, runs out and restarts.
// Pure: plain data in, plain data out, no Nakama handle, no clock but the `now` the
// caller passes. The request reducers (timer_facts.ts) use `wouldTime` for their refusals
// and the tick (tick.ts) uses every function here, so both read one rule.
import { asOneMoment } from './deaths'
import { runOut } from './lives'
import { handsDone } from './modes/common'
import type { Mode } from './modes/types'
import { handsAfter, withPlayer } from './reducer'
import { equal, greater } from './score'
import { anteBankMs, spentOut, spentRestarted } from './skips'
import { type PvpFact, type RefereeState, inRunIgnoringLives } from './state'
import { maskedFor } from './mask'

import type { Deadline, TimerKind } from './types'
export type { Deadline, TimerKind }

// What `wouldTime` reads besides the referee state: the Ready state and who the
// round shows each player facing.
export interface TimerWorld {
	readyIds: readonly string[]
	requiredIds: readonly string[]
	// The player's target in this round (pvp.targets.opponents); null with none.
	opponentOf: (id: string) => string | null
	// lastStart.firstPlayer: who wins a score tie.
	firstPlayer: string | null
}

export type Timing =
	| { ok: true; against: string[] }
	| {
			ok: false
			reason:
				| 'not_ready'
				| 'nobody_to_time'
				| 'no_opponent'
				| 'not_ahead'
				| 'not_started'
	  }

export type DropReason = 'decided' | 'starter_out' | 'unready' | 'round_closed'

export function worldOf(
	state: RefereeState,
	mode: Mode,
	readyIds: readonly string[],
	requiredIds: readonly string[],
): TimerWorld {
	// A mode without a view faces nobody; a player the view does not list has no
	// target; no start yet has no first player: structural misses, not game facts.
	return {
		readyIds,
		requiredIds,
		opponentOf: (id) => mode.view?.(state).opponents[id] ?? null,
		firstPlayer: state.lastStart === null ? null : state.lastStart.firstPlayer,
	}
}

// The round takes hands: playing, and no newer start waiting to open (a start
// that arrived mid-round is closed by the tick's resolveLeftRound).
export function roundOpen(state: RefereeState): boolean {
	return (
		state.round.phase === 'playing' &&
		!(state.lastStart !== null && state.lastStart.roundId > state.round.roundId)
	)
}

const sorted = (ids: string[]): string[] => [...ids].sort()

// Who a timer started by `by` would time, or why none. Ante: the required players
// still in the run who are not Ready and not on the starter's own side (a side
// that is not set never matches). PvP: exactly the starter's target, only while
// that player has hands left and is behind; a score tie counts as behind only for
// the player who Readied first.
export function wouldTime(
	kind: TimerKind,
	by: string,
	state: RefereeState,
	world: TimerWorld,
): Timing {
	if (kind === 'ante') {
		if (!world.readyIds.includes(by)) return { ok: false, reason: 'not_ready' }
		const side = state.teams.teams[by]
		const against = world.requiredIds.filter(
			(id) =>
				id !== by &&
				!world.readyIds.includes(id) &&
				inRunIgnoringLives(state.lives.players[id]) &&
				!(side !== undefined && state.teams.teams[id] === side),
		)
		return against.length === 0
			? { ok: false, reason: 'nobody_to_time' }
			: { ok: true, against: sorted(against) }
	}
	const target = world.opponentOf(by)
	if (target === null) return { ok: false, reason: 'no_opponent' }
	// Nobody starts a timer before their first hand of the round: they still see ???.
	if (maskedFor(state, by)) return { ok: false, reason: 'not_ahead' }
	const mine = state.round.players[by]
	const theirs = state.round.players[target]
	// A target that has not started has reported nothing to be ahead of.
	if (theirs === undefined || theirs.handsLeft === null)
		return { ok: false, reason: 'not_started' }
	// An own score that is unknown is never ahead (a viewer past the mask has one).
	if (mine === undefined || mine.score === null || theirs.score === null)
		return { ok: false, reason: 'not_ahead' }
	const behind =
		inRunIgnoringLives(state.lives.players[target]) &&
		!handsDone(theirs) &&
		(greater(mine.score, theirs.score) ||
			(equal(mine.score, theirs.score) && world.firstPlayer === by))
	return behind
		? { ok: true, against: [target] }
		: { ok: false, reason: 'not_ahead' }
}

// Who holds the timer once the start and pause facts the tick has not read yet are
// applied: the starter, or null. First press wins; only the holder can pause.
export function holderAfter(
	deadline: Deadline | null,
	unapplied: readonly PvpFact[],
): string | null {
	let holder = deadline?.by ?? null
	for (const fact of unapplied) {
		if (fact.type === 'timer_start' && holder === null) holder = fact.playerId
		else if (fact.type === 'timer_pause' && holder === fact.playerId)
			holder = null
	}
	return holder
}

// A deadline as plain data (match state comes back from the runtime through
// wrappers; this reads the values once).
export function plainDeadline(
	deadline: Deadline | null | undefined,
): Deadline | null {
	if (!deadline) return null
	return {
		kind: deadline.kind,
		by: deadline.by,
		against: [...deadline.against],
		endsAt: deadline.endsAt,
		shownMs: deadline.shownMs,
		n: deadline.n,
		...(deadline.pausedMs === undefined ? {} : { pausedMs: deadline.pausedMs }),
		...(deadline.resumed === undefined ? {} : { resumed: deadline.resumed }),
	}
}

// Value equality, never identity.
export function sameDeadline(a: Deadline | null, b: Deadline | null): boolean {
	if (a === null || b === null) return a === b
	return (
		a.kind === b.kind &&
		a.by === b.by &&
		a.endsAt === b.endsAt &&
		a.shownMs === b.shownMs &&
		a.n === b.n &&
		a.pausedMs === b.pausedMs &&
		a.resumed === b.resumed &&
		a.against.length === b.against.length &&
		a.against.every((id, i) => id === b.against[i])
	)
}

// The time a running server-counted deadline has run since `shownMs` was set (its
// open, or the clock last going on after a pause); 0 for a personal-clock marker and
// for a paused one (its running segment was charged when it paused).
export function ranMs(deadline: Deadline, now: number): number {
	if (
		deadline.endsAt === null ||
		deadline.shownMs === null ||
		deadline.pausedMs !== undefined
	)
		return 0
	return Math.max(0, deadline.shownMs - Math.max(0, deadline.endsAt - now))
}

// Open: a timer_start fact with no deadline running becomes the deadline, number
// `n`. A time left (`ms`) gives the end; null (a personal-clock Ante marker) none.
export function opened(
	kind: TimerKind,
	by: string,
	against: string[],
	ms: number | null,
	now: number,
	n: number,
): Deadline {
	return {
		kind,
		by,
		against,
		endsAt: ms === null ? null : now + ms,
		shownMs: ms,
		n,
	}
}

// Drop: why a running deadline ends on its own, or null. The game is decided; the
// starter left, forfeited or is out of lives; an Ante starter is no longer Ready
// (a round start clears Ready, so this also ends it when the PvP round begins; a
// restart-carried deadline is spared until its starter is Ready again, see `resumed`); a
// PvP deadline's round is no longer taking hands.
export function dropReason(
	deadline: Deadline,
	state: RefereeState,
	world: TimerWorld,
): DropReason | null {
	if (state.result.kind !== null) return 'decided'
	const starter = state.lives.players[deadline.by]
	if (
		starter === undefined ||
		!inRunIgnoringLives(starter) ||
		starter.lives <= 0
	)
		return 'starter_out'
	if (deadline.kind === 'ante') {
		// A marked deadline lives only in the round it was carried in: a start since
		// (Ready cleared) ends it like any Ante deadline whose starter is not Ready.
		const carriedHere =
			deadline.resumed !== undefined &&
			deadline.resumed === (state.lastStart?.roundId ?? 0)
		if (!carriedHere && !world.readyIds.includes(deadline.by)) return 'unready'
	}
	if (deadline.kind === 'pvp' && !roundOpen(state)) return 'round_closed'
	return null
}

// Refresh: `against` is read from the state again on every tick, with the rule the
// request used; a seat stays timed until it is removed from the lobby (an away seat
// inside its grace window is still timed, but it pauses the clock, see `pausedFor`).
// A deadline with nobody left to time is dropped (null).
export function refreshed(
	deadline: Deadline,
	state: RefereeState,
	world: TimerWorld,
): Deadline | null {
	// A restart-carried Ante deadline is timed as if its starter were Ready (see `resumed`).
	const spared =
		deadline.resumed !== undefined && !world.readyIds.includes(deadline.by)
			? { ...world, readyIds: [...world.readyIds, deadline.by] }
			: world
	const timing = wouldTime(deadline.kind, deadline.by, state, spared)
	return timing.ok ? { ...deadline, against: timing.against } : null
}

// Whether a deadline stands still for its timed players' animations: the PvP hand
// timer always, an Ante deadline never.
export function animationPauses(kind: TimerKind): boolean {
	return kind === 'pvp'
}

// Pause (docs/pvp-match.md section 8): a server-counted deadline stands still while
// any player it times is away (`awayIds`; the step adds the animating ones where
// `animationPauses`), and goes on with the same time left when none is. It is
// one clock, so one away player pauses it for all. The starter being away does not
// pause it: a starter's disconnect drops their Ready (#620), and the tick of that
// disconnect ends the deadline as 'unready' at its real run time, so the bank is
// charged exactly what ran. A deadline the client counts is never paused here.
export function pausedFor(
	deadline: Deadline,
	holdIds: readonly string[],
	now: number,
): Deadline {
	if (deadline.endsAt === null) return deadline
	// A restart-carried deadline also waits for its starter: the restart made every
	// seat away, and the starter's own grace has not run yet (see `resumed`).
	const away =
		deadline.against.some((id) => holdIds.includes(id)) ||
		(deadline.resumed !== undefined && holdIds.includes(deadline.by))
	if (away)
		return deadline.pausedMs === undefined
			? { ...deadline, pausedMs: Math.max(0, deadline.endsAt - now) }
			: deadline
	if (deadline.pausedMs === undefined) return deadline
	const { pausedMs, ...running } = deadline
	return { ...running, endsAt: now + pausedMs, shownMs: pausedMs }
}

// Expire: a server-counted deadline whose end has passed. A deadline the client
// counts, or a paused one, never expires here.
export function expired(deadline: Deadline, now: number): boolean {
	return (
		deadline.endsAt !== null &&
		deadline.pausedMs === undefined &&
		now >= deadline.endsAt
	)
}

// Restart after a run-out: against the players still in the run, from the rule's
// base and a new number. After a clock jump the base counts from `now`, so one
// expiry fires, not one per missed period.
export function restarted(
	deadline: Deadline,
	against: string[],
	now: number,
	baseMs: number,
	n: number,
): Deadline {
	// A run-out ends the carried-over state: the mark does not go on.
	const { resumed: _carried, ...ordinary } = deadline
	return {
		...ordinary,
		against: sorted(against),
		endsAt: now + baseMs,
		shownMs: baseMs,
		n,
	}
}

// A credit of `ms` hand time to a PvP deadline's target: the end moves forward, the
// number is new and the shown time restarts from what is left (docs/pvp-match.md
// section 8). A paused deadline gains the time in its standing-still `pausedMs`.
export function credited(
	deadline: Deadline,
	ms: number,
	now: number,
	n: number,
): Deadline {
	if (deadline.pausedMs !== undefined) {
		const left = deadline.pausedMs + ms
		return { ...deadline, pausedMs: left, shownMs: left, n }
	}
	// A PvP deadline always has an end; a marker (no end) has no time to add to.
	if (deadline.endsAt === null) return deadline
	const endsAt = deadline.endsAt + ms
	return { ...deadline, endsAt, shownMs: Math.max(0, endsAt - now), n }
}

// The time a deadline has left at `now`: the standing-still time of a paused one.
// null for a personal-clock marker.
export function leftMs(deadline: Deadline, now: number): number | null {
	if (deadline.pausedMs !== undefined) return deadline.pausedMs
	return deadline.endsAt === null ? null : Math.max(0, deadline.endsAt - now)
}

// The player's PvP allowance (ms); a PvP deadline that ends puts what it has left
// back here, and a credit with no deadline running adds to it.
function withPvpLeft(
	state: RefereeState,
	id: string,
	pvpLeftMs: number | null,
): RefereeState {
	const entry = state.round.players[id]
	return entry === undefined
		? state
		: withPlayer(state, id, { ...entry, pvpLeftMs })
}

// A PvP deadline ends without a run-out (a pause, a drop): its target keeps the
// time it had left.
function released(
	state: RefereeState,
	deadline: Deadline,
	now: number,
): RefereeState {
	if (deadline.kind !== 'pvp') return state
	const left = leftMs(deadline, now)
	return deadline.against.reduce(
		(next, id) => withPvpLeft(next, id, left),
		state,
	)
}

// The Ante clock of `id` ran out: the server's own run-out knows no blind, so the
// life ledger takes the loss directly (no fact: nothing reads one).
export function anteRunOut(
	state: RefereeState,
	mode: Mode,
	id: string,
): RefereeState {
	return runOut(state, mode, id)
}

// One batch of run-outs: every player in `ids` runs out at the same moment, so none
// of them counts the others as out before (asOneMoment).
export function anteRunOuts(
	state: RefereeState,
	mode: Mode,
	ids: readonly string[],
): RefereeState {
	let next = state
	for (const id of ids) next = anteRunOut(next, mode, id)
	return asOneMoment(next, state, state.facts.deaths.length, ids)
}

// The PvP hand timer ran out on `id` (D3: the server makes every run-out): one hand
// fewer, derived through handsAfter like every hand count (so a player on their last
// hand reaches handsDone); the watermark and a pending commit move down with it (a
// commit at 0 has no hand left to bind, so it is cleared); the allowance is the one
// hand's time again (D8). Costs no life and no bank.
export function pvpRunOut(
	state: RefereeState,
	id: string,
	handMs: number,
): RefereeState {
	const prior = state.round.players[id]
	if (prior === undefined) return state
	const timerLosses = prior.timerLosses + 1
	const next = withPlayer(state, id, {
		...prior,
		timerLosses,
		handsLeft:
			prior.reportedHands === null
				? null
				: handsAfter(prior.reportedHands, prior.reportedApplied, timerLosses),
		creditedHands:
			prior.creditedHands === null ? null : Math.max(0, prior.creditedHands - 1),
		committedHands:
			prior.committedHands === null || prior.committedHands === 0
				? null
				: prior.committedHands - 1,
		pvpLeftMs: handMs,
	})
	return next
}

// pvp.round.deadline as clients read it. `now` null is the STATE's frozen value
// (`shownMs`); a number is a SNAPSHOT's live `endsAt - now`, floored at 0. A paused
// deadline shows its time left in both, and `paused: true`, a key a running one lacks.
export function projectDeadline(
	deadline: Deadline | null | undefined,
	now: number | null,
): unknown {
	if (!deadline) return null
	const remainingMs =
		deadline.pausedMs ??
		(now !== null && deadline.endsAt !== null
			? Math.max(0, deadline.endsAt - now)
			: deadline.shownMs)
	return {
		kind: deadline.kind,
		by: deadline.by,
		against: [...deadline.against],
		remainingMs,
		n: deadline.n,
		...(deadline.pausedMs === undefined ? {} : { paused: true }),
	}
}

// A snapshot's match state with the live remaining time in `pvp.round.deadline`;
// the same object when no server-counted deadline runs. No re-base on a join or a
// reconnect: it is the time left on the one clock the server counts.
export function withLiveDeadline(
	match: { [key: string]: unknown },
	deadline: Deadline | null | undefined,
	now: number,
): { [key: string]: unknown } {
	const round = match['pvp.round']
	if (
		!deadline ||
		deadline.endsAt === null ||
		typeof round !== 'object' ||
		!round
	)
		return match
	return {
		...match,
		'pvp.round': { ...round, deadline: projectDeadline(deadline, now) },
	}
}

// What the deadline step reads of the lobby (the tick's env, tick.ts).
export interface TimerEnv {
	// The Ready state the timers read: who is Ready, and who the next round waits on
	// (seated and in the run, as the lobby saw them before this tick).
	readyIds: string[]
	requiredIds: string[]
	// The seated players who are away (in grace); a server-counted deadline waits
	// for them (docs/pvp-match.md section 8).
	awayIds: string[]
}

// What a timer_start fact opens the deadline with: the time the deadline has left, or
// null for a personal-clock Ante marker (no end). undefined: nothing to open (the
// ruleset has no such clock, or the target has no allowance reported: unknown is
// never guessed). Ante: the starter's derived bank on a bank ruleset. PvP: the
// target's allowance (D8).
function openingMs(
	state: RefereeState,
	kind: TimerKind,
	by: string,
	against: string[],
	skips: RefereeState['facts']['skips'],
	world: TimerWorld,
): number | null | undefined {
	const rules = state.rules
	if (rules.runId === null) return undefined
	if (kind === 'pvp') {
		if (rules.clocks.pvp === null) return undefined
		return state.round.players[against[0]]?.pvpLeftMs ?? undefined
	}
	if (rules.clocks.ante === 'bank')
		return anteBankMs(rules, skips, by, world.opponentOf)
	return rules.clocks.ante === 'personal' ? null : undefined
}

// The timer step, run after the facts are consumed so a run-out
// is in the lives before the round resolves, places are made and a winner is
// named. `fresh` is the log past the cursor as the tick began. In order, per fact:
// open from a timer_start fact when none runs (a bank Ante deadline opens with the
// starter's derived bank, a personal-clock Ante deadline with no end, a PvP one with
// the target's allowance); drop on a pause; credit hand time (a PvP deadline of the
// credited player moves its end and takes a new number, else the time goes to the
// player's allowance). Then: drop on a drop rule; refresh who is timed; hold a
// deadline while a timed player is away, or animating where `animationPauses` says so (it
// never runs out then); and let a PvP hand
// timer run out (one hand fewer for its target, no life, no restart, no bank
// charge: it only ever counts the target's hand time) or a bank Ante deadline run out
// (one run-out per timed player, then a restart from the rule's base against whoever
// is still in the run). The time a bank Ante deadline ran is charged to its starter's
// bank (skips.ts) whenever it pauses, drops or runs out; a PvP deadline that ends
// without a run-out gives its target the time it had left.
// The same state back when nothing changed.
export function deadlineStep(
	state: RefereeState,
	mode: Mode,
	timers: TimerEnv,
	fresh: PvpFact[],
	now: number,
): RefereeState {
	const rules = state.rules
	if (rules.runId === null) return state
	const baseMs = rules.timerBaseMs
	const handMs = rules.clocks.pvp?.handMs ?? null
	const world = worldOf(state, mode, timers.readyIds, timers.requiredIds)
	const before = plainDeadline(state.facts.deadline)
	let next = state
	let n = state.facts.timerN
	let deadline = before
	let skips = state.facts.skips
	// Only a bank Ante deadline is paid for out of the starter's bank.
	const charge = (d: Deadline, ms: number): void => {
		if (d.kind === 'ante' && ms > 0)
			skips = spentOut(rules, skips, d.by, ms, world.opponentOf)
	}
	const end = (d: Deadline): void => {
		charge(d, ranMs(d, now))
		next = released(next, d, now)
	}

	for (const fact of fresh) {
		if (fact.type === 'timer_start' && deadline === null) {
			const timing = wouldTime(fact.kind, fact.playerId, state, world)
			const ms = timing.ok
				? openingMs(next, fact.kind, fact.playerId, timing.against, skips, world)
				: undefined
			if (timing.ok && ms !== undefined) {
				n += 1
				deadline = opened(fact.kind, fact.playerId, timing.against, ms, now, n)
			}
		} else if (fact.type === 'timer_pause') {
			if (deadline?.by === fact.playerId) {
				end(deadline)
				deadline = null
			}
		} else if (fact.type === 'hand_credit' && handMs !== null) {
			const ms = fact.hands * handMs
			if (
				deadline !== null &&
				deadline.kind === 'pvp' &&
				deadline.against.includes(fact.playerId)
			) {
				n += 1
				deadline = credited(deadline, ms, now, n)
			} else {
				const left = next.round.players[fact.playerId]?.pvpLeftMs ?? null
				// A player with no allowance reported (a ruleset with none) gains none.
				if (left !== null) next = withPvpLeft(next, fact.playerId, left + ms)
			}
		}
	}

	if (deadline !== null) {
		const kept =
			dropReason(deadline, state, world) === null
				? refreshed(deadline, state, world)
				: null
		if (kept === null) end(deadline)
		deadline = kept
		if (deadline?.resumed !== undefined && world.readyIds.includes(deadline.by)) {
			const { resumed: _carried, ...ordinary } = deadline
			deadline = ordinary
		}
	}
	if (deadline !== null) {
		const going = deadline
		deadline = pausedFor(
			going,
			animationPauses(going.kind)
				? [...timers.awayIds, ...state.facts.animating]
				: timers.awayIds,
			now,
		)
		// The segment that ran up to the pause.
		if (going.pausedMs === undefined && deadline.pausedMs !== undefined)
			charge(going, ranMs(going, now))
	}

	if (deadline !== null && expired(deadline, now)) {
		if (deadline.kind === 'pvp') {
			// A PvP deadline has one target. No pvp clock rule, no run-out to make.
			if (handMs !== null)
				for (const id of deadline.against)
					next = pvpRunOut(next, id, handMs)
			deadline = null
		} else {
			const timed = deadline.against
			next = anteRunOuts(
				next,
				mode,
				timed,
			)
			const staying = timed.filter((id) =>
				inRunIgnoringLives(next.lives.players[id]),
			)
			if (staying.length > 0) {
				n += 1
				// The restart is from the base: the bank is the base again.
				skips = spentRestarted(rules, skips, deadline.by, world.opponentOf)
				deadline = restarted(deadline, staying, now, baseMs, n)
			} else {
				charge(deadline, ranMs(deadline, now))
				deadline = null
			}
		}
	}

	if (
		next === state &&
		skips === state.facts.skips &&
		sameDeadline(deadline, before) &&
		n === state.facts.timerN
	)
		return state
	return { ...next, facts: { ...next.facts, deadline, timerN: n, skips } }
}
