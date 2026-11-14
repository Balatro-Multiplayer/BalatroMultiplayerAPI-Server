import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { type ClockInputs, clockCharge, clockLive, clocksStep } from './clocks'
import type { PersonalClock, PersonalClockRules, SkipsSeen } from './state'

const PRESSURE: PersonalClockRules = {
	kind: 'pressure',
	baseMs: 300_000,
	timedRate: 2,
	previewCostMs: 3500,
}
const SPEEDLATRO: PersonalClockRules = {
	kind: 'speedlatro',
	baseMs: 147_000,
	pvpMs: 73_500,
	graceMs: 4000,
	timedRate: 2,
	previewCostMs: 0,
}

const NOW = 100_000
const INCREMENT = 10_000

// A clock that last changed one second ago.
function entryOf(over: Partial<PersonalClock> = {}): PersonalClock {
	return {
		ms: 200_000,
		running: true,
		rate: 1,
		n: 5,
		spent: false,
		since: NOW - 1000,
		graceUntil: null,
		...over,
	}
}

function inputOf(over: Partial<ClockInputs> = {}): ClockInputs {
	return {
		inRun: true,
		ready: false,
		readied: false,
		away: false,
		animating: false,
		pvpOpen: false,
		timing: false,
		timed: false,
		blindStarted: false,
		handsDone: false,
		score: null,
		rival: null,
		rivalId: null,
		rivalSkips: null,
		teamMode: false,
		roundClosed: false,
		previews: 0,
		...over,
	}
}

function tick(
	rules: PersonalClockRules,
	before: PersonalClock,
	input: ClockInputs,
	opts: { now?: number; seen?: SkipsSeen; increment?: number } = {},
) {
	const result = clocksStep(
		rules,
		opts.now ?? NOW,
		{ p: before },
		opts.seen === undefined ? {} : { p: opts.seen },
		{ p: input },
		opts.increment ?? INCREMENT,
	)
	return { ...result, entry: result.clocks.p, seen: result.skipsSeen.p }
}

interface Row {
	name: string
	rules: PersonalClockRules
	before: Partial<PersonalClock>
	input: Partial<ClockInputs>
	expected: Partial<PersonalClock>
	seen?: SkipsSeen
}

describe('clocksStep scenarios (SPEC-B 2c)', () => {
	// ms and since stay as stored until n bumps.
	const rows: Row[] = [
		{
			name: 'Pressure, regular blind: runs x1, nothing rewritten',
			rules: PRESSURE,
			before: {},
			input: {},
			expected: {
				ms: 200_000,
				since: NOW - 1000,
				running: true,
				rate: 1,
				n: 5,
			},
		},
		{
			name: 'Pressure, timed: runs x2, nothing rewritten',
			rules: PRESSURE,
			before: { rate: 2 },
			input: { timed: true },
			expected: { ms: 200_000, running: true, rate: 2, n: 5 },
		},
		{
			name: 'Pressure, becomes timed: rate 2, settled, n bumps',
			rules: PRESSURE,
			before: {},
			input: { timed: true },
			expected: { ms: 199_000, since: NOW, running: true, rate: 2, n: 6 },
		},
		{
			name: 'Pressure, Ready: held',
			rules: PRESSURE,
			before: {},
			input: { ready: true },
			expected: { ms: 199_000, since: NOW, running: false, n: 6 },
		},
		{
			name: 'Pressure, Unready after a Ready: still held (readied)',
			rules: PRESSURE,
			before: { running: false },
			input: { readied: true },
			expected: { ms: 200_000, running: false, n: 5 },
		},
		{
			name: 'Pressure, readied but timed: runs x2',
			rules: PRESSURE,
			before: { running: false },
			input: { readied: true, timed: true },
			expected: { ms: 200_000, running: true, rate: 2, n: 6 },
		},
		{
			name: 'Pressure, shop after Big blind, no Ready yet: runs',
			rules: PRESSURE,
			before: {},
			input: { readied: false },
			expected: { ms: 200_000, running: true, n: 5 },
		},
		{
			name: 'Pressure, PvP round open: held',
			rules: PRESSURE,
			before: {},
			input: { pvpOpen: true },
			expected: { ms: 199_000, running: false, n: 6 },
		},
		{
			name: 'Pressure, away: held',
			rules: PRESSURE,
			before: {},
			input: { away: true },
			expected: { ms: 199_000, running: false, n: 6 },
		},
		{
			name: 'Pressure, owner animating: held',
			rules: PRESSURE,
			before: {},
			input: { animating: true },
			expected: { ms: 199_000, running: false, n: 6 },
		},
		{
			name: 'Pressure, animating again after a stop, no longer: runs',
			rules: PRESSURE,
			before: { running: false },
			input: { animating: false },
			expected: { running: true, n: 6 },
		},
		{
			name: 'Speedlatro, outside PvP, owner animating: still runs',
			rules: SPEEDLATRO,
			before: {},
			input: { animating: true },
			expected: { ms: 200_000, since: NOW - 1000, running: true, n: 5 },
		},
		{
			name: 'Speedlatro, grace over in PvP, owner animating: still runs',
			rules: SPEEDLATRO,
			before: { running: false, ms: 73_500, graceUntil: NOW },
			input: { pvpOpen: true, blindStarted: true, animating: true },
			expected: { ms: 73_500, running: true, n: 6 },
		},
		{
			name: 'Pressure, not in the run: held',
			rules: PRESSURE,
			before: {},
			input: { inRun: false },
			expected: { running: false, n: 6 },
		},
		{
			name: 'Pressure, round close: ms is the base',
			rules: PRESSURE,
			before: {},
			input: { roundClosed: true },
			expected: { ms: 300_000, since: NOW, running: true, n: 6 },
		},
		{
			name: 'Pressure, reset and expiry in one tick: the reset wins',
			rules: PRESSURE,
			before: { ms: 500 },
			input: { roundClosed: true },
			expected: { ms: 300_000, n: 6 },
		},
		{
			name: 'Pressure, Score Preview charge above max(10 s, cost)',
			rules: PRESSURE,
			before: {},
			input: { previews: 1 },
			expected: { ms: 199_000 - 3500, since: NOW, n: 6 },
		},
		{
			name: 'Pressure, Score Preview at or below 10 s live: free',
			rules: PRESSURE,
			before: { ms: 10_500 },
			input: { previews: 1 },
			expected: { ms: 10_500, since: NOW - 1000, n: 5 },
		},
		{
			name: 'Pressure, precedence: ms 9000 + one skip + one preview = 15500',
			rules: PRESSURE,
			before: { ms: 9000, running: false },
			input: {
				ready: true,
				previews: 1,
				rivalId: 'r',
				rivalSkips: 1,
			},
			seen: { rival: 'r', skips: 0 },
			// credit first (9000 + 10000 = 19000, above the floor), then the charge
			// (3500): 15500. Charge first would be free (9000 <= 10000) and give 19000.
			expected: { ms: 15_500, since: NOW, n: 6 },
		},
		{
			name: 'Speedlatro, outside PvP: runs x1',
			rules: SPEEDLATRO,
			before: {},
			input: {},
			expected: { ms: 200_000, running: true, rate: 1, n: 5 },
		},
		{
			name: 'Speedlatro, timed outside PvP: x2',
			rules: SPEEDLATRO,
			before: {},
			input: { timed: true },
			expected: { ms: 199_000, rate: 2, running: true, n: 6 },
		},
		{
			name: 'Speedlatro, timed inside PvP before the blind start: x1, held',
			rules: SPEEDLATRO,
			before: {},
			input: { timed: true, pvpOpen: true },
			expected: { rate: 1, running: false },
		},
		{
			name: 'Speedlatro, round open before own blind_start: held, ms unchanged',
			rules: SPEEDLATRO,
			before: { running: false, ms: 100_000 },
			input: { pvpOpen: true },
			expected: { ms: 100_000, running: false, graceUntil: null, n: 5 },
		},
		{
			name: 'Speedlatro, at own blind_start: ms 73500, held for 4000',
			rules: SPEEDLATRO,
			before: { running: false, ms: 100_000 },
			input: { pvpOpen: true, blindStarted: true },
			expected: {
				ms: 73_500,
				since: NOW,
				running: false,
				graceUntil: NOW + 4000,
				n: 6,
			},
		},
		{
			name: 'Speedlatro, spent at blind_start: no anchor',
			rules: SPEEDLATRO,
			before: { running: false, ms: 0, spent: true },
			input: { pvpOpen: true, blindStarted: true },
			expected: { ms: 0, graceUntil: null, running: false, n: 5 },
		},
		{
			name: 'Speedlatro, inside the grace: held',
			rules: SPEEDLATRO,
			before: { running: false, ms: 73_500, graceUntil: NOW + 1 },
			input: { pvpOpen: true, blindStarted: true },
			expected: { ms: 73_500, running: false, n: 5 },
		},
		{
			name: 'Speedlatro, grace over, no opponent: runs',
			rules: SPEEDLATRO,
			before: { running: false, ms: 73_500, graceUntil: NOW },
			input: { pvpOpen: true, blindStarted: true },
			expected: { ms: 73_500, running: true, n: 6 },
		},
		{
			name: 'Speedlatro, tie: held',
			rules: SPEEDLATRO,
			before: { ms: 73_500, graceUntil: NOW - 2000 },
			input: {
				pvpOpen: true,
				blindStarted: true,
				score: '100',
				rival: { score: '100' },
			},
			expected: { ms: 72_500, running: false, n: 6 },
		},
		{
			name: 'Speedlatro, player leads: held',
			rules: SPEEDLATRO,
			before: { ms: 73_500, graceUntil: NOW - 2000 },
			input: {
				pvpOpen: true,
				blindStarted: true,
				score: '200',
				rival: { score: '100' },
			},
			expected: { running: false },
		},
		{
			name: 'Speedlatro, opponent strictly greater: runs',
			rules: SPEEDLATRO,
			before: { ms: 73_500, graceUntil: NOW - 2000 },
			input: {
				pvpOpen: true,
				blindStarted: true,
				score: '100',
				rival: { score: '200' },
			},
			expected: { ms: 73_500, running: true, n: 5 },
		},
		{
			name: 'Speedlatro, opponent masked or unreported: runs',
			rules: SPEEDLATRO,
			before: { ms: 73_500, graceUntil: NOW - 2000 },
			input: {
				pvpOpen: true,
				blindStarted: true,
				score: '100',
				rival: { score: null },
			},
			expected: { running: true },
		},
		{
			name: 'Speedlatro, own score unknown and opponent known: runs',
			rules: SPEEDLATRO,
			before: { ms: 73_500, graceUntil: NOW - 2000 },
			input: {
				pvpOpen: true,
				blindStarted: true,
				score: null,
				rival: { score: '5' },
			},
			expected: { running: true },
		},
		{
			name: 'Speedlatro, handsDone and behind: held',
			rules: SPEEDLATRO,
			before: { ms: 73_500, graceUntil: NOW - 2000 },
			input: {
				pvpOpen: true,
				blindStarted: true,
				handsDone: true,
				score: '100',
				rival: { score: '200' },
			},
			expected: { running: false },
		},
		{
			name: 'Speedlatro, round close: 147000 and unspent',
			rules: SPEEDLATRO,
			before: { ms: 0, running: false, spent: true, graceUntil: 5 },
			input: { roundClosed: true },
			expected: {
				ms: 147_000,
				spent: false,
				graceUntil: null,
				running: true,
				n: 6,
			},
		},
		{
			name: 'Speedlatro, reset and expiry in one tick: the reset wins',
			rules: SPEEDLATRO,
			before: { ms: 500 },
			input: { roundClosed: true },
			expected: { ms: 147_000, spent: false, n: 6 },
		},
		{
			name: 'Speedlatro, spent: held outside PvP until the reset',
			rules: SPEEDLATRO,
			before: { ms: 0, running: false, spent: true },
			input: {},
			expected: { ms: 0, running: false, spent: true, n: 5 },
		},
		{
			name: 'Speedlatro, Score Preview costs nothing',
			rules: SPEEDLATRO,
			before: {},
			input: { previews: 3 },
			expected: { ms: 200_000, since: NOW - 1000, n: 5 },
		},
	]

	test.each(rows)('$name', ({ rules, before, input, expected, seen }) => {
		const { entry, runOuts } = tick(rules, entryOf(before), inputOf(input), {
			seen,
		})
		expect(entry).toMatchObject(expected)
		expect(runOuts).toEqual([])
	})
})

describe('opponent skips (Pressure credit)', () => {
	const seenAt = (rival: string, skips: number): SkipsSeen => ({ rival, skips })

	test('two new skips from the same rival, untimed: +2 x increment', () => {
		const { entry, seen } = tick(
			PRESSURE,
			entryOf(),
			inputOf({ rivalId: 'r', rivalSkips: 2 }),
			{ seen: seenAt('r', 0) },
		)
		expect(entry).toMatchObject({ ms: 199_000 + 2 * INCREMENT, n: 6 })
		expect(seen).toEqual(seenAt('r', 2))
	})

	test('only the skips beyond the baseline are credited', () => {
		const { entry, seen } = tick(
			PRESSURE,
			entryOf(),
			inputOf({ rivalId: 'r', rivalSkips: 3 }),
			{ seen: seenAt('r', 2) },
		)
		expect(entry.ms).toBe(199_000 + INCREMENT)
		expect(seen).toEqual(seenAt('r', 3))
	})

	test.each<[string, Partial<ClockInputs>, 1 | 2]>([
		['timed', { timed: true }, 2],
		['timing', { timing: true }, 1],
	])('a skip while %s: no credit, and it is consumed', (_name, over, rate) => {
		const { entry, seen } = tick(
			PRESSURE,
			entryOf({ rate }),
			inputOf({ ...over, rivalId: 'r', rivalSkips: 2 }),
			{ seen: seenAt('r', 0) },
		)
		expect(entry).toMatchObject({ ms: 200_000, n: 5 })
		expect(seen).toEqual(seenAt('r', 2))
	})

	test('unknown opponent total: no credit, memo untouched', () => {
		const { entry, seen } = tick(
			PRESSURE,
			entryOf(),
			inputOf({ rivalId: 'r', rivalSkips: null }),
			{ seen: seenAt('r', 4) },
		)
		expect(entry.ms).toBe(200_000)
		expect(seen).toEqual(seenAt('r', 4))
	})

	test('no memo yet: a baseline at the rival total, no credit', () => {
		const { entry, seen } = tick(
			PRESSURE,
			entryOf(),
			inputOf({ rivalId: 'r', rivalSkips: 7 }),
		)
		expect(entry.ms).toBe(200_000)
		expect(seen).toEqual(seenAt('r', 7))
	})

	test.each([
		['a re-pair to a rival with a higher total', 5],
		['a re-pair to a rival with a lower total', 1],
	])('Nemesis: %s writes a baseline, no credit', (_name, total) => {
		const { entry, seen } = tick(
			PRESSURE,
			entryOf(),
			inputOf({ rivalId: 'r2', rivalSkips: total }),
			{ seen: seenAt('r1', 3) },
		)
		expect(entry.ms).toBe(200_000)
		expect(seen).toEqual(seenAt('r2', total))
		const next = tick(
			PRESSURE,
			entry,
			inputOf({ rivalId: 'r2', rivalSkips: total + 1 }),
			{ seen },
		)
		expect(clockLive(next.entry, NOW)).toBe(199_000 + INCREMENT)
	})

	test.each([
		['the same rival again', 'r1', 8],
		['a new rival', 'r3', 9],
	])('a bye, then %s: baseline, no credit', (_name, rival, total) => {
		const bye = tick(
			PRESSURE,
			entryOf(),
			inputOf({ rivalId: null, rivalSkips: null }),
			{ seen: seenAt('r1', 3) },
		)
		expect(bye.seen).toEqual({ rival: null })
		const paired = tick(
			PRESSURE,
			bye.entry,
			inputOf({ rivalId: rival, rivalSkips: total }),
			{ seen: bye.seen },
		)
		expect(paired.entry.ms).toBe(200_000)
		expect(paired.seen).toEqual(seenAt(rival, total))
	})

	test('an increment of 0 with a fresh skip: nothing changes, n stays', () => {
		const { entry, seen } = tick(
			PRESSURE,
			entryOf(),
			inputOf({ rivalId: 'r', rivalSkips: 2 }),
			{ seen: seenAt('r', 0), increment: 0 },
		)
		expect(entry).toEqual(entryOf())
		expect(seen).toEqual(seenAt('r', 2))
	})

	test('the old rival coming back is a baseline too', () => {
		const away = tick(
			PRESSURE,
			entryOf(),
			inputOf({ rivalId: 'r2', rivalSkips: 0 }),
			{ seen: seenAt('r1', 2) },
		)
		const back = tick(
			PRESSURE,
			away.entry,
			inputOf({ rivalId: 'r1', rivalSkips: 6 }),
			{ seen: away.seen },
		)
		expect(back.entry.ms).toBe(200_000)
		expect(back.seen).toEqual(seenAt('r1', 6))
	})

	test('a team game gives no credit and writes no memo', () => {
		const { entry, seen } = tick(
			PRESSURE,
			entryOf(),
			inputOf({ rivalId: 'r', rivalSkips: 5, teamMode: true }),
			{ seen: seenAt('r', 0) },
		)
		expect(entry.ms).toBe(200_000)
		expect(seen).toEqual(seenAt('r', 0))
	})

	test('Speedlatro has no skip credit', () => {
		const { entry } = tick(
			SPEEDLATRO,
			entryOf(),
			inputOf({ rivalId: 'r', rivalSkips: 5 }),
			{ seen: seenAt('r', 0) },
		)
		expect(entry.ms).toBe(200_000)
	})
})

describe('run-outs', () => {
	test('Pressure, untimed (D7): a run-out, then the base', () => {
		const { entry, runOuts } = tick(
			PRESSURE,
			entryOf({ ms: 500, n: 7 }),
			inputOf(),
		)
		expect(runOuts).toEqual([{ playerId: 'p', kind: 'pressure', n: 7 }])
		expect(entry).toMatchObject({
			ms: 300_000,
			since: NOW,
			running: true,
			n: 8,
		})
	})

	test('Pressure run-out while timed: also refills', () => {
		const { entry, runOuts } = tick(
			PRESSURE,
			entryOf({ ms: 1500, rate: 2, n: 3 }),
			inputOf({ timed: true }),
		)
		expect(runOuts).toEqual([{ playerId: 'p', kind: 'pressure', n: 3 }])
		expect(entry.ms).toBe(300_000)
	})

	test('a held clock at 0 runs out in the tick it starts, not the next one', () => {
		const { entry, runOuts } = tick(
			PRESSURE,
			entryOf({ ms: 0, running: false, n: 4 }),
			inputOf(),
		)
		expect(runOuts).toEqual([{ playerId: 'p', kind: 'pressure', n: 4 }])
		expect(entry).toMatchObject({
			ms: 300_000,
			since: NOW,
			running: true,
			n: 5,
		})
	})

	test('Speedlatro: spent, and no second run-out until the round closes', () => {
		const first = tick(SPEEDLATRO, entryOf({ ms: 500, n: 7 }), inputOf())
		expect(first.runOuts).toEqual([{ playerId: 'p', kind: 'speedlatro', n: 7 }])
		expect(first.entry).toMatchObject({
			ms: 0,
			running: false,
			spent: true,
			n: 8,
		})
		const later = tick(SPEEDLATRO, first.entry, inputOf(), {
			now: NOW + 60_000,
		})
		expect(later.runOuts).toEqual([])
		expect(later.entry).toEqual(first.entry)
		const closed = tick(
			SPEEDLATRO,
			later.entry,
			inputOf({ roundClosed: true }),
			{ now: NOW + 61_000 },
		)
		expect(closed.entry).toMatchObject({ ms: 147_000, spent: false })
		expect(closed.runOuts).toEqual([])
	})

	test('an input with no entry is skipped and listed', () => {
		const result = clocksStep(
			PRESSURE,
			NOW,
			{},
			{},
			{ ghost: inputOf() },
			INCREMENT,
		)
		expect(result).toEqual({
			clocks: {},
			skipsSeen: {},
			runOuts: [],
			missing: ['ghost'],
		})
	})
})

describe('clockCharge', () => {
	test.each([
		['above the floor', 50_000, 3500, 46_500],
		['at the 10 s floor', 10_000, 3500, 10_000],
		['below the floor', 9000, 3500, 9000],
		['cost above 10 s: the floor is the cost', 12_000, 12_000, 12_000],
		['cost 0', 50_000, 0, 50_000],
	])('%s', (_name, ms, cost, expected) => {
		expect(clockCharge(entryOf({ ms }), cost).ms).toBe(expected)
	})
})

// --- properties ---

const scoreArb = fc.constantFrom<string | null>(null, '0', '5', '100', '200')
const inputArb: fc.Arbitrary<ClockInputs> = fc.record({
	inRun: fc.boolean(),
	ready: fc.boolean(),
	readied: fc.boolean(),
	away: fc.boolean(),
	animating: fc.boolean(),
	pvpOpen: fc.boolean(),
	timing: fc.boolean(),
	timed: fc.boolean(),
	blindStarted: fc.boolean(),
	handsDone: fc.boolean(),
	score: scoreArb,
	rival: fc.option(fc.record({ score: scoreArb }), { nil: null }),
	rivalId: fc.option(fc.constantFrom('r1', 'r2'), { nil: null }),
	rivalSkips: fc.option(fc.nat({ max: 6 }), { nil: null }),
	teamMode: fc.boolean(),
	roundClosed: fc.boolean(),
	previews: fc.nat({ max: 3 }),
})
const entryArb: fc.Arbitrary<PersonalClock> = fc.record({
	ms: fc.nat({ max: 400_000 }),
	running: fc.boolean(),
	rate: fc.constantFrom<1 | 2>(1, 2),
	n: fc.nat({ max: 50 }),
	spent: fc.boolean(),
	since: fc.nat({ max: 1_000_000 }),
	graceUntil: fc.option(fc.nat({ max: 1_100_000 }), { nil: null }),
})
const seenArb = fc.option(
	fc.record({
		rival: fc.constantFrom('r1', 'r2'),
		skips: fc.nat({ max: 6 }),
	}),
	{ nil: undefined },
)
const rulesArb = fc.constantFrom(PRESSURE, SPEEDLATRO)
const gapArb = fc.nat({ max: 600_000 })

// An input with no events: no round close, no charge, no skip total.
function quiet(input: ClockInputs): ClockInputs {
	return { ...input, roundClosed: false, previews: 0, rivalSkips: null }
}

describe('clocks laws', () => {
	test('ms is never below 0, rate is 1 or 2, n never goes down', () => {
		fc.assert(
			fc.property(
				rulesArb,
				entryArb,
				inputArb,
				gapArb,
				seenArb,
				(rules, before, input, gap, seen) => {
					const now = before.since + gap
					const { entry } = tick(rules, before, input, { now, seen })
					expect(entry.ms).toBeGreaterThanOrEqual(0)
					expect(clockLive(entry, now)).toBeGreaterThanOrEqual(0)
					expect([1, 2]).toContain(entry.rate)
					expect(entry.n).toBeGreaterThanOrEqual(before.n)
				},
			),
		)
	})

	test('n bumps at most once, and ms/since move only with it', () => {
		fc.assert(
			fc.property(
				rulesArb,
				entryArb,
				inputArb,
				gapArb,
				seenArb,
				(rules, before, input, gap, seen) => {
					const now = before.since + gap
					const { entry } = tick(rules, before, input, { now, seen })
					expect(entry.n - before.n).toBeLessThanOrEqual(1)
					if (entry.running !== before.running || entry.rate !== before.rate) {
						expect(entry.n).toBe(before.n + 1)
					}
					if (entry.n === before.n) expect(entry).toEqual(before)
				},
			),
		)
	})

	test('a held clock does not move', () => {
		fc.assert(
			fc.property(
				rulesArb,
				entryArb,
				inputArb,
				gapArb,
				(rules, before, input, gap) => {
					const held = { ...before, running: false }
					const now = before.since + gap
					// A Speedlatro anchor sets ms; that is an event, not a move.
					const calm = { ...quiet(input), blindStarted: false }
					const { entry, runOuts } = tick(rules, held, calm, { now })
					// So is a run-out: a held clock at 0 that starts in this tick.
					if (runOuts.length === 0) expect(entry.ms).toBe(held.ms)
					else expect(held.ms).toBe(0)
				},
			),
			{
				examples: [
					[
						PRESSURE,
						{ ms: 0, running: false, rate: 1, n: 1, spent: false, since: 0, graceUntil: null },
						inputOf(),
						0,
					],
				],
			},
		)
	})

	test('conservation: one tick at t2 equals ticks at t1 and t2 (quiet input)', () => {
		fc.assert(
			fc.property(
				entryArb,
				inputArb,
				fc.nat({ max: 100_000 }),
				fc.nat({ max: 100_000 }),
				fc.integer({ min: 500_000, max: 900_000 }),
				(raw, input, a, b, ms) => {
					const calm = quiet(input)
					// Settle the clock under the input first, so no flip falls on t1.
					const start = tick(PRESSURE, { ...raw, ms, graceUntil: null }, calm, {
						now: raw.since,
					}).entry
					const t1 = start.since + a
					const t2 = t1 + b
					const viaT1 = tick(
						PRESSURE,
						tick(PRESSURE, start, calm, { now: t1 }).entry,
						calm,
						{ now: t2 },
					).entry
					const direct = tick(PRESSURE, start, calm, { now: t2 }).entry
					expect(clockLive(viaT1, t2)).toBe(clockLive(direct, t2))
				},
			),
		)
	})

	test('a re-tick at the same now changes nothing', () => {
		fc.assert(
			fc.property(
				rulesArb,
				entryArb,
				inputArb,
				gapArb,
				seenArb,
				(rules, before, input, gap, seen) => {
					const now = before.since + gap
					const first = tick(rules, before, input, { now, seen })
					const again = tick(rules, first.entry, quiet(input), {
						now,
						seen: first.seen,
					})
					expect(again.entry).toEqual(first.entry)
					expect(again.runOuts).toEqual([])
				},
			),
		)
	})

	test('players are independent: together equals each alone', () => {
		fc.assert(
			fc.property(
				rulesArb,
				entryArb,
				entryArb,
				inputArb,
				inputArb,
				gapArb,
				(rules, ea, eb, ia, ib, gap) => {
					const now = Math.max(ea.since, eb.since) + gap
					const together = clocksStep(
						rules,
						now,
						{ a: ea, b: eb },
						{},
						{ b: ib, a: ia },
						INCREMENT,
					)
					const alone = (id: 'a' | 'b') =>
						clocksStep(
							rules,
							now,
							{ [id]: id === 'a' ? ea : eb },
							{},
							{ [id]: id === 'a' ? ia : ib },
							INCREMENT,
						)
					expect(together.clocks.a).toEqual(alone('a').clocks.a)
					expect(together.clocks.b).toEqual(alone('b').clocks.b)
					expect(together.runOuts).toEqual([
						...alone('a').runOuts,
						...alone('b').runOuts,
					])
				},
			),
		)
	})

	test('every Speedlatro round close gives 147000 and spent = false', () => {
		fc.assert(
			fc.property(entryArb, inputArb, gapArb, (before, input, gap) => {
				const now = before.since + gap
				const { entry } = tick(
					SPEEDLATRO,
					before,
					{ ...input, roundClosed: true, previews: 0, pvpOpen: false },
					{ now },
				)
				expect(entry.ms).toBe(147_000)
				expect(entry.spent).toBe(false)
			}),
		)
	})

	test('every Pressure round close gives the base', () => {
		fc.assert(
			fc.property(entryArb, inputArb, gapArb, (before, input, gap) => {
				const now = before.since + gap
				const { entry } = tick(
					PRESSURE,
					before,
					{ ...input, roundClosed: true, previews: 0, rivalSkips: null },
					{ now },
				)
				expect(entry.ms).toBe(300_000)
			}),
		)
	})
})

describe('a quiet tick builds nothing new', () => {
	test.each([
		['pressure', PRESSURE],
		['speedlatro', SPEEDLATRO],
	] as const)(
		'%s: a re-tick that changes nothing returns the same objects',
		(_name, rules) => {
			const first = clocksStep(
				rules,
				NOW,
				{ p: entryOf() },
				{},
				{ p: inputOf({ rivalId: 'q', rivalSkips: 2, pvpOpen: true }) },
				INCREMENT,
			)
			const again = clocksStep(
				rules,
				NOW,
				first.clocks,
				first.skipsSeen,
				{ p: inputOf({ rivalId: 'q', rivalSkips: 2, pvpOpen: true }) },
				INCREMENT,
			)
			expect(again.clocks).toBe(first.clocks)
			expect(again.skipsSeen).toBe(first.skipsSeen)
			expect(again.runOuts).toEqual([])
		},
	)

	test('a changed rival skip total still writes the new baseline', () => {
		const seen: SkipsSeen = { rival: 'q', skips: 1 }
		const stepped = clocksStep(
			PRESSURE,
			NOW,
			{ p: entryOf() },
			{ p: seen },
			{ p: inputOf({ rivalId: 'q', rivalSkips: 2 }) },
			INCREMENT,
		)
		expect(stepped.skipsSeen.p).toEqual({ rival: 'q', skips: 2 })
	})
})
