// The referee's decision step (docs/pvp-match.md sections 2, 6 and 7). The reducers
// in facts.ts only record facts; `decide` reads them from the log's `applied`
// cursor, once, and decides: lives (lives.ts), the timers (deadline.ts), the round's
// resolution (round_cycle.ts), pending deaths (deaths.ts), votes, the winner.
//
// `decide` is pure: plain state in, plain state out, no clock or ids but the
// injected context. referee.ts is the thin shell that reads and writes the lobby.
import type { StepContext } from '../../actions/registry'
import { type ClockInputs, clocksStep } from './clocks'
import {
	type TimerEnv,
	anteRunOuts,
	deadlineStep,
	plainDeadline,
	roundOpen,
} from './deadline'
import { settlePending } from './deaths'
import { consumeFacts, markLeft } from './lives'
import { maskedFor } from './mask'
import { pickMode, runHook } from './modes'
import { handsDone, highestAnte, scoreOf, seatedIds } from './modes/common'
import type { Mode, RunStart } from './modes/types'
import { syncClosed } from './opponent_facts'
import { seedOpponentFacts } from './opponent_state'
import { freezeNemesis } from './opponent_targets'
import { resultOf, withResult } from './result'
import {
	openNextRound,
	resolveLeftRound,
	resolveRound,
	withFacingRepinned,
} from './round_cycle'
import { settingsFromMetadata } from './settings'
import {
	type PvpLifePlayer,
	type PvpMode,
	type PvpResult,
	type PvpTeam,
	type RefereeState,
	inRunIgnoringLives,
	withMemo,
} from './state'

export interface TickEnv extends TimerEnv {
	runId: string
	// The players the game started with, in start order.
	startedIds: string[]
	// Those still seated in the lobby (an away player counts).
	seatedIds: string[]
	// The host-written lobby metadata the settings are read from.
	metadata: { [key: string]: unknown }
	// The teams the players picked in the lobby, and a matchmade split; both go
	// to the mode's `init`. The shell passes `{}` and null when the lobby has none.
	picks: { [id: string]: PvpTeam }
	teamPlan: string[][] | null
	// A player contested the game (mpapi_contest): see `decide`.
	contested?: boolean
	// Who has pressed Ready at least once for the coming round (PvpState.readied);
	// the personal clocks read it.
	readiedIds: string[]
	// The first replay event of the game has arrived (started.raceStartedAt): the run
	// began, so the tick freezes the rules (freezeIfNeeded).
	raceStarted: boolean
	// The lobby is a ranked one: a leave before the run began is a dodge there.
	ranked: boolean
	// The game's first run (not a restart): only it has the dodge window. Absent means yes.
	firstRun?: boolean
	// Started seats that are away when the Draft is done or the run starts (a dodge in
	// a ranked game of two). Absent when none is known to be.
	awayBeforeRun?: string[]
}

// What freezing the rules reads: the run, the lobby's metadata as it stands, and the
// team picks. TickEnv carries all of it.
export type FreezeEnv = Pick<
	TickEnv,
	'runId' | 'startedIds' | 'metadata' | 'picks' | 'teamPlan'
>

export type FreezeResult =
	| { ok: true; state: RefereeState }
	| { ok: false; reason: 'bad_rules'; key: string }

// How the game goes on after a step: it goes on (null), it is decided (finish), a
// passed seed vote starts the next game (restart), or a contested game of two ends
// with no result (contested).
export type TickEnd =
	| null
	| { kind: 'finish' }
	| { kind: 'restart' }
	| { kind: 'contested' }
	// A player left a ranked 2-player game before the run began: stored dodged, nobody
	// rated (D1d, docs/pvp-match.md section 7). The shell also writes the dodge record.
	| { kind: 'dodged'; leaverId: string }
	// Every started player left (or forfeited) before the run began: nobody wins,
	// nothing is rated; the shell records a dodge for each in a ranked lobby.
	| { kind: 'bothGone'; leaverIds: string[] }
	// A ranked run after the freeze ended in a draw because every player forfeited or
	// left (none died): stored abandoned and rated for no one (casual and private keep
	// the draw).
	| { kind: 'forfeited' }
	// The settings do not validate at the freeze (a key the metadata guard would have
	// refused): the game cannot be refereed, and the shell abandons it.
	| { kind: 'unrefereeable'; key: string }

export interface TickOutcome {
	state: RefereeState
	end: TickEnd
}

// `seated`: the started seats that have not left; the started count when left out.
export type ModeFor = (mode: PvpMode, n: number, seated?: number) => Mode

// What a leave (or a forfeit) before the run began does to the game (D1d): in a 2-player
// game it ends there and then, in a larger one the leaver is just out and the game goes
// on (the ordinary leave path, once the rules freeze).
export type PreFreezeEnd =
	| { kind: 'none' }
	| { kind: 'result'; result: PvpResult }
	| { kind: 'dodged'; leaverId: string }

export function preFreezeEnd(
	startedIds: string[],
	leaverId: string,
	runId: string,
	ranked: boolean,
): PreFreezeEnd {
	if (startedIds.length !== 2 || !startedIds.includes(leaverId))
		return { kind: 'none' }
	if (ranked) return { kind: 'dodged', leaverId }
	const stayer = startedIds.find((id) => id !== leaverId)
	if (stayer === undefined) return { kind: 'none' }
	return {
		kind: 'result',
		result: {
			runId,
			kind: 'win',
			winnerId: stayer,
			winnerTeam: null,
			places: [
				{ playerId: stayer, place: 1 },
				{ playerId: leaverId, place: 2 },
			],
		},
	}
}

// Who is out of a game whose run has not begun: seats that left the lobby, and
// players whose pvp.forfeit is in the log (it is not applied before the freeze).
function leaversOf(state: RefereeState, env: TickEnv): string[] {
	const seated = new Set(env.seatedIds)
	return env.startedIds.filter(
		(id) =>
			!seated.has(id) ||
			state.facts.log.some((f) => f.type === 'forfeit' && f.playerId === id),
	)
}

function inRunIds(state: RefereeState): string[] {
	return Object.keys(state.lives.players).filter((id) =>
		inRunIgnoringLives(state.lives.players[id]),
	)
}

function freshLife(lives: number): PvpLifePlayer {
	return {
		lives,
		eliminated: false,
		forfeited: false,
		left: false,
		events: [],
	}
}

// The opponent of `id` as the mode's view pairs them, null with none (a bye).
function rivalIdOf(state: RefereeState, mode: Mode, id: string): string | null {
	return mode.view?.(state).opponents[id] ?? null
}

// The skip baseline of every starter's personal clock: their opponent now, and the
// opponent's skips so far (0 in a new run). Read after the mode's init made the pairing.
function withSkipsSeen(
	state: RefereeState,
	mode: Mode,
	ids: readonly string[],
): RefereeState {
	const skipsSeen: RefereeState['facts']['skipsSeen'] = {}
	for (const id of ids) {
		const rival = rivalIdOf(state, mode, id)
		skipsSeen[id] = rival === null ? { rival: null } : { rival, skips: 0 }
	}
	return { ...state, facts: { ...state.facts, skipsSeen } }
}

// Freezes the settings (`state.rules`) of this run from the metadata as it stands, seats
// every starter with the starting lives, then lets the mode settle the roster. Idempotent:
// a state already frozen for the run (`rules.runId === env.runId`) comes back as it is. Its two
// callers are the PvP request shell (register.ts) and the tick, once the run began.
export function freezeIfNeeded(
	state: RefereeState,
	env: FreezeEnv,
	ctx: StepContext,
	modeFor: ModeFor = pickMode,
): FreezeResult {
	if (state.rules.runId === env.runId) return { ok: true, state }
	const found = settingsFromMetadata(env.metadata, env.startedIds)
	if (!found.ok) return found
	const settings = found.settings
	const players = { ...state.lives.players }
	for (const id of env.startedIds)
		if (!players[id]) players[id] = freshLife(settings.startingLives)
	// The mode's init settles a run once, keyed on round.runId, so that is left
	// for it; whatever it leaves unset is stamped with the runId afterwards.
	// A new run has 0 skips: a known fact the server owns, so a client reports only
	// real skips (pvp.skip).
	const skips = { ...state.facts.skips }
	for (const id of env.startedIds)
		skips[id] = { skips: 0, skipsAtPvp: 0, facing: null, spentMs: 0 }
	// A new run starts every personal clock full and stopped; a previous run's
	// entries are replaced, never merged. `since` is this tick's moment.
	const personal = settings.clocks.personal
	const clocks: RefereeState['facts']['clocks'] = {}
	if (personal !== null)
		for (const id of env.startedIds)
			clocks[id] = {
				ms: personal.baseMs,
				running: false,
				rate: 1,
				since: ctx.now,
				n: 1,
				spent: false,
				graceUntil: null,
			}
	const frozen: RefereeState = {
		...state,
		facts: {
			...state.facts,
			...seedOpponentFacts(env.startedIds),
			// A new run starts with nobody animating. D1d says to keep the entries, but every
			// pvp.animating freezes first, so an entry found at the freeze is the previous
			// run's, which would hold the new run's timers paused.
			animating: [],
			skips,
			clocks,
			skipsSeen: {},
		},
		rules: { runId: env.runId, ...settings },
		lives: { ...state.lives, players },
	}
	const mode = modeFor(settings.mode, settings.startedCount)
	const start: RunStart = {
		startedIds: env.startedIds,
		picks: env.picks,
		teamPlan: env.teamPlan,
	}
	const afterInit = runHook((s, c) => mode.init(s, c, start), frozen, ctx)
	const inited =
		personal === null ? afterInit : withSkipsSeen(afterInit, mode, env.startedIds)
	return {
		ok: true,
		state: {
			...inited,
			round: { ...inited.round, runId: env.runId },
			lives: { ...inited.lives, runId: env.runId },
			teams: { ...inited.teams, runId: env.runId },
			votes: { ...inited.votes, runId: env.runId },
		},
	}
}

// A result a mode wrote without places gets the standard ones.
function placed(state: RefereeState): RefereeState {
	const r = state.result
	if (r.kind === null || r.places.length > 0) return state
	return { ...state, result: resultOf(state, r.kind, r.winnerId) }
}

function unanimous(votes: string[], voters: string[]): boolean {
	return voters.length > 0 && voters.every((id) => votes.includes(id))
}

// R13: a vote passes when every player still in the run (and seated) said yes.
function decideVotes(
	state: RefereeState,
	env: TickEnv,
): {
	state: RefereeState
	restart: boolean
} {
	if (state.votes.runId !== state.rules.runId) return { state, restart: false }
	const seated = new Set(env.seatedIds)
	const voters = inRunIds(state).filter((id) => seated.has(id))
	if (unanimous(state.votes.draw, voters))
		return { state: withResult(state, 'draw', null), restart: false }
	return { state, restart: unanimous(state.votes.seed, voters) }
}

// Facts nobody dedupes on are dropped once the tick has read them (the cursor goes
// with them), so the log every request scans stays short: a timer start or pause, a
// hand credit, a preview charge and a progress move are read once, through `fresh`
// (a progress move re-arms the team guard, lives.ts), and a blind
// result lives on in `facts.blinds`, where mergeBlind dedupes it. Voucher and
// forfeit facts stay: their requests dedupe against the log.
function withoutConsumedFacts(state: RefereeState): RefereeState {
	const log = state.facts.log
	const kept = log.filter(
		(fact) =>
			fact.type !== 'timer_start' &&
			fact.type !== 'timer_pause' &&
			fact.type !== 'blind' &&
			fact.type !== 'hand_credit' &&
			fact.type !== 'preview_charge' &&
			fact.type !== 'progress',
	)
	if (kept.length === log.length) return state
	return {
		...state,
		facts: { ...state.facts, log: kept, applied: kept.length },
	}
}

// The personal clocks' step (clocks.ts): gathers every clock holder's inputs as
// plain values, steps them all, stores the clocks and the skip baselines, and
// takes a life for each run-out the way an Ante run-out does. `opened` is the
// roundId of the round that was playing when the tick began, null when none.
function stepClocks(
	state: RefereeState,
	mode: Mode,
	env: TickEnv,
	fresh: RefereeState['facts']['log'],
	opened: number | null,
	now: number,
): RefereeState {
	const rules = state.rules
	if (rules.runId === null || rules.clocks.personal === null) return state
	const personal = rules.clocks.personal
	const deadline = plainDeadline(state.facts.deadline)
	const stillPlaying =
		opened !== null &&
		state.round.phase === 'playing' &&
		state.round.roundId === opened
	const teamMode = rules.mode === 'manhunt' || rules.mode === 'teams'
	const inputs: { [id: string]: ClockInputs } = {}
	for (const id of Object.keys(state.facts.clocks)) {
		const entry = state.round.players[id]
		const rivalId = rivalIdOf(state, mode, id)
		const rivalScore =
			rivalId === null || maskedFor(state, id) ? null : scoreOf(state, rivalId)
		inputs[id] = {
			inRun: inRunIgnoringLives(state.lives.players[id]),
			ready: env.readyIds.includes(id),
			readied: env.readiedIds.includes(id),
			away: env.awayIds.includes(id),
			animating: state.facts.animating.includes(id),
			pvpOpen: roundOpen(state),
			roundClosed: opened !== null && !stillPlaying,
			timing: deadline !== null && deadline.by === id,
			timed: deadline?.against.includes(id) === true,
			blindStarted: entry !== undefined && entry.reportedHands !== null,
			handsDone: entry !== undefined && handsDone(entry),
			score: entry === undefined ? null : entry.score,
			rival: rivalId === null ? null : { score: rivalScore },
			rivalId,
			rivalSkips: rivalId === null ? null : (state.facts.skips[rivalId]?.skips ?? null),
			teamMode,
			previews: fresh.filter(
				(fact) => fact.type === 'preview_charge' && fact.playerId === id,
			).length,
		}
	}
	const stepped = clocksStep(
		personal,
		now,
		state.facts.clocks,
		state.facts.skipsSeen,
		inputs,
		rules.timerIncrementMs,
	)
	// Nothing the clocks publish moved: the same state back, so a quiet tick builds no
	// new referee state and announces nothing.
	if (
		stepped.clocks === state.facts.clocks &&
		stepped.skipsSeen === state.facts.skipsSeen &&
		stepped.runOuts.length === 0
	)
		return state
	const stored: RefereeState = {
		...state,
		facts: {
			...state.facts,
			clocks: stepped.clocks,
			skipsSeen: stepped.skipsSeen,
		},
	}
	if (stepped.runOuts.length === 0) return stored
	return anteRunOuts(
		stored,
		mode,
		stepped.runOuts.map((out) => out.playerId),
	)
}

// Who is animating, as far as the server can still tell: a player who disconnected, left
// or is out of the run is dropped, and every one is when a round closed in this tick (the
// client sends the next transition itself). The same state back when nothing changes.
function withAnimatingKept(
	state: RefereeState,
	env: TickEnv,
	roundClosed: boolean,
): RefereeState {
	const before = state.facts.animating
	const kept = roundClosed
		? []
		: before.filter(
				(id) =>
					env.seatedIds.includes(id) &&
					!env.awayIds.includes(id) &&
					inRunIgnoringLives(state.lives.players[id]),
			)
	if (kept.length === before.length) return state
	return { ...state, facts: { ...state.facts, animating: kept } }
}

// A game decided in this tick shows no deadline in the STATE that carries the result.
function withoutDeadline(state: RefereeState): RefereeState {
	if (state.facts.deadline === undefined || state.facts.deadline === null)
		return state
	return { ...state, facts: { ...state.facts, deadline: null } }
}

// A ranked run that ended because every seat forfeited or left (nobody won on play, so
// the settle drew; a seat that died is neither): it is rated for no one, so two players
// cannot trade wins by forfeiting together. No guard on the result kind is needed: with
// no seat in the run the only result is a draw.
function allForfeited(state: RefereeState, env: TickEnv): boolean {
	if (!env.ranked) return false
	const seats = Object.values(state.lives.players)
	return seats.length > 0 && seats.every((s) => s.forfeited || s.left)
}

// One referee step. The same object back when nothing changed.
export function decide(
	state: RefereeState,
	env: TickEnv,
	ctx: StepContext,
	modeFor: ModeFor = pickMode,
): TickOutcome {
	// A contested game of two is not decided here: it is stored contested at once,
	// for a moderator. In a larger game only the contester leaves and the others
	// play on (docs/pvp-match.md section 7).
	if (env.contested && env.startedIds.length <= 2)
		return { state, end: { kind: 'contested' } }

	// A decided game is frozen; all that is left is to finish it.
	if (state.result.runId === env.runId && state.result.kind !== null)
		return { state, end: { kind: 'finish' } }

	// Before the run began (no replay event yet) only a leave or forfeit is decided, and
	// that does not depend on whether a request already froze the rules: a request from
	// the player who stayed must not turn a dodge into a rated forfeit. Once the run
	// began, the tick freezes (idempotent: the request shell may have).
	// A seat still away when the Draft is done or the run starts counts as a leaver too
	// (a dodge in a ranked game of two): see awayBeforeRunOf (freeze_env.ts).
	const wasAway = env.awayBeforeRun ?? []
	if (!env.raceStarted || wasAway.length > 0) {
		const gone = env.raceStarted ? [] : leaversOf(state, env)
		const leavers = gone.concat(wasAway.filter((id) => !gone.includes(id)))
		// Every started player gone is no one's win: the game ends abandoned.
		if (env.startedIds.length >= 2 && leavers.length === env.startedIds.length)
			return { state, end: { kind: 'bothGone', leaverIds: leavers } }
		const leaver = leavers.length === 1 ? leavers[0] : undefined
		const ended =
			leaver === undefined
				? null
				: preFreezeEnd(env.startedIds, leaver, env.runId, env.ranked && env.firstRun !== false)
		if (ended !== null && ended.kind === 'dodged')
			return { state, end: { kind: 'dodged', leaverId: ended.leaverId } }
		if (ended !== null && ended.kind === 'result')
			return { state: { ...state, result: ended.result }, end: { kind: 'finish' } }
		if (!env.raceStarted) return { state, end: null }
	}
	const frozen = freezeIfNeeded(state, env, ctx, modeFor)
	if (!frozen.ok)
		return { state, end: { kind: 'unrefereeable', key: frozen.key } }
	let next = frozen.state
	const rules = next.rules
	// A frozen state always has a mode; one that does not is unrefereeable (and logged).
	const frozenMode = rules.mode
	if (frozenMode === null)
		return { state, end: { kind: 'unrefereeable', key: 'queue_mode' } }
	const modeNow = (s: RefereeState): Mode =>
		modeFor(frozenMode, rules.startedCount, seatedIds(s).length)
	let mode = modeNow(next)
	// The round playing when the tick began: the clocks reset when it closes.
	const opened = state.round.phase === 'playing' ? state.round.roundId : null

	const fresh = next.facts.log.slice(next.facts.applied)
	const consumed = consumeFacts(next, mode)
	const left = markLeft(consumed.state, env.startedIds, env.seatedIds)
	next = left.state
	if (consumed.gone.length + left.gone.length > 0) {
		// The forfeit hook may call checkWinner; while a death record is open only
		// settleMany writes the result (it has the places the record decides).
		const undecided = next.result
		next = runHook(mode.onForfeit, next, ctx)
		if (next.facts.deaths.length > 0)
			next = { ...next, result: undecided }
	}
	// Who is alive and seated may have changed: the round plays by that count.
	mode = modeNow(next)

	next = withAnimatingKept(next, env, false)
	next = deadlineStep(next, mode, env, fresh, ctx.now)
	next = resolveRound(next, mode, ctx)
	// A start that arrived while the round is still playing closes it here, on the
	// pairing it was played with, before the Ante step below re-pairs.
	next = resolveLeftRound(next, mode, ctx)

	// Null while nobody has reported an ante: nothing to act on yet.
	const ante = highestAnte(next)
	// A new ante is acted on only between rounds: a player who reports the next
	// ante while a round is open must not change the pairing it is played with.
	// A start that arrived while the round was still playing has already closed it
	// in `resolveLeftRound` above.
	if (ante !== null && !roundOpen(next) && ante > next.facts.anteSeen) {
		next = withMemo(next, { anteSeen: ante })
		if (mode.onAnte) {
			next = runHook(mode.onAnte, next, ctx)
			next = withFacingRepinned(next, mode)
		}
	}
	next = openNextRound(next, mode, ctx)
	next = withAnimatingKept(
		next,
		env,
		opened !== null &&
			!(next.round.phase === 'playing' && next.round.roundId === opened),
	)
	next = withoutConsumedFacts(
		stepClocks(next, mode, env, fresh, opened, ctx.now),
	)
	// The Nemesis rows freeze on the state the Ante step just left (pvp.nemesis
	// is announced by its projection when a row was written).
	next = freezeNemesis(next).state

	next = settlePending(next, mode)
	const voted = decideVotes(next, env)
	next = voted.state
	// A pending death holds the verdict back until it settles; in a game of 3+
	// players a death record keeps it back until settleMany ends the game (R32).
	if (
		next.result.kind === null &&
		next.lives.pending.length === 0 &&
		next.facts.deaths.length === 0
	)
		next = runHook(mode.checkWinner, next, ctx)
	next = placed(next)
	next = syncClosed(next).state

	if (next.result.kind !== null)
		return {
			state: withoutDeadline(next),
			end: allForfeited(next, env) ? { kind: 'forfeited' } : { kind: 'finish' },
		}
	return {
		state: next,
		end: voted.restart ? { kind: 'restart' } : null,
	}
}
