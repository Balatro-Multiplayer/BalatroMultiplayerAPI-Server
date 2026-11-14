// The personal clocks (docs/pvp-match.md section 8): Pressure and Speedlatro, one
// clock per player, counted by the server. Pure: plain values in, plain values
// out, `now` passed in. The tick (tick.ts) gathers each player's ClockInputs,
// calls clocksStep once and stores what it returns.
//
// A clock holds `ms` as of `since`; the live value is `ms - (now - since) x rate`
// while `running`. `ms` and `since` are rewritten only when `n` bumps (one bump per
// tick at most), so a push goes out only on a new `n`. A run-out is detected from
// the live value.
import { compareRoundScore } from './score'
import type { PersonalClock, PersonalClockRules, SkipsSeen } from './state'

// The opponent as the player's clock sees them. `score` is null when the opponent
// has no entry, has reported nothing, or is masked from the player.
export interface Rival {
	score: string | null
}

// Everything one player's clock reads, as plain values (the tick gathers them).
export interface ClockInputs {
	// In the run: not eliminated, forfeited or gone.
	inRun: boolean
	// In the Ready state's readyIds / has pressed Ready at least once for the
	// coming round (PvpState.readied).
	ready: boolean
	readied: boolean
	// Not connected: the clock pauses.
	away: boolean
	// The player's client is animating: the Pressure clock stops (Speedlatro's does not).
	animating: boolean
	// A PvP round is open (phase 'playing').
	pvpOpen: boolean
	// The player is `by` of an Ante deadline / in its `against` (timed).
	timing: boolean
	timed: boolean
	// The player's own pvp.blind_start of the open round has arrived
	// (reportedHands is not null), and the player has no hands left.
	blindStarted: boolean
	handsDone: boolean
	// The player's own round score, null until reported.
	score: string | null
	// The player's opponent; null with none (a bye).
	rival: Rival | null
	// The opponent's id (null with none) and skip total (null while unknown).
	rivalId: string | null
	rivalSkips: number | null
	// A team game: no skip credit (skips_net.lua:101).
	teamMode: boolean
	// A round closed in this tick: the reset comes before everything else.
	roundClosed: boolean
	// Unapplied preview_charge facts of the player.
	previews: number
}

// A server run-out of a personal clock: the tick takes a life for it.
export interface ClockRunOut {
	playerId: string
	kind: 'pressure' | 'speedlatro'
	n: number
}

export interface ClocksStepResult {
	clocks: { [userId: string]: PersonalClock }
	skipsSeen: { [userId: string]: SkipsSeen }
	runOuts: ClockRunOut[]
	// Players with an input but no entry: skipped, untouched (the caller logs them).
	missing: string[]
}

// Speedlatro runs while the player is not ahead: with no opponent, with no known
// opponent score, or with the opponent strictly ahead. A tie holds.
function notAhead(input: ClockInputs): boolean {
	if (input.rival === null || input.rival.score === null) return true
	return compareRoundScore(input.rival.score, input.score) === 1
}

// Whether the clock counts down right now.
export function clockRuns(
	rules: PersonalClockRules,
	input: ClockInputs,
	entry: PersonalClock,
	now: number,
): boolean {
	if (!input.inRun || input.ready || input.away) return false
	if (rules.kind === 'pressure') {
		return !input.pvpOpen && !input.animating && (!input.readied || input.timed)
	}
	if (entry.spent) return false
	if (!input.pvpOpen) return true
	// In a PvP round: held until the player's own blind start, then for the grace.
	if (!input.blindStarted) return false
	if (entry.graceUntil === null || now < entry.graceUntil) return false
	return !input.handsDone && notAhead(input)
}

// How fast it counts: the timed rate while an Ante deadline times the player
// (Speedlatro: outside PvP only), else 1.
export function clockRate(
	rules: PersonalClockRules,
	input: ClockInputs,
): 1 | 2 {
	if (!input.timed) return 1
	if (rules.kind === 'speedlatro' && input.pvpOpen) return 1
	return rules.timedRate
}

// The time left at `now`, at the stored running/rate. Never below 0.
export function clockLive(entry: PersonalClock, now: number): number {
	if (!entry.running) return entry.ms
	const elapsed = Math.max(0, now - entry.since)
	return Math.max(0, entry.ms - elapsed * entry.rate)
}

// The same clock with `ms` and `since` brought up to `now`.
function settled(entry: PersonalClock, now: number): PersonalClock {
	return { ...entry, ms: clockLive(entry, now), since: now }
}

// Adds time (an opponent skip's increment) to a clock settled at now.
export function clockCredit(entry: PersonalClock, ms: number): PersonalClock {
	return { ...entry, ms: entry.ms + ms }
}

// Back to the base: every round close. Speedlatro is also unspent again.
export function clockReset(
	rules: PersonalClockRules,
	entry: PersonalClock,
	now: number,
): PersonalClock {
	return {
		...entry,
		ms: rules.baseMs,
		spent: false,
		graceUntil: null,
		since: now,
	}
}

// A Score Preview charge of `cost` on a clock settled at now: free at or below
// max(10 s, cost), else `cost` off.
export function clockCharge(entry: PersonalClock, cost: number): PersonalClock {
	if (cost === 0 || entry.ms <= Math.max(10_000, cost)) return entry
	return { ...entry, ms: entry.ms - cost }
}

// The credit and the new memo from the opponent's skips. A credit needs the memo's
// rival to be the current rival and the total to be known; anything else writes a
// baseline (new rival) or nothing (no rival, unknown total, team game).
function skipCredit(
	input: ClockInputs,
	memo: SkipsSeen | undefined,
): { fresh: number; memo: SkipsSeen | null } {
	if (input.teamMode) return { fresh: 0, memo: null }
	if (input.rivalId === null) return { fresh: 0, memo: { rival: null } }
	if (input.rivalSkips === null) return { fresh: 0, memo: null }
	const next = { rival: input.rivalId, skips: input.rivalSkips }
	if (
		memo === undefined ||
		memo.rival === null ||
		memo.rival !== input.rivalId
	) {
		return { fresh: 0, memo: next }
	}
	return { fresh: Math.max(0, input.rivalSkips - memo.skips), memo: next }
}

// The clock after a run-out: Pressure refills to the base, Speedlatro is spent.
function afterRunOut(
	rules: PersonalClockRules,
	entry: PersonalClock,
	now: number,
): PersonalClock {
	return rules.kind === 'pressure'
		? { ...entry, ms: rules.baseMs, since: now }
		: { ...entry, ms: 0, since: now, running: false, spent: true }
}

// One player's clock for one tick, in the fixed precedence: reset, accrue
// (run-out), credit, charge, anchor, running/rate, then a second run-out check for
// a clock that starts running this tick with nothing left. A reset beats a run-out
// of the same tick. At most one `n` bump.
function stepPlayer(
	rules: PersonalClockRules,
	now: number,
	before: PersonalClock,
	input: ClockInputs,
	memo: SkipsSeen | undefined,
	incrementMs: number | null,
): {
	entry: PersonalClock
	memo: SkipsSeen | null
	runOut: Omit<ClockRunOut, 'playerId'> | null
} {
	let entry = before
	let dirty = false
	let runOut: Omit<ClockRunOut, 'playerId'> | null = null

	// 1. reset
	if (input.roundClosed) {
		entry = clockReset(rules, entry, now)
		dirty = true
	}

	// 2. accrue: a run-out when the live value is used up
	if (entry.running && clockLive(entry, now) === 0) {
		runOut = { kind: rules.kind, n: before.n }
		entry = afterRunOut(rules, entry, now)
		dirty = true
	}

	// 3. credit: an opponent skip, only while the player is neither timing nor timed
	const skip = skipCredit(input, memo)
	if (
		rules.kind === 'pressure' &&
		incrementMs !== null &&
		skip.fresh * incrementMs > 0 &&
		!input.timing &&
		!input.timed
	) {
		entry = clockCredit(settled(entry, now), skip.fresh * incrementMs)
		dirty = true
	}

	// 4. charge: Score Preview, the floor decided against the live value
	for (let i = 0; i < input.previews; i++) {
		const live = settled(entry, now)
		const charged = clockCharge(live, rules.previewCostMs)
		if (charged.ms !== live.ms) {
			entry = charged
			dirty = true
		}
	}

	// The Speedlatro anchor: the player's own blind start in a PvP round.
	if (
		rules.kind === 'speedlatro' &&
		input.pvpOpen &&
		input.blindStarted &&
		!entry.spent &&
		entry.graceUntil === null
	) {
		entry = {
			...settled(entry, now),
			ms: rules.pvpMs,
			graceUntil: now + rules.graceMs,
		}
		dirty = true
	}

	// 5. running / rate
	const running = clockRuns(rules, input, entry, now)
	const rate = clockRate(rules, input)
	if (running !== entry.running || rate !== entry.rate) {
		entry = { ...settled(entry, now), running, rate }
		dirty = true
	}

	// A clock that starts this tick with nothing left runs out now, not a tick
	// later (a re-tick at the same now must change nothing).
	if (runOut === null && entry.running && clockLive(entry, now) === 0) {
		runOut = { kind: rules.kind, n: before.n }
		entry = afterRunOut(rules, entry, now)
		dirty = true
	}

	return {
		entry: dirty ? { ...entry, n: before.n + 1 } : entry,
		memo: skip.memo,
		runOut,
	}
}

function sameSeen(a: SkipsSeen, b: SkipsSeen | undefined): boolean {
	if (b === undefined || a.rival !== b.rival) return false
	return a.rival === null || (b.rival !== null && a.skips === b.skips)
}

// Every player's personal clock for one tick. Every seated player has an input
// each tick and a seeded entry (the tick guarantees both); an input with no entry
// is skipped and listed in `missing`. Players are independent of one another.
export function clocksStep(
	rules: PersonalClockRules,
	now: number,
	clocks: { [userId: string]: PersonalClock },
	skipsSeen: { [userId: string]: SkipsSeen },
	inputs: { [userId: string]: ClockInputs },
	incrementMs: number | null,
): ClocksStepResult {
	const nextClocks = { ...clocks }
	const nextSeen = { ...skipsSeen }
	let clocksChanged = false
	let seenChanged = false
	const runOuts: ClockRunOut[] = []
	const missing: string[] = []
	for (const id of Object.keys(inputs).sort()) {
		const entry = clocks[id]
		if (entry === undefined) {
			missing.push(id)
			continue
		}
		const stepped = stepPlayer(
			rules,
			now,
			entry,
			inputs[id],
			skipsSeen[id],
			incrementMs,
		)
		if (stepped.entry !== entry) {
			nextClocks[id] = stepped.entry
			clocksChanged = true
		}
		if (stepped.memo !== null && !sameSeen(stepped.memo, skipsSeen[id])) {
			nextSeen[id] = stepped.memo
			seenChanged = true
		}
		if (stepped.runOut !== null) {
			runOuts.push({ playerId: id, ...stepped.runOut })
		}
	}
	// The same objects back when nothing changed: a quiet tick builds no new state.
	return {
		clocks: clocksChanged ? nextClocks : clocks,
		skipsSeen: seenChanged ? nextSeen : skipsSeen,
		runOuts,
		missing,
	}
}
