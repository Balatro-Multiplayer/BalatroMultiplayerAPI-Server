import { describe, expect, it } from 'vitest'
import { createBracket, finalPlacements, recordGame } from './bracket'
import { resolveBracket } from './resolve'
import {
	type ScheduleBlock,
	type TickOutput,
	type TimetableEvent,
	type TimetableState,
	extendMatch,
	newTimetable,
	pause,
	presetSchedule,
	resume,
	roundSteps,
	setReady,
	startBlock,
	tickTimetable,
	validateSchedule,
} from './schedule'
import { players, seededRng } from './test_helpers'
import type { Bracket, Format, Side } from './types'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const T0 = Date.UTC(2026, 10, 7, 18, 0)

function bracketOf(format: Format, n: number, options = {}, bestOf = 1): Bracket {
	const r = createBracket(format, players(n), options, bestOf)
	if (!r.ok) throw new Error(r.error.message)
	return r.value
}

// A tiny harness: holds bracket + timetable, advances a fake clock.
class Run {
	bracket: Bracket
	state: TimetableState
	now = T0
	events: TimetableEvent[] = []
	constructor(
		bracket: Bracket,
		public schedule: ScheduleBlock[],
	) {
		const valid = validateSchedule(bracket, schedule)
		if (!valid.ok) throw new Error(valid.error.message)
		this.bracket = bracket
		this.state = newTimetable(T0, schedule)
	}
	tick(): TickOutput {
		const out = tickTimetable({ bracket: this.bracket, schedule: this.schedule, state: this.state, now: this.now })
		this.bracket = out.bracket
		this.state = out.state
		this.events.push(...out.events)
		return out
	}
	at(time: number): TickOutput {
		this.now = time
		return this.tick()
	}
	ready(matchId: string, side: Side, ready = true) {
		const r = setReady(this.state, matchId, side, ready, this.now)
		if (!r.ok) throw new Error(r.error.message)
		this.state = r.value
	}
	game(matchId: string, winner: Side) {
		const r = recordGame(this.bracket, matchId, winner)
		if (!r.ok) throw new Error(r.error.message)
		this.bracket = r.value
	}
	kinds(): string[] {
		return this.events.map((e) => e.kind)
	}
	take(): TimetableEvent[] {
		const out = this.events
		this.events = []
		return out
	}
}

describe('roundSteps', () => {
	it('interleaves double elimination', () => {
		const steps = roundSteps(bracketOf('double_elim', 8)).map((s) => s.map((r) => `${r.stage}${r.round}`).join(' '))
		expect(steps).toEqual(['W1', 'W2 L1', 'L2', 'W3 L3', 'L4', 'GF1', 'GF2'])
	})

	it('lists every Swiss round, paired or not', () => {
		expect(roundSteps(bracketOf('swiss', 8)).length).toBe(3)
	})
})

describe('validateSchedule', () => {
	const b = bracketOf('single_elim', 8)
	const block = presetSchedule(b, 'live_event')[0]
	it('needs the blocks to cover every round, in order', () => {
		expect(validateSchedule(b, [{ ...block, untilStep: 2 }]).ok).toBe(false)
		expect(validateSchedule(b, [{ ...block, untilStep: 3 }]).ok).toBe(true)
		expect(validateSchedule(b, [{ ...block, untilStep: 2 }, { ...block, untilStep: 2 }]).ok).toBe(false)
	})
	it('checks the time limits', () => {
		expect(validateSchedule(b, [{ ...block, play: { kind: 'live', readyUpMinutes: 1 } }]).ok).toBe(false)
		expect(validateSchedule(b, [{ ...block, seriesReadyUpMinutes: 31 }]).ok).toBe(false)
		expect(validateSchedule(b, [{ ...block, unplayed: { fallbackAfterHours: 13, fallback: 'both_lose' } }]).ok).toBe(false)
		expect(validateSchedule(b, [{ ...block, play: { kind: 'window' } }]).ok).toBe(false)
	})
	it('keeps Swiss synchronized', () => {
		const s = bracketOf('swiss', 8)
		expect(validateSchedule(s, [{ ...presetSchedule(s, 'live_event')[0], opening: 'rolling' }]).ok).toBe(false)
	})
})

describe('live play', () => {
	it('opens round 1 at the start, makes a lobby when both are ready, and rolls on', () => {
		const run = new Run(bracketOf('single_elim', 4), presetSchedule(bracketOf('single_elim', 4), 'live_event'))
		const first = run.at(T0)
		expect(run.take().map((e) => e.kind)).toEqual(['block_started', 'match_opened', 'match_opened'])
		expect(first.nextWakeAt).toBe(T0 + 10 * MIN)

		run.now = T0 + MIN
		run.ready('W1-1', 0)
		run.ready('W1-1', 1)
		run.tick()
		expect(run.take()).toEqual([{ kind: 'lobby_needed', matchId: 'W1-1', players: ['p1', 'p4'], game: 1 }])

		run.game('W1-1', 0)
		run.at(T0 + 5 * MIN)
		// W2-1 can't open yet: p2/p3 haven't played.
		expect(run.take().map((e) => e.kind)).toEqual([])
		expect(run.state.matches['W1-1'].phase).toBe('closed')
	})

	it('forfeits the game to the player who readied when the time runs out', () => {
		const b = bracketOf('single_elim', 4)
		const run = new Run(b, presetSchedule(b, 'live_event'))
		run.at(T0)
		run.now = T0 + 2 * MIN
		run.ready('W1-2', 1)
		run.ready('W1-1', 0)
		run.ready('W1-1', 1)
		run.tick()
		run.game('W1-1', 0)
		run.take()
		run.at(T0 + 10 * MIN)
		const kinds = run.take().map((e) => e.kind)
		expect(kinds).toEqual(['game_forfeited', 'match_opened'])
		expect(resolveBracket(run.bracket).byId['W1-2'].outcome?.winner).toBe('p3')
		expect(resolveBracket(run.bracket).byId['W2-1'].players).toEqual(['p1', 'p3'])
	})

	it('runs a Bo3 series with a short ready-up between games', () => {
		const b = bracketOf('single_elim', 2, {}, 3)
		const run = new Run(b, presetSchedule(b, 'live_event'))
		run.at(T0)
		run.ready('W1-1', 0)
		run.ready('W1-1', 1)
		run.tick()
		run.game('W1-1', 1)
		run.take()
		run.at(T0 + 20 * MIN)
		expect(run.take()).toEqual([{ kind: 'series_ready_up', matchId: 'W1-1', deadline: T0 + 23 * MIN }])
		// Only p2 readies: p2 takes game 2 by forfeit and the series is over.
		run.ready('W1-1', 1)
		run.at(T0 + 23 * MIN)
		expect(run.take().map((e) => e.kind)).toEqual(['game_forfeited', 'block_finished', 'finished'])
		expect(finalPlacements(run.bracket)[0]).toEqual({ id: 'p2', place: 1 })
	})

	it('waits for the organiser when nobody readied, then applies the fallback', () => {
		const b = bracketOf('single_elim', 2)
		const schedule = presetSchedule(b, 'live_event').map((s) => ({ ...s, unplayed: { fallbackAfterHours: 2, fallback: 'both_lose' as const } }))
		const run = new Run(b, schedule)
		run.at(T0)
		run.take()
		const out = run.at(T0 + 10 * MIN)
		expect(run.take()).toEqual([{ kind: 'unplayed', matchId: 'W1-1', fallbackAt: T0 + 10 * MIN + 2 * HOUR }])
		expect(out.nextWakeAt).toBe(T0 + 10 * MIN + 2 * HOUR)
		run.at(T0 + 10 * MIN + 2 * HOUR)
		expect(run.take().map((e) => e.kind)).toEqual(['fallback_applied', 'block_finished', 'finished'])
		expect(resolveBracket(run.bracket).byId['W1-1'].outcome?.reason).toBe('double_forfeit')
	})

	it('lets the organiser extend an unplayed match', () => {
		const b = bracketOf('single_elim', 2)
		const run = new Run(b, presetSchedule(b, 'live_event'))
		run.at(T0)
		// Fallback after 0 h would apply at once, so give it a delay first.
		run.schedule = run.schedule.map((s) => ({ ...s, unplayed: { fallbackAfterHours: 1, fallback: 'higher_seed' as const } }))
		run.at(T0 + 10 * MIN)
		expect(run.state.matches['W1-1'].phase).toBe('unplayed')
		const r = extendMatch(run.state, 'W1-1', 15, run.now)
		if (!r.ok) throw new Error(r.error.message)
		run.state = r.value
		expect(run.state.matches['W1-1']).toMatchObject({ phase: 'ready_up', deadline: T0 + 25 * MIN })
	})
})

describe('breaks, fixed times and manual starts', () => {
	it('waits the break after a round before starting the next', () => {
		const b = bracketOf('single_elim', 4)
		const run = new Run(b, presetSchedule(b, 'live_event', { breakMinutes: 15 }))
		run.at(T0)
		run.game('W1-1', 0)
		run.game('W1-2', 0)
		run.at(T0 + 5 * MIN)
		const out = run.at(T0 + 6 * MIN)
		expect(run.kinds()).toContain('block_finished')
		expect(run.state.blocks[1].startedAt).toBeUndefined()
		expect(out.nextWakeAt).toBe(T0 + 5 * MIN + 15 * MIN)
		run.take()
		run.at(T0 + 20 * MIN)
		expect(run.take().map((e) => e.kind)).toEqual(['block_started', 'match_opened'])
	})

	it('starts fixed-time rounds at their time and manual rounds when the organiser says so', () => {
		const b = bracketOf('single_elim', 8)
		const run = new Run(b, presetSchedule(b, 'live_fixed_rounds', { roundStarts: [T0, T0 + 2 * HOUR] }))
		run.at(T0)
		for (const id of ['W1-1', 'W1-2', 'W1-3', 'W1-4']) run.game(id, 0)
		run.at(T0 + HOUR)
		expect(run.state.blocks[1].startedAt).toBeUndefined()
		run.at(T0 + 2 * HOUR)
		expect(run.state.blocks[1].startedAt).toBe(T0 + 2 * HOUR)
		run.game('W2-1', 0)
		run.game('W2-2', 0)
		run.at(T0 + 3 * HOUR)
		// Round 3 has no time: it waits for the organiser.
		expect(run.state.blocks[2].startedAt).toBeUndefined()
		const started = startBlock(run.state, 2, run.now)
		if (!started.ok) throw new Error(started.error.message)
		run.state = started.value
		run.tick()
		expect(run.state.matches['W3-1']).toBeDefined()
	})
})

describe('pause', () => {
	it('freezes deadlines and moves them later on resume', () => {
		const b = bracketOf('single_elim', 2)
		const run = new Run(b, presetSchedule(b, 'live_event'))
		run.at(T0)
		const paused = pause(run.state, T0 + 5 * MIN)
		if (!paused.ok) throw new Error(paused.error.message)
		run.state = paused.value
		run.take()
		run.at(T0 + 30 * MIN)
		expect(run.take()).toEqual([])
		expect(setReady(run.state, 'W1-1', 0, true, run.now).ok).toBe(false)
		const resumed = resume(run.state, T0 + 30 * MIN)
		if (!resumed.ok) throw new Error(resumed.error.message)
		run.state = resumed.value
		// 5 minutes were left at the pause.
		expect(run.state.matches['W1-1'].deadline).toBe(T0 + 35 * MIN)
	})
})

describe('windows (play by a deadline)', () => {
	it('forfeits the match to whoever readied at least once, and reminds before the deadline', () => {
		const b = bracketOf('swiss', 4)
		const run = new Run(b, presetSchedule(b, 'league', { windowMinutes: 48 * 60 }))
		run.at(T0)
		const deadline = T0 + 48 * HOUR
		expect(run.state.matches['SW1-1'].deadline).toBe(deadline)
		run.take()
		// p1 shows up for a while, then leaves.
		run.now = T0 + HOUR
		run.ready('SW1-1', 0)
		run.ready('SW1-1', 0, false)
		run.game('SW1-2', 0)
		run.at(deadline - 24 * HOUR)
		expect(run.take()).toEqual([{ kind: 'reminder', matchId: 'SW1-1', minutesLeft: 24 * 60 }])
		run.at(deadline)
		const kinds = run.take().map((e) => e.kind)
		expect(kinds.slice(0, 3)).toEqual(['match_forfeited', 'swiss_round_paired', 'block_finished'])
		expect(resolveBracket(run.bracket).byId['SW1-1'].outcome).toMatchObject({ winner: 'p1', reason: 'forfeit' })
		// Round 2 is its own block and starts right away.
		expect(kinds).toContain('block_started')
	})
})

describe('whole tournaments', () => {
	const cases: [Format, number, object][] = [
		['single_elim', 13, {}],
		['double_elim', 16, {}],
		['double_elim', 7, { grandFinalReset: false }],
		['round_robin', 9, { groupSize: 3 }],
		['swiss', 11, {}],
	]
	for (const [format, n, options] of cases) {
		it(`${format} with ${n} players plays to the end on the live preset (some no-shows)`, () => {
			const rng = seededRng(n * 7)
			const b = bracketOf(format, n, options, 3)
			const run = new Run(b, presetSchedule(b, 'live_event', { breakMinutes: format === 'round_robin' ? 5 : 0 }))
			let out = run.at(T0)
			for (let step = 0; step < 5000 && run.state.finishedAt === undefined; step++) {
				// Everyone with an open ready-up readies (10% no-show per side).
				for (const id of Object.keys(run.state.matches)) {
					const m = run.state.matches[id]
					if (m.phase !== 'ready_up') continue
					for (const side of [0, 1] as Side[]) if (!m.ready[side] && rng() > 0.1) run.ready(id, side)
				}
				out = run.tick()
				// Play every game that got a lobby.
				for (const e of out.events) if (e.kind === 'lobby_needed') run.game(e.matchId, rng() < 0.5 ? 0 : 1)
				if (out.events.length === 0) {
					if (out.nextWakeAt === null) throw new Error('stuck: nothing to wait for')
					run.now = out.nextWakeAt
					out = run.tick()
				}
			}
			expect(run.state.finishedAt).toBeDefined()
			expect(finalPlacements(run.bracket).length).toBe(n)
		})
	}
})
