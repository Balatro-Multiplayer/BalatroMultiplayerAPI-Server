// The timetable: when rounds start, when matches open, how long players have
// to ready up, and what happens when they don't. Pure: the server's clock
// calls tick() with the current time and stores what comes back; tick never
// reads the time itself, so tests drive it with a fake clock.
//
// A bracket's rounds are grouped into steps (rounds that can be played at the
// same time; see roundSteps). The organiser's schedule is a list of blocks,
// each covering the next run of steps with its own rules:
//   start    -- after the previous block (plus a break), at a fixed time, or
//               when the organiser presses start
//   opening  -- synchronized: a step's matches open together, once every
//               earlier step is done; rolling: a match opens as soon as both
//               its players are known
//   play     -- live: ready up within N minutes; window: play by a deadline
// A match goes ready_up -> in_game (both ready: the caller makes the lobby)
// -> back to ready_up between games of a series -> closed. A missed
// deadline: live forfeits that game to the side that readied; a window
// forfeits the match to the side that readied at least once; when neither
// did, the match waits for the organiser ('unplayed') and the block's
// fallback applies after its delay.
import { type Result, err, ok } from '../../shared/result'
import { decideMatch, isFinished, nextSwissRound, recordGame, swissRoundsPlayed } from './bracket'
import { resolveBracket } from './resolve'
import type { Bracket, EngineError, EntrantId, ResolvedMatch, Side, Stage } from './types'

export const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

export interface RoundRef {
	stage: Stage
	round: number
}

export type StartRule = { kind: 'after_previous'; breakMinutes: number } | { kind: 'at'; at: number } | { kind: 'manual' }

export type PlayRule = { kind: 'live'; readyUpMinutes: number } | { kind: 'window'; closesAt?: number; durationMinutes?: number }

export interface ScheduleBlock {
	// Index (exclusive) into roundSteps() where this block ends; blocks run
	// back to back, the last one ending at the final step.
	untilStep: number
	start: StartRule
	opening: 'synchronized' | 'rolling'
	play: PlayRule
	// Ready-up time between games of a series.
	seriesReadyUpMinutes: number
	// What an unplayed match falls back to, and after how long (0-12 h).
	unplayed: { fallbackAfterHours: number; fallback: 'higher_seed' | 'both_lose' }
	// Minutes before a deadline to remind both players (window play).
	reminders?: number[]
}

export type MatchPhase = 'ready_up' | 'in_game' | 'unplayed' | 'closed'

export interface MatchClock {
	openedAt: number
	phase: MatchPhase
	// Ready-up deadline (ready_up only).
	deadline: number | null
	// Ready right now (both -> a game starts).
	ready: [boolean, boolean]
	// First ready press in the current ready-up, per side; a window forfeit
	// goes to whoever readied at least once.
	readiedAt: [number | null, number | null]
	// Every ready press, for the organiser judging an unplayed match.
	readyLog: { side: Side; at: number }[]
	// Games recorded when the current phase began (a new one means a game ended).
	gamesSeen: number
	unplayedSince?: number
	remindersSent: number[]
	// Who the clock was opened for: a correction that changes the pairing
	// restarts it.
	players?: [EntrantId, EntrantId]
	// When the current game was handed to a lobby (in_game).
	inGameSince?: number
	// How many games this match has handed to a lobby: identifies the
	// current hand-off, so a lobby's result only counts for the game it was
	// made for (never reset, unlike inGameSince).
	handoff?: number
}

export interface BlockClock {
	startedAt?: number
	finishedAt?: number
	// Set by the organiser for a manual start (or to start a block early).
	startRequestedAt?: number
}

export interface TimetableState {
	startedAt: number
	pausedSince?: number
	blocks: BlockClock[]
	matches: { [matchId: string]: MatchClock }
	finishedAt?: number
}

export type TimetableEvent =
	| { kind: 'block_started'; block: number }
	| { kind: 'block_finished'; block: number }
	| { kind: 'match_opened'; matchId: string; players: [EntrantId, EntrantId]; deadline: number | null }
	| { kind: 'match_reset'; matchId: string }
	| { kind: 'lobby_needed'; matchId: string; players: [EntrantId, EntrantId]; game: number }
	| { kind: 'series_ready_up'; matchId: string; deadline: number }
	| { kind: 'game_forfeited'; matchId: string; winner: Side }
	| { kind: 'match_forfeited'; matchId: string; winner: Side }
	| { kind: 'unplayed'; matchId: string; fallbackAt: number }
	| { kind: 'fallback_applied'; matchId: string; fallback: 'higher_seed' | 'both_lose' }
	| { kind: 'reminder'; matchId: string; minutesLeft: number }
	| { kind: 'swiss_round_paired'; round: number }
	| { kind: 'finished' }

export interface TickInput {
	bracket: Bracket
	schedule: ScheduleBlock[]
	state: TimetableState
	now: number
	dropped?: EntrantId[]
	// Series length for a round paired later (Swiss); default 1.
	bestOfFor?: (stage: Stage, round: number) => number
}

export interface TickOutput {
	bracket: Bracket
	state: TimetableState
	events: TimetableEvent[]
	// When tick next has something to do (null: only player or organiser
	// actions can change anything).
	nextWakeAt: number | null
}

// The bracket's rounds grouped into steps that can be played at the same
// time, in play order. Double elimination interleaves the two brackets:
// W1 | W2 L1 | L2 | W3 L3 | L4 | ... | GF1 | GF2.
export function roundSteps(bracket: Bracket): RoundRef[][] {
	const maxRound = (stage: Stage) => bracket.matches.reduce((max, m) => (m.stage === stage ? Math.max(max, m.round) : max), 0)
	switch (bracket.format) {
		case 'single_elim': {
			const steps: RoundRef[][] = []
			for (let r = 1; r <= maxRound('W'); r++) steps.push([{ stage: 'W', round: r }])
			return steps
		}
		case 'double_elim': {
			const k = maxRound('W')
			const steps: RoundRef[][] = [[{ stage: 'W', round: 1 }]]
			for (let j = 1; j <= k - 1; j++) {
				steps.push([
					{ stage: 'W', round: j + 1 },
					{ stage: 'L', round: 2 * j - 1 },
				])
				steps.push([{ stage: 'L', round: 2 * j }])
			}
			steps.push([{ stage: 'GF', round: 1 }])
			if (bracket.matches.some((m) => m.id === 'GF2')) steps.push([{ stage: 'GF', round: 2 }])
			return steps
		}
		case 'round_robin': {
			const steps: RoundRef[][] = []
			for (let r = 1; r <= maxRound('RR'); r++) steps.push([{ stage: 'RR', round: r }])
			return steps
		}
		case 'swiss': {
			const steps: RoundRef[][] = []
			for (let r = 1; r <= (bracket.options.swissRounds ?? 0); r++) steps.push([{ stage: 'SW', round: r }])
			return steps
		}
	}
}

export function validateSchedule(bracket: Bracket, schedule: ScheduleBlock[]): Result<true, EngineError> {
	const steps = roundSteps(bracket).length
	if (schedule.length === 0) return err({ code: 'invalid', message: 'The schedule needs at least one block' })
	let previous = 0
	for (let i = 0; i < schedule.length; i++) {
		const b = schedule[i]
		if (b.untilStep <= previous) return err({ code: 'invalid', message: `Block ${i + 1} covers no rounds` })
		previous = b.untilStep
		if (b.play.kind === 'live' && (b.play.readyUpMinutes < 2 || b.play.readyUpMinutes > 30)) {
			return err({ code: 'invalid', message: 'Ready-up time must be 2-30 minutes' })
		}
		if (b.play.kind === 'window' && b.play.closesAt === undefined && !(b.play.durationMinutes && b.play.durationMinutes > 0)) {
			return err({ code: 'invalid', message: 'A play window needs a closing time or a duration' })
		}
		if (b.seriesReadyUpMinutes < 2 || b.seriesReadyUpMinutes > 30) {
			return err({ code: 'invalid', message: 'Series ready-up time must be 2-30 minutes' })
		}
		if (b.unplayed.fallbackAfterHours < 0 || b.unplayed.fallbackAfterHours > 12) {
			return err({ code: 'invalid', message: 'Fallback delay must be 0-12 hours' })
		}
		if (i === 0 && b.start.kind === 'after_previous' && b.start.breakMinutes !== 0) {
			return err({ code: 'invalid', message: 'The first block starts with the tournament' })
		}
		if (bracket.format === 'swiss' && b.opening === 'rolling') {
			return err({ code: 'invalid', message: 'Swiss rounds always open together' })
		}
	}
	if (previous !== steps) return err({ code: 'invalid', message: `The schedule must cover all ${steps} rounds` })
	return ok(true)
}

export type Preset = 'live_event' | 'live_fixed_rounds' | 'league'

// Ready-made schedules for the create wizard; the organiser can edit the
// blocks afterwards ("Custom").
export function presetSchedule(
	bracket: Bracket,
	preset: Preset,
	options: { breakMinutes?: number; readyUpMinutes?: number; roundStarts?: number[]; windowMinutes?: number } = {},
): ScheduleBlock[] {
	const steps = roundSteps(bracket).length
	const base = { seriesReadyUpMinutes: 3, unplayed: { fallbackAfterHours: 0, fallback: 'higher_seed' as const } }
	const live: PlayRule = { kind: 'live', readyUpMinutes: options.readyUpMinutes ?? 10 }
	if (preset === 'live_event') {
		// No breaks: one rolling block, each match opening as soon as both
		// players are known. With breaks: a block per round, each starting the
		// break after the previous round has finished.
		const breakMinutes = options.breakMinutes ?? 0
		if (breakMinutes === 0) {
			return [{ ...base, untilStep: steps, start: { kind: 'after_previous', breakMinutes: 0 }, opening: bracket.format === 'swiss' ? 'synchronized' : 'rolling', play: live }]
		}
		const blocks: ScheduleBlock[] = []
		for (let s = 1; s <= steps; s++) {
			blocks.push({ ...base, untilStep: s, start: { kind: 'after_previous', breakMinutes: s === 1 ? 0 : breakMinutes }, opening: 'synchronized', play: live })
		}
		return blocks
	}
	if (preset === 'live_fixed_rounds') {
		const starts = options.roundStarts ?? []
		const blocks: ScheduleBlock[] = []
		for (let s = 1; s <= steps; s++) {
			const at = starts[s - 1]
			blocks.push({
				...base,
				untilStep: s,
				start: at !== undefined ? { kind: 'at', at } : s === 1 ? { kind: 'after_previous', breakMinutes: 0 } : { kind: 'manual' },
				opening: 'synchronized',
				play: live,
			})
		}
		return blocks
	}
	const window: PlayRule = { kind: 'window', durationMinutes: options.windowMinutes ?? 7 * 24 * 60 }
	const blocks: ScheduleBlock[] = []
	for (let s = 1; s <= steps; s++) {
		blocks.push({
			...base,
			unplayed: { fallbackAfterHours: 12, fallback: 'higher_seed' },
			untilStep: s,
			start: { kind: 'after_previous', breakMinutes: 0 },
			opening: 'synchronized',
			play: window,
			reminders: [24 * 60, 60],
		})
	}
	return blocks
}

export function newTimetable(startedAt: number, schedule: ScheduleBlock[]): TimetableState {
	return { startedAt, blocks: schedule.map(() => ({})), matches: {} }
}

// Which block and step each round belongs to.
function locate(bracket: Bracket, schedule: ScheduleBlock[]): { [key: string]: { block: number; step: number } } {
	const steps = roundSteps(bracket)
	const out: { [key: string]: { block: number; step: number } } = {}
	let block = 0
	steps.forEach((step, index) => {
		while (block < schedule.length - 1 && index >= schedule[block].untilStep) block++
		for (const r of step) out[`${r.stage}${r.round}`] = { block, step: index }
	})
	return out
}

// The schedule block a round belongs to (null if none does).
export function blockOfRound(bracket: Bracket, schedule: ScheduleBlock[], stage: Stage, round: number): ScheduleBlock | null {
	const loc = locate(bracket, schedule)[`${stage}${round}`]
	return loc ? schedule[loc.block] : null
}

function blockStartTime(i: number, schedule: ScheduleBlock[], state: TimetableState): number | null {
	const clock = state.blocks[i]
	if (clock.startRequestedAt !== undefined) return clock.startRequestedAt
	const rule = schedule[i].start
	if (rule.kind === 'at') return rule.at
	if (rule.kind === 'manual') return null
	if (i === 0) return state.startedAt + rule.breakMinutes * MINUTE_MS
	const previous = state.blocks[i - 1].finishedAt
	return previous === undefined ? null : previous + rule.breakMinutes * MINUTE_MS
}

function deadlineFor(play: PlayRule, opened: number): number | null {
	if (play.kind === 'live') return opened + play.readyUpMinutes * MINUTE_MS
	if (play.closesAt !== undefined) return play.closesAt
	return play.durationMinutes ? opened + play.durationMinutes * MINUTE_MS : null
}

function cloneState(state: TimetableState): TimetableState {
	const matches: { [id: string]: MatchClock } = {}
	for (const id of Object.keys(state.matches)) {
		const m = state.matches[id]
		matches[id] = { ...m, ready: [m.ready[0], m.ready[1]], readiedAt: [m.readiedAt[0], m.readiedAt[1]], readyLog: m.readyLog.slice(), remindersSent: m.remindersSent.slice() }
	}
	return { ...state, blocks: state.blocks.map((b) => ({ ...b })), matches }
}

function seedOf(bracket: Bracket, id: EntrantId): number {
	const i = bracket.seeds.indexOf(id)
	return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

function isSettled(m: ResolvedMatch | undefined): boolean {
	return !m || m.status === 'done' || m.status === 'void'
}

function playersOf(m: ResolvedMatch): [EntrantId, EntrantId] | null {
	const [a, b] = m.players
	return typeof a === 'string' && typeof b === 'string' ? [a, b] : null
}

function unwrap(r: Result<Bracket, EngineError>): Bracket {
	if (!r.ok) throw new Error(`timetable: ${r.error.code}: ${r.error.message}`)
	return r.value
}

export function tickTimetable(input: TickInput): TickOutput {
	const dropped = input.dropped ?? []
	const { schedule, now } = input
	let bracket = input.bracket
	const state = cloneState(input.state)
	const events: TimetableEvent[] = []
	const wake: number[] = []
	const out = (): TickOutput => ({ bracket, state, events, nextWakeAt: wake.length ? Math.max(now + 1, Math.min(...wake)) : null })

	if (state.finishedAt !== undefined || state.pausedSince !== undefined) return { bracket, state, events, nextWakeAt: null }
	const where = locate(bracket, schedule)
	const stepCount = roundSteps(bracket).length

	// Loop until nothing changes: one change (a forfeit, a finished block) can
	// open the next match or block at the same moment.
	for (let pass = 0; pass < 1000; pass++) {
		let changed = false
		wake.length = 0
		let resolved = resolveBracket(bracket, dropped)

		// Swiss: pair the next round as soon as the current one is done.
		if (bracket.format === 'swiss') {
			const played = swissRoundsPlayed(bracket)
			const current = resolved.matches.filter((m) => m.def.round === played)
			if (played < (bracket.options.swissRounds ?? 0) && current.every(isSettled)) {
				const next = nextSwissRound(bracket, dropped, input.bestOfFor ? input.bestOfFor('SW', played + 1) : 1)
				if (next.ok) {
					bracket = next.value
					events.push({ kind: 'swiss_round_paired', round: played + 1 })
					continue
				}
			}
		}

		// Steps whose every match is done (an unpaired Swiss round is not).
		const swissPaired = bracket.format === 'swiss' ? swissRoundsPlayed(bracket) : Number.MAX_SAFE_INTEGER
		const stepDone: boolean[] = roundSteps(bracket).map((step) =>
			step.every((r) => (r.stage === 'SW' && r.round > swissPaired ? false : resolved.matches.filter((m) => m.def.stage === r.stage && m.def.round === r.round).every(isSettled))),
		)

		// Blocks: finish, then start.
		let firstStep = 0
		for (let i = 0; i < schedule.length; i++) {
			const clock = state.blocks[i]
			const lastStep = schedule[i].untilStep
			if (clock.startedAt !== undefined && clock.finishedAt === undefined && stepDone.slice(firstStep, lastStep).every(Boolean)) {
				clock.finishedAt = now
				events.push({ kind: 'block_finished', block: i })
				changed = true
			}
			if (clock.startedAt === undefined) {
				const at = blockStartTime(i, schedule, state)
				if (at !== null && at <= now) {
					clock.startedAt = now
					events.push({ kind: 'block_started', block: i })
					changed = true
				} else if (at !== null) wake.push(at)
			}
			firstStep = lastStep
		}
		if (changed) continue

		// Matches.
		for (const m of resolved.matches) {
			const loc = where[`${m.def.stage}${m.def.round}`]
			if (!loc) continue
			const block = schedule[loc.block]
			const blockClock = state.blocks[loc.block]
			const clock = state.matches[m.def.id]
			const pair = playersOf(m)

			if (!clock) {
				// Open it?
				if (blockClock.startedAt === undefined || m.status !== 'ready' || !pair) continue
				if (block.opening === 'synchronized' && !stepDone.slice(0, loc.step).every(Boolean)) continue
				const deadline = deadlineFor(block.play, now)
				state.matches[m.def.id] = {
					openedAt: now,
					phase: 'ready_up',
					deadline,
					ready: [false, false],
					readiedAt: [null, null],
					readyLog: [],
					gamesSeen: m.def.games.length,
					remindersSent: [],
					players: pair,
				}
				events.push({ kind: 'match_opened', matchId: m.def.id, players: pair, deadline })
				changed = true
				continue
			}
			// An organiser correction reopened this match, or changed who plays
			// it: start its clock again from scratch.
			const reopened = clock.phase === 'closed' && m.status !== 'done' && m.status !== 'void'
			const repaired = clock.players !== undefined && pair !== null && (clock.players[0] !== pair[0] || clock.players[1] !== pair[1])
			if (reopened || repaired) {
				delete state.matches[m.def.id]
				events.push({ kind: 'match_reset', matchId: m.def.id })
				changed = true
				continue
			}
			if (clock.phase === 'closed') continue
			if (m.status === 'done' || m.status === 'void' || !pair) {
				clock.phase = 'closed'
				clock.deadline = null
				changed = true
				continue
			}

			// A game ended: ready up again for the next one.
			if (m.def.games.length !== clock.gamesSeen) {
				clock.gamesSeen = m.def.games.length
				clock.phase = 'ready_up'
				clock.ready = [false, false]
				clock.readiedAt = [null, null]
				clock.deadline = now + block.seriesReadyUpMinutes * MINUTE_MS
				clock.remindersSent = []
				events.push({ kind: 'series_ready_up', matchId: m.def.id, deadline: clock.deadline })
				changed = true
				continue
			}

			if (clock.phase === 'ready_up') {
				if (clock.ready[0] && clock.ready[1]) {
					clock.phase = 'in_game'
					clock.deadline = null
					clock.inGameSince = now
					clock.handoff = (clock.handoff ?? 0) + 1
					events.push({ kind: 'lobby_needed', matchId: m.def.id, players: pair, game: m.def.games.length + 1 })
					changed = true
					continue
				}
				if (clock.deadline === null) continue
				for (const minutes of block.reminders ?? []) {
					const at = clock.deadline - minutes * MINUTE_MS
					if (clock.remindersSent.indexOf(minutes) !== -1 || at <= clock.openedAt) continue
					if (now >= at && now < clock.deadline) {
						clock.remindersSent.push(minutes)
						events.push({ kind: 'reminder', matchId: m.def.id, minutesLeft: minutes })
					} else if (now < at) wake.push(at)
				}
				if (now < clock.deadline) {
					wake.push(clock.deadline)
					continue
				}
				const showed: [boolean, boolean] = [clock.readiedAt[0] !== null, clock.readiedAt[1] !== null]
				const oneSide: Side | null = showed[0] && !showed[1] ? 0 : showed[1] && !showed[0] ? 1 : null
				const firstGame = m.def.games.length === 0
				if (oneSide !== null && block.play.kind === 'window' && firstGame) {
					bracket = unwrap(decideMatch(bracket, m.def.id, { kind: 'forfeit', winner: oneSide }, { dropped }))
					clock.phase = 'closed'
					clock.deadline = null
					events.push({ kind: 'match_forfeited', matchId: m.def.id, winner: oneSide })
				} else if (oneSide !== null) {
					// gamesSeen keeps the old count, so the next pass sees the new
					// game and either closes the match or opens the next ready-up.
					bracket = unwrap(recordGame(bracket, m.def.id, oneSide, dropped))
					clock.deadline = null
					events.push({ kind: 'game_forfeited', matchId: m.def.id, winner: oneSide })
				} else {
					clock.phase = 'unplayed'
					clock.deadline = null
					clock.unplayedSince = now
					events.push({ kind: 'unplayed', matchId: m.def.id, fallbackAt: now + block.unplayed.fallbackAfterHours * HOUR_MS })
				}
				changed = true
				break
			}

			if (clock.phase === 'unplayed' && clock.unplayedSince !== undefined) {
				const at = clock.unplayedSince + block.unplayed.fallbackAfterHours * HOUR_MS
				if (now < at) {
					wake.push(at)
					continue
				}
				if (block.unplayed.fallback === 'both_lose') {
					bracket = unwrap(decideMatch(bracket, m.def.id, { kind: 'double_forfeit' }, { dropped }))
				} else {
					const winner: Side = seedOf(bracket, pair[0]) <= seedOf(bracket, pair[1]) ? 0 : 1
					bracket = unwrap(decideMatch(bracket, m.def.id, { kind: 'forfeit', winner }, { dropped }))
				}
				clock.phase = 'closed'
				events.push({ kind: 'fallback_applied', matchId: m.def.id, fallback: block.unplayed.fallback })
				changed = true
				break
			}
		}
		if (changed) continue

		resolved = resolveBracket(bracket, dropped)
		if (stepCount > 0 && isFinished(bracket, dropped) && state.finishedAt === undefined) {
			state.finishedAt = now
			events.push({ kind: 'finished' })
			wake.length = 0
		}
		return out()
	}
	throw new Error('timetable: tick did not settle')
}

// --- Player and organiser actions. Each returns the new state; call tick()
// afterwards to act on it (e.g. both ready -> lobby_needed).

function openClock(state: TimetableState, matchId: string, phase?: MatchPhase): Result<{ state: TimetableState; clock: MatchClock }, EngineError> {
	const next = cloneState(state)
	const clock = next.matches[matchId]
	if (!clock) return err({ code: 'not_playable', message: `Match ${matchId} is not open` })
	if (phase && clock.phase !== phase) return err({ code: 'not_playable', message: `Match ${matchId} is ${clock.phase}` })
	return ok({ state: next, clock })
}

export function setReady(state: TimetableState, matchId: string, side: Side, ready: boolean, now: number): Result<TimetableState, EngineError> {
	if (state.pausedSince !== undefined) return err({ code: 'not_playable', message: 'The tournament is paused' })
	const r = openClock(state, matchId, 'ready_up')
	if (!r.ok) return r
	const { clock } = r.value
	clock.ready[side] = ready
	if (ready) {
		if (clock.readiedAt[side] === null) clock.readiedAt[side] = now
		clock.readyLog.push({ side, at: now })
	}
	return ok(r.value.state)
}

// Gives a match more time; an unplayed match goes back to ready-up.
export function extendMatch(state: TimetableState, matchId: string, minutes: number, now: number): Result<TimetableState, EngineError> {
	if (!(minutes > 0)) return err({ code: 'invalid', message: 'Extend by a positive number of minutes' })
	const r = openClock(state, matchId)
	if (!r.ok) return r
	const { clock } = r.value
	if (clock.phase === 'ready_up' && clock.deadline !== null) clock.deadline = Math.max(clock.deadline, now) + minutes * MINUTE_MS
	else if (clock.phase === 'unplayed') {
		clock.phase = 'ready_up'
		clock.deadline = now + minutes * MINUTE_MS
		clock.unplayedSince = undefined
		clock.ready = [false, false]
		clock.readiedAt = [null, null]
	} else return err({ code: 'not_playable', message: `Match ${matchId} is ${clock.phase}` })
	clock.remindersSent = []
	return ok(r.value.state)
}

export function startBlock(state: TimetableState, block: number, now: number): Result<TimetableState, EngineError> {
	if (!state.blocks[block]) return err({ code: 'invalid', message: `No block ${block + 1}` })
	if (state.blocks[block].startedAt !== undefined) return err({ code: 'invalid', message: 'That block has already started' })
	const next = cloneState(state)
	next.blocks[block].startRequestedAt = now
	return ok(next)
}

export function pause(state: TimetableState, now: number): Result<TimetableState, EngineError> {
	if (state.pausedSince !== undefined) return err({ code: 'invalid', message: 'Already paused' })
	return ok({ ...cloneState(state), pausedSince: now })
}

// Resumes: every running deadline and break moves later by the paused time.
// Fixed start times ('at') stay where they are.
export function resume(state: TimetableState, now: number): Result<TimetableState, EngineError> {
	if (state.pausedSince === undefined) return err({ code: 'invalid', message: 'Not paused' })
	const shift = now - state.pausedSince
	const next = cloneState(state)
	next.pausedSince = undefined
	for (const id of Object.keys(next.matches)) {
		const m = next.matches[id]
		if (m.deadline !== null) m.deadline += shift
		if (m.unplayedSince !== undefined) m.unplayedSince += shift
	}
	// A break counts from the previous block's finish, so moving that moves the break.
	for (const b of next.blocks) if (b.finishedAt !== undefined) b.finishedAt += shift
	return ok(next)
}

// The game handed to a lobby never produced a result (abandoned, or the
// lobby closed first): ready up again, with the series ready-up time.
export function reopenReadyUp(state: TimetableState, matchId: string, now: number, minutes: number): Result<TimetableState, EngineError> {
	const r = openClock(state, matchId, 'in_game')
	if (!r.ok) return r
	const { clock } = r.value
	clock.phase = 'ready_up'
	clock.deadline = now + minutes * MINUTE_MS
	clock.ready = [false, false]
	clock.readiedAt = [null, null]
	clock.inGameSince = undefined
	clock.remindersSent = []
	return ok(r.value.state)
}
