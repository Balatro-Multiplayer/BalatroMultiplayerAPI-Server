// The skip time and the Ante bank (skips.ts, skip_facts.ts) and how the tick charges
// a server-counted deadline to its starter's bank (deadline.ts). The pure rules are
// tested on plain data; the tick rows drive `decide` with the real duel rules.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { reportAll, startOf } from '../../testing/pvp_fixtures'
import { testContext } from '../../testing/request_context'
import { fromRuntime } from '../../testing/runtime_state'
import {
	plainDeadline,
	worldOf,
} from './deadline'
import { FACT_REDUCERS, reduceProgress } from './facts'
import { pickMode } from './modes'
import type { FactResult } from './reducer'
import { settingsAtStart } from '../../testing/pvp_settings'
import { MAX_TIMER_MS, MIN_TIMER_MS } from './settings'
import { withRules } from '../../testing/pvp_rules'
import { reduceSkip, reduceTimerSpend } from './skip_facts'
import {
	type OpponentOf,
	anteBankMs,
	leadOf,
	skipsReported,
	skipsReset,
	skipsSincePvp,
	spentOut,
	spentRestarted,
} from './skips'
import {
	type PvpSettings,
	type RefereeState,
	type SkipEntry,
	emptyFacts,
	emptyPvp,
} from './state'
import { withFacingRepinned } from './round_cycle'
import { type TickEnv, decide } from './tick'
import { reduceTimerPause, reduceTimerStart } from './timer_facts'

const BASE = 150_000
const INC = 60_000

function settings(over: Partial<PvpSettings> = {}): PvpSettings {
	return {
		...settingsAtStart(
			withRules({
				ruleset: 'ruleset_mp_balanced',
				timer_base_seconds: BASE / 1000,
				timer_increment_seconds: INC / 1000,
			}),
			['a', 'b'],
		),
		...over,
	}
}

const entry = (
	skips: number | null,
	skipsAtPvp: number | null = 0,
	spentMs = 0,
	facing: string | null = null,
): SkipEntry => ({ skips, skipsAtPvp, facing, spentMs })

const facing: OpponentOf = (id) => (id === 'a' ? 'b' : id === 'b' ? 'a' : null)
const nobody: OpponentOf = () => null

describe('settings: increment and rule from the lobby metadata', () => {
	it.each<[string, { [k: string]: unknown }, number | null, 'lead' | 'own']>([
		['no key: null, never an invented one', {}, null, 'lead'],
		['60 seconds', { timer_increment_seconds: 60 }, 60_000, 'lead'],
		['a numeric string', { timer_increment_seconds: '45' }, 45_000, 'lead'],
		['a negative one pays nothing', { timer_increment_seconds: -5 }, 0, 'lead'],
		[
			'Major League counts every own skip',
			{ ruleset: 'ruleset_mp_majorleague', timer_increment_seconds: 60 },
			60_000,
			'own',
		],
		['another ruleset keeps the lead rule', { ruleset: 'ruleset_mp_balanced' }, null, 'lead'],
	])('%s', (_name, metadata, incrementMs, rule) => {
		const s = settingsAtStart(withRules(metadata), ['a', 'b'])
		expect(s.timerIncrementMs).toBe(incrementMs)
		expect(s.skipTimeRule).toBe(rule)
	})
})

describe('lead: the skips that count', () => {
	it.each<[string, SkipEntry | undefined, SkipEntry | undefined, number, number]>([
		['both known, ahead by two', entry(3), entry(1), 2, 0],
		['equal skips: no lead', entry(2), entry(2), 0, 0],
		['behind: no lead, the other side leads', entry(1), entry(3), 0, 2],
		['my skips unknown: no skip time', undefined, entry(1), 0, 0],
		['their skips unknown: no skip time', entry(4), undefined, 0, 0],
		['both unknown', undefined, undefined, 0, 0],
		['counts only skips since PvP', entry(5, 4), entry(3, 3), 1, 0],
		['an unknown baseline: no skip time', entry(2, null), entry(0, 0), 0, 0],
	])('lead rule: %s', (_name, a, b, aLead, bLead) => {
		const entries = { ...(a && { a }), ...(b && { b }) }
		expect(leadOf(settings(), entries, 'a', facing)).toBe(aLead)
		expect(leadOf(settings(), entries, 'b', facing)).toBe(bLead)
	})

	it('nobody faced: no lead', () => {
		expect(leadOf(settings(), { a: entry(9) }, 'a', nobody)).toBe(0)
	})

	it('own rule: every own skip since PvP adds time, facing or not', () => {
		const own = settings({ skipTimeRule: 'own' })
		const entries = { a: entry(5, 2), b: entry(7, 7) }
		expect(leadOf(own, entries, 'a', facing)).toBe(3)
		expect(leadOf(own, entries, 'a', nobody)).toBe(3)
		expect(leadOf(own, entries, 'b', facing)).toBe(0)
		expect(leadOf(own, { b: entry(7) }, 'a', facing)).toBe(0)
	})

	it('property: under the lead rule at most one of two opponents leads', () => {
		const known = fc.option(fc.nat({ max: 30 }), { nil: null })
		fc.assert(
			fc.property(known, known, known, known, (sa, sb, ba, bb) => {
				const entries = {
					a: entry(sa, sa === null ? null : Math.min(ba ?? 0, sa)),
					b: entry(sb, sb === null ? null : Math.min(bb ?? 0, sb)),
				}
				const lead = (id: string) => leadOf(settings(), entries, id, facing)
				expect(lead('a') > 0 && lead('b') > 0).toBe(false)
			}),
		)
	})
})

describe('bank: base + increment * lead - spent, 10 s .. 60 min', () => {
	it.each<[string, SkipEntry[], number]>([
		['nothing reported: the base', [], BASE],
		['one skip of lead', [entry(2), entry(1)], BASE + INC],
		['spent comes off', [entry(1, 0, 20_000), entry(1)], BASE - 20_000],
		['lead and spent together', [entry(3, 0, 30_000), entry(1)], BASE + 2 * INC - 30_000],
		['never below the floor', [entry(0, 0, 900_000), entry(0)], MIN_TIMER_MS],
		['never above the ceiling', [entry(99), entry(0)], MAX_TIMER_MS],
	])('%s', (_name, [a, b], expected) => {
		const entries = { ...(a && { a }), ...(b && { b }) }
		expect(anteBankMs(settings(), entries, 'a', facing)).toBe(expected)
	})

	it('no increment in the lobby (null): skips add no time', () => {
		const none = settings({ timerIncrementMs: null })
		expect(anteBankMs(none, { a: entry(5), b: entry(0) }, 'a', facing)).toBe(BASE)
	})

	it('property: always inside the bounds', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: 200 }),
				fc.nat({ max: 200 }),
				fc.nat({ max: 5_000_000 }),
				fc.constantFrom<'lead' | 'own'>('lead', 'own'),
				(sa, sb, spent, rule) => {
					const bank = anteBankMs(
						settings({ skipTimeRule: rule }),
						{ a: entry(sa, null, spent), b: entry(sb) },
						'a',
						facing,
					)
					expect(bank).toBeGreaterThanOrEqual(MIN_TIMER_MS)
					expect(bank).toBeLessThanOrEqual(MAX_TIMER_MS)
				},
			),
		)
	})
})

describe('the pinned opponent', () => {
	it('lead counts against the player faced at the last reset, not the live one', () => {
		const entries = {
			a: entry(5, 0, 0, 'b'),
			b: entry(1, 0),
			c: entry(5, 0),
		}
		const toC: OpponentOf = (id) => (id === 'a' ? 'c' : null)
		expect(leadOf(settings(), entries, 'a', toC)).toBe(4)
		expect(anteBankMs(settings(), entries, 'a', toC)).toBe(BASE + 4 * INC)
	})

	it('without a pin the live opponent stands in', () => {
		const entries = { a: entry(5, 0), b: entry(1, 0), c: entry(4, 0) }
		const toC: OpponentOf = (id) => (id === 'a' ? 'c' : null)
		expect(leadOf(settings(), entries, 'a', toC)).toBe(1)
	})
})

describe('spentRestarted: a run-out restart is from the base', () => {
	it('the bank is the base plus the skip time again', () => {
		const used = { a: entry(3, 0, 140_000), b: entry(1) }
		const out = spentRestarted(settings(), used, 'a', facing)
		expect(anteBankMs(settings(), out, 'a', facing)).toBe(BASE)
		expect(out.a.spentMs).toBe(2 * INC)
	})
})

describe('spentOut: a spend stops at the floor', () => {
	it('takes the whole spend while there is room', () => {
		const out = spentOut(settings(), {}, 'a', 20_000, facing)
		expect(out.a.spentMs).toBe(20_000)
		expect(anteBankMs(settings(), out, 'a', facing)).toBe(BASE - 20_000)
	})

	it('takes only what is above the floor, so a later skip is not swallowed', () => {
		const out = spentOut(
			settings(),
			{ a: entry(0), b: entry(0) },
			'a',
			1_000_000,
			facing,
		)
		expect(anteBankMs(settings(), out, 'a', facing)).toBe(MIN_TIMER_MS)
		const skipped = skipsReported(skipsReported(out, 'a', 1), 'b', 0)
		expect(anteBankMs(settings(), skipped, 'a', facing)).toBe(MIN_TIMER_MS + INC)
	})

	it('at the floor already: the same entries back', () => {
		const floor = { a: entry(null, null, BASE - MIN_TIMER_MS) }
		expect(spentOut(settings(), floor, 'a', 5_000, facing)).toBe(floor)
	})

	it('property: the bank after any run of spends is within bounds and never rises', () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 1, max: 400_000 }), { maxLength: 8 }),
				(spends) => {
					let entries = {}
					let last = anteBankMs(settings(), entries, 'a', facing)
					for (const ms of spends) {
						entries = spentOut(settings(), entries, 'a', ms, facing)
						const bank = anteBankMs(settings(), entries, 'a', facing)
						expect(bank).toBeLessThanOrEqual(last)
						expect(bank).toBeGreaterThanOrEqual(MIN_TIMER_MS)
						last = bank
					}
				},
			),
		)
	})
})

describe('skipsReported and skipsReset', () => {
	it('a resend is the same entries back', () => {
		const once = skipsReported({}, 'a', 2)
		expect(skipsReported(once, 'a', 2)).toBe(once)
	})

	it('reset: spent back to 0, the baseline is the skips so far, null stays null', () => {
		const reset = skipsReset(
			{ a: entry(4, 1, 30_000), b: entry(null, null, 5_000) },
			facing,
		)
		expect(reset).toEqual({
			a: entry(4, 4, 0, 'b'),
			b: entry(null, null, 0, 'a'),
		})
		expect(skipsSincePvp(reset.a)).toBe(0)
	})

	it('reset of a reset changes nothing', () => {
		const once = skipsReset({ a: entry(4, 1, 30_000) }, facing)
		expect(skipsReset(once, facing)).toBe(once)
	})

	it('property: reset is idempotent and zeroes every spend', () => {
		fc.assert(
			fc.property(
				fc.dictionary(
					fc.constantFrom('a', 'b', 'c'),
					fc.record({
						skips: fc.option(fc.nat({ max: 50 }), { nil: null }),
						skipsAtPvp: fc.option(fc.nat({ max: 50 }), { nil: null }),
						facing: fc.option(fc.constantFrom('a', 'b'), { nil: null }),
						spentMs: fc.nat({ max: 1_000_000 }),
					}),
				),
				(entries) => {
					const once = skipsReset(entries, facing)
					expect(skipsReset(once, facing)).toBe(once)
					for (const e of Object.values(once)) expect(e.spentMs).toBe(0)
				},
			),
		)
	})
})

// ------------------------------------------------------------ state-level harness

const IDS = ['a', 'b']

function envOf(
	state: RefereeState | null,
	readyIds: string[],
	over: { away?: string[]; metadata?: { [k: string]: unknown } } = {},
): TickEnv {
	return {
		runId: 'r1',
		startedIds: IDS,
		seatedIds: IDS,
		awayIds: over.away ?? [],
		readyIds,
		readiedIds: [],
		raceStarted: true,
		ranked: false,
		requiredIds: IDS,
		metadata:
			over.metadata ??
			withRules({
				ruleset: 'ruleset_mp_traditional',
				timer_increment_seconds: INC / 1000,
			}),
		picks: {},
		teamPlan: null,
	}
}

function begin(metadata?: { [k: string]: unknown }): RefereeState {
	const idle: RefereeState = {
		...emptyPvp(),
		facts: emptyFacts(),
		runId: 'r1',
		lastStart: startOf(IDS),
	}
	return reportAll(
		decide(idle, envOf(null, [], {
			metadata: withRules({
				ruleset: 'ruleset_mp_balanced',
				timer_base_seconds: BASE / 1000,
				timer_increment_seconds: INC / 1000,
				...metadata,
			}),
		}), testContext(0), pickMode).state,
	)
}

function tick(
	state: RefereeState,
	now: number,
	readyIds: string[] = [],
	away: string[] = [],
): RefereeState {
	return fromRuntime(
		decide(
			fromRuntime(state),
			envOf(state, readyIds, { away }),
			testContext(now),
			pickMode,
		).state,
	)
}

const must = (r: FactResult): RefereeState => {
	if (!r.ok) throw new Error(`refused: ${r.reason}`)
	return r.state
}

const world = (state: RefereeState, readyIds: string[]) =>
	worldOf(state, pickMode('royale', 2), readyIds, IDS)

// The skipped blind is the Small of the ante the sender has reported (3 skips need
// ante 2: the cap is two per ante). A test that skips more raises the ante first.
function skip(
	state: RefereeState,
	id: string,
	skips: number,
	ante = Math.max(1, Math.ceil(skips / 2)),
): RefereeState {
	const there = must(
		reduceProgress(state, id, { runId: 'r1', ante, furthestBlind: 0 }),
	)
	return must(
		reduceSkip(there, id, { runId: 'r1', skips, blindKey: `${ante}:Small` }),
	)
}

const skipArgs = (skips: number, blindKey: unknown = '1:Small') => ({
	runId: 'r1',
	skips,
	blindKey,
})

const bankOf = (state: RefereeState, id: string): number =>
	anteBankMs(
		state.rules as PvpSettings,
		state.facts.skips,
		id,
		world(state, []).opponentOf,
	)

// `by` Readied and starts an Ante timer; the tick at `now` opens it.
function startAnte(
	state: RefereeState,
	by: string,
	now: number,
	readyIds: string[] = [by],
): RefereeState {
	const started = must(
		reduceTimerStart(
			state,
			by,
			{ runId: 'r1', kind: 'ante' },
			world(state, readyIds),
		),
	)
	return tick(started, now, readyIds)
}

describe('pvp.skip', () => {
	it('a new run starts every seated player at 0 skips, a known fact', () => {
		const s = begin()
		expect(s.facts.skips.a).toMatchObject({ skips: 0, skipsAtPvp: 0, spentMs: 0 })
		expect(s.facts.skips.b).toMatchObject({ skips: 0, skipsAtPvp: 0, spentMs: 0 })
	})

	it('records the run total', () => {
		const s = skip(begin(), 'a', 2)
		expect(s.facts.skips.a.skips).toBe(2)
		expect(s.facts.skips.b.skips).toBe(0)
	})

	it('a resend is accepted and changes nothing', () => {
		const s = skip(begin(), 'a', 2)
		expect(reduceSkip(s, 'a', skipArgs(2))).toEqual({
			ok: true,
			state: s,
			changed: [],
		})
	})

	it('names the key it changed', () => {
		const r = reduceSkip(begin(), 'a', skipArgs(1))
		expect(r).toMatchObject({ ok: true, changed: ['pvp.skips'] })
	})

	it.each<[string, unknown, string]>([
		['a missing runId', { skips: 1, blindKey: '1:Small' }, 'bad_payload'],
		['the wrong run', { ...skipArgs(1), runId: 'other' }, 'round_over'],
		['a missing total', { runId: 'r1', blindKey: '1:Small' }, 'bad_payload'],
		['a negative total', skipArgs(-1), 'bad_payload'],
		['a fractional total', skipArgs(1.5), 'bad_payload'],
		['a string total', { ...skipArgs(1), skips: '2' }, 'bad_payload'],
		['an infinite total', skipArgs(Number.POSITIVE_INFINITY), 'bad_payload'],
		['a missing blindKey', { runId: 'r1', skips: 1 }, 'bad_payload'],
		['a malformed blindKey', skipArgs(1, '1-Small'), 'bad_payload'],
		['a non-string blindKey', skipArgs(1, 1), 'bad_payload'],
		['a Boss blindKey', skipArgs(1, '3:Boss'), 'not_skippable'],
		['a total over two per ante', skipArgs(100), 'over_cap'],
		['a blind past the reported ante', skipArgs(1, '4:Small'), 'ahead_of_progress'],
	])('refuses %s', (_name, args, reason) => {
		expect(reduceSkip(begin(), 'a', args)).toEqual({ ok: false, reason })
	})

	it('refuses a skip before any progress is reported', () => {
		const s = begin()
		const noAnte = {
			...s,
			round: {
				...s.round,
				players: { ...s.round.players, a: { ...s.round.players.a, ante: null } },
			},
		}
		expect(reduceSkip(noAnte, 'a', skipArgs(1))).toEqual({
			ok: false,
			reason: 'no_progress',
		})
	})

	it('two skips at ante 1, then four at ante 2, are accepted', () => {
		const s = skip(skip(begin(), 'a', 2, 1), 'a', 4, 2)
		expect(s.facts.skips.a.skips).toBe(4)
	})

	it('refuses a total lower than the recorded one', () => {
		const s = skip(begin(), 'a', 3)
		expect(reduceSkip(s, 'a', skipArgs(2, '2:Small'))).toEqual({
			ok: false,
			reason: 'stale_skips',
		})
	})

	it('a blind of the reported ante is accepted, the next ante is ahead of progress', () => {
		const s = must(
			reduceProgress(begin(), 'a', { runId: 'r1', ante: 3, furthestBlind: 0 }),
		)
		expect(reduceSkip(s, 'a', skipArgs(1, '4:Small'))).toEqual({
			ok: false,
			reason: 'ahead_of_progress',
		})
		expect(reduceSkip(s, 'a', skipArgs(1, '3:Big'))).toMatchObject({ ok: true })
	})

	// Skip every Small and Big up to ante 4, report ante 5, then replay ante 4 (a
	// Manhunt voucher lowered the ante) and skip its blinds again.
	function replayed(mode: 'manhunt' | 'royale'): FactResult {
		let s = begin({ queue_mode: mode === 'manhunt' ? 'pvp_manhunt' : 'pvp_nemesis' })
		for (let ante = 1; ante <= 4; ante++) {
			s = skip(s, 'a', 2 * ante - 1, ante)
			s = skip(s, 'a', 2 * ante, ante)
		}
		s = must(
			reduceProgress(s, 'a', { runId: 'r1', ante: 5, furthestBlind: 0 }),
		)
		s = must(reduceSkip(s, 'a', skipArgs(9, '4:Small')))
		s = must(reduceSkip(s, 'a', skipArgs(10, '4:Big')))
		return reduceSkip(s, 'a', skipArgs(11, '5:Small'))
	}

	it('Manhunt: skips after an ante-lowering voucher replay are accepted', () => {
		expect(replayed('manhunt')).toMatchObject({ ok: true })
	})

	it('another mode: the same replay is over_cap', () => {
		expect(replayed('royale')).toEqual({ ok: false, reason: 'over_cap' })
	})

	it.each<[string, string, number, boolean]>([
		['Manhunt: 2 * (ante + 2) is accepted', 'pvp_manhunt', 6, true],
		['Manhunt: one more is over_cap', 'pvp_manhunt', 7, false],
		['Nemesis: 2 * ante is accepted', 'pvp_nemesis', 2, true],
		['Nemesis: one more is over_cap', 'pvp_nemesis', 3, false],
	])('the cap at ante 1, %s', (_name, queueMode, total, accepted) => {
		const r = reduceSkip(
			begin({ queue_mode: queueMode }),
			'a',
			skipArgs(total, '1:Small'),
		)
		expect(r).toEqual(
			accepted
				? expect.objectContaining({ ok: true })
				: { ok: false, reason: 'over_cap' },
		)
	})

	// A model of the run, not the cap formula: a client that climbs an ante, or
	// (Manhunt, at most twice) is dropped one back by a voucher, skips both blinds of
	// every ante it newly reaches and of every ante a drop makes it play again;
	// climbing back over ground it has skipped adds none. An honest run is always accepted; one skip beyond the blinds it visited is
	// over_cap, and a blind above the reported ante is ahead_of_progress.
	it('property: an honest run is accepted, one skip more than it could visit is refused', () => {
		fc.assert(
			fc.property(
				fc.boolean(),
				fc.array(fc.boolean(), { maxLength: 10 }),
				(manhunt, ups) => {
					let s = begin({ queue_mode: manhunt ? 'pvp_manhunt' : 'pvp_nemesis' })
					let ante = 1
					let highest = 1
					let drops = 0
					let total = 0
					let previous = 0
					const visit = (skipBlinds: boolean): void => {
						s = must(
							reduceProgress(s, 'a', {
								runId: 'r1',
								ante: highest,
								furthestBlind: 0,
							}),
						)
						for (const blind of skipBlinds ? ['Small', 'Big'] : []) {
							total++
							s = must(reduceSkip(s, 'a', skipArgs(total, `${ante}:${blind}`)))
							expect(total).toBeGreaterThan(previous)
							previous = total
						}
					}
					visit(true)
					for (const up of ups) {
						if (up) {
							ante++
							const fresh = ante > highest
							highest = Math.max(highest, ante)
							visit(fresh)
						} else if (manhunt && drops < 2 && ante > 1) {
							drops++
							ante--
							visit(true)
						}
					}
					expect(s.facts.skips.a.skips).toBe(total)
					// Past the blinds it skipped is over_cap, unless a Manhunt run still
					// has a voucher to spend: it may yet replay an ante.
					const spare = manhunt && drops < 2
					expect(
						reduceSkip(s, 'a', skipArgs(total + 1, `${highest}:Small`)),
					).toMatchObject(spare ? { ok: true } : { ok: false, reason: 'over_cap' })
					expect(
						reduceSkip(s, 'a', skipArgs(total, `${highest + 1}:Small`)),
					).toEqual({ ok: false, reason: 'ahead_of_progress' })
				},
			),
		)
	})

	it('counts while a timer runs', () => {
		const running = startAnte(begin(), 'a', 0)
		expect(plainDeadline(running.facts.deadline)).not.toBeNull()
		expect(skip(running, 'b', 1).facts.skips.b.skips).toBe(1)
	})
})

describe('pvp.timer_spend', () => {
	const spend = (state: RefereeState, id: string, ms: unknown): FactResult =>
		reduceTimerSpend(state, id, { runId: 'r1', ms }, world(state, []))

	it('lowers the sender own bank by the cost', () => {
		const s = must(spend(begin(), 'a', 20_000))
		expect(bankOf(s, 'a')).toBe(BASE - 20_000)
		expect(bankOf(s, 'b')).toBe(BASE)
	})

	it('stops at the 10 s floor', () => {
		const s = must(spend(begin(), 'a', 9_000_000))
		expect(bankOf(s, 'a')).toBe(MIN_TIMER_MS)
		expect(spend(s, 'a', 5_000)).toEqual({ ok: true, state: s, changed: [] })
	})

	it.each<[string, unknown]>([
		['zero', 0],
		['negative', -5],
		['fractional', 1.5],
		['a string', '500'],
		['missing', undefined],
	])('refuses a cost that is %s', (_name, ms) => {
		expect(spend(begin(), 'a', ms)).toEqual({ ok: false, reason: 'bad_payload' })
	})

	it('refuses the wrong run', () => {
		expect(
			reduceTimerSpend(begin(), 'a', { runId: 'x', ms: 1_000 }, world(begin(), [])),
		).toEqual({ ok: false, reason: 'round_over' })
	})

	it('refuses while the sender holds a running deadline', () => {
		const running = startAnte(begin(), 'a', 0)
		expect(spend(running, 'a', 1_000)).toEqual({
			ok: false,
			reason: 'timer_running',
		})
	})

	it('refuses while the sender is timed by a running deadline', () => {
		const running = startAnte(begin(), 'a', 0)
		expect(spend(running, 'b', 1_000)).toEqual({
			ok: false,
			reason: 'timer_running',
		})
	})

	it('refuses while a start of the sender waits for the tick', () => {
		const started = must(
			reduceTimerStart(
				begin(),
				'a',
				{ runId: 'r1', kind: 'ante' },
				world(begin(), ['a']),
			),
		)
		expect(spend(started, 'a', 1_000)).toEqual({
			ok: false,
			reason: 'timer_running',
		})
	})
})

describe('pvp.timer_spend on a personal-clock ruleset (the Score Preview charge)', () => {
	const COST = 3_500
	// between rounds, `a` with a personal clock of `ms`
	const idle = (
		ms: number | null,
		running = false,
		ruleset = 'ruleset_mp_experimental',
	): RefereeState => {
		const s = begin({ ruleset })
		return {
			...s,
			round: { ...s.round, phase: 'resolved' },
			facts: {
				...s.facts,
				clocks:
					ms === null
						? {}
						: {
								a: {
									ms,
									running,
									rate: 1,
									n: 4,
									spent: false,
									since: 0,
									graceUntil: null,
								},
							},
			},
		}
	}
	const spend = (state: RefereeState, ms: unknown): FactResult =>
		reduceTimerSpend(state, 'a', { runId: 'r1', ms }, world(state, []))

	it('records a preview_charge fact and leaves the clock to the tick', () => {
		const before = idle(60_000)
		const s = must(spend(before, COST))
		expect(s.facts.clocks).toEqual(before.facts.clocks)
		expect(s.facts.log.slice(before.facts.log.length)).toEqual([
			{ type: 'preview_charge', playerId: 'a' },
		])
	})

	it('a running clock is accepted too: the tick charges the accrued value', () => {
		const before = idle(60_000, true)
		const s = must(spend(before, COST))
		expect(s.facts.clocks).toEqual(before.facts.clocks)
		expect(s.facts.log.slice(before.facts.log.length)).toEqual([
			{ type: 'preview_charge', playerId: 'a' },
		])
	})

	it('a Speedlatro preview costs nothing: no fact, no change', () => {
		const before = idle(60_000, false, 'ruleset_mp_speedlatro')
		expect(spend(before, 0)).toEqual({ ok: true, state: before, changed: [] })
	})

	it('refuses a cost that is not the ruleset preview cost', () => {
		expect(spend(idle(60_000), COST + 1)).toEqual({
			ok: false,
			reason: 'bad_payload',
		})
	})

	it('refuses with no clock yet: unknown is never a free spend', () => {
		expect(spend(idle(null), COST)).toEqual({ ok: false, reason: 'no_clock' })
	})

	it('is refused in_pvp while a PvP round is open', () => {
		const open = { ...idle(60_000), round: { ...idle(60_000).round, phase: 'playing' as const } }
		expect(spend(open, COST)).toEqual({ ok: false, reason: 'in_pvp' })
	})
})

describe('the Ante start: the server opens with the derived bank', () => {
	it.each<[string, unknown]>([
		['a server clock', 'server'],
		['an own clock', 'own'],
	])('refuses a start that names %s: the ruleset says who counts', (_name, clock) => {
		const r = reduceTimerStart(
			begin(),
			'a',
			{ runId: 'r1', kind: 'ante', clock },
			world(begin(), ['a']),
		)
		expect(r).toEqual({ ok: false, reason: 'bad_payload' })
	})

	it('the deadline opens with the starter bank: base plus the skip lead', () => {
		const skipped = skip(skip(begin(), 'a', 3), 'b', 1)
		const s = startAnte(skipped, 'a', 1_000)
		expect(plainDeadline(s.facts.deadline)).toMatchObject({
			by: 'a',
			shownMs: BASE + 2 * INC,
			endsAt: 1_000 + BASE + 2 * INC,
		})
	})

	it('the deadline with nothing reported opens with the base', () => {
		const s = startAnte(begin(), 'a', 0)
		expect(plainDeadline(s.facts.deadline)).toMatchObject({ shownMs: BASE })
	})
})

describe('the tick charges the time a server-counted deadline ran to its starter', () => {
	it("a pause charges what ran; the starter's bank is lower from then on", () => {
		const s = startAnte(begin(), 'a', 0)
		const paused = tick(
			must(reduceTimerPause(s, 'a', { runId: 'r1' })),
			40_000,
			['a'],
		)
		expect(plainDeadline(paused.facts.deadline)).toBeNull()
		expect(paused.facts.skips.a.spentMs).toBe(40_000)
		expect(bankOf(paused, 'a')).toBe(BASE - 40_000)
		expect(bankOf(paused, 'b')).toBe(BASE)
	})

	it('a drop (the starter is no longer Ready) charges what ran', () => {
		const s = startAnte(begin(), 'a', 0)
		const dropped = tick(s, 25_000, [])
		expect(plainDeadline(dropped.facts.deadline)).toBeNull()
		expect(dropped.facts.skips.a.spentMs).toBe(25_000)
	})

	it('time while a timed player is away is not charged', () => {
		let s = startAnte(begin(), 'a', 0)
		s = tick(s, 10_000, ['a'], ['b'])
		expect(s.facts.skips.a.spentMs).toBe(10_000)
		// away for 50 s: the clock stands still and nothing more is charged
		s = tick(s, 60_000, ['a'], ['b'])
		expect(s.facts.skips.a.spentMs).toBe(10_000)
		// back: 5 s run, then the starter pauses
		s = tick(s, 61_000, ['a'], [])
		const paused = tick(
			must(reduceTimerPause(s, 'a', { runId: 'r1' })),
			65_000,
			['a'],
		)
		expect(paused.facts.skips.a.spentMs).toBe(14_000)
	})

	it('a drop while paused for an away player charges nothing more', () => {
		let s = startAnte(begin(), 'a', 0)
		s = tick(s, 10_000, ['a'], ['b'])
		const dropped = tick(s, 20_000, [], ['b'])
		expect(dropped.facts.skips.a.spentMs).toBe(10_000)
	})

	it('a run-out restarts the deadline from the base and the bank with it', () => {
		const s = startAnte(begin(), 'a', 0)
		const out = tick(s, BASE, ['a'])
		expect(bankOf(out, 'a')).toBe(BASE)
		expect(plainDeadline(out.facts.deadline)).toMatchObject({
			by: 'a',
			shownMs: BASE,
			endsAt: 2 * BASE,
			n: 2,
		})
	})

	it('a pause after a run-out charges the restarted period', () => {
		const s = startAnte(begin(), 'a', 0)
		const out = tick(s, BASE, ['a'])
		const paused = tick(
			must(reduceTimerPause(out, 'a', { runId: 'r1' })),
			BASE + 30_000,
			['a'],
		)
		expect(bankOf(paused, 'a')).toBe(BASE - 30_000)
	})

	it('a skip after the time was used lifts the bank again', () => {
		const s = startAnte(begin(), 'a', 0)
		const paused = tick(
			must(reduceTimerPause(s, 'a', { runId: 'r1' })),
			100_000,
			['a'],
		)
		const skipped = skip(skip(paused, 'a', 1), 'b', 0)
		expect(bankOf(skipped, 'a')).toBe(BASE - 100_000 + INC)
	})
})

describe('reset: a PvP round opening or closing starts the next Ante from the base', () => {
	it('opening round 2 zeroes the spend and moves the skip baseline', () => {
		let s = skip(skip(begin(), 'a', 3), 'b', 1)
		s = must(
			reduceTimerSpend(s, 'a', { runId: 'r1', ms: 30_000 }, world(s, [])),
		)
		expect(bankOf(s, 'a')).toBe(BASE + 2 * INC - 30_000)
		const next = tick({ ...s, lastStart: startOf(IDS, 2) }, 5_000, [])
		expect(next.round.roundId).toBe(2)
		expect(next.facts.skips.a).toEqual(entry(3, 3, 0, 'b'))
		expect(bankOf(next, 'a')).toBe(BASE)
		// skips after the reset lead again from the new baseline
		const again = skip(skip(next, 'a', 4), 'b', 1)
		expect(bankOf(again, 'a')).toBe(BASE + INC)
	})

	it('a deadline running at round open is dropped uncharged: the next bank is the base', () => {
		const running = startAnte(begin(), 'a', 0)
		expect(plainDeadline(running.facts.deadline)).not.toBeNull()
		const next = tick({ ...running, lastStart: startOf(IDS, 2) }, 40_000, ['a'])
		expect(next.round.roundId).toBe(2)
		expect(plainDeadline(next.facts.deadline)).toBeNull()
		expect(next.facts.skips.a.spentMs).toBe(0)
		expect(bankOf(next, 'a')).toBe(BASE)
		const later = tick(next, 90_000, [])
		expect(bankOf(later, 'a')).toBe(BASE)
	})

	it('a player who never skipped stays at 0 through a reset', () => {
		const next = tick({ ...begin(), lastStart: startOf(IDS, 2) }, 5_000, [])
		expect(next.facts.skips.a).toMatchObject({ skips: 0, skipsAtPvp: 0 })
	})

	it('the Major League rule counts every own skip since the reset', () => {
		const ml = begin({
			ruleset: 'ruleset_mp_majorleague',
			timer_base_seconds: BASE / 1000, // ignored: the ruleset forces 180 s
			timer_increment_seconds: INC / 1000,
		})
		const s = skip(ml, 'a', 2)
		expect(ml.rules).toMatchObject({ skipTimeRule: 'own' })
		expect(bankOf(s, 'a')).toBe(180_000 + 2 * INC)
	})
})

describe('Nemesis re-pairing after a round closed', () => {
	const pairedAs = (
		partners: { [id: string]: string | null },
		skips: RefereeState['facts']['skips'],
	): RefereeState => {
		const base = begin()
		const players = {
			...base.lives.players,
			c: base.lives.players.a,
			d: base.lives.players.a,
		}
		return {
			...base,
			rules: {
				runId: 'r1',
				...settingsAtStart(
					withRules({
						timer_base_seconds: BASE / 1000,
						timer_increment_seconds: INC / 1000,
					}),
					['a', 'b', 'c', 'd'],
				),
			},
			lives: { ...base.lives, players },
			pairing: { ante: 2, partners, usedPairs: [], lastBye: null },
			facts: { ...base.facts, skips },
		}
	}
	const nemesis = pickMode('nemesis', 4)

	it('moves each pin to the new partner and leaves spend and baseline alone', () => {
		const pinned = {
			a: entry(6, 2, 10_000, 'b'),
			b: entry(3, 3, 0, 'a'),
			c: entry(1, 0, 0, 'd'),
			d: entry(0, 0, 0, 'c'),
		}
		const state = pairedAs({ a: 'c', c: 'a', b: 'd', d: 'b' }, pinned)
		const next = withFacingRepinned(state, nemesis)
		expect(next.facts.skips.a).toEqual(entry(6, 2, 10_000, 'c'))
		expect(next.facts.skips.b).toEqual(entry(3, 3, 0, 'd'))
		// a leads c by 4 - 1 = 3 now, not b by 4 - 0
		const opponentOf = worldOf(next, nemesis, [], []).opponentOf
		expect(leadOf(settings(), next.facts.skips, 'a', opponentOf)).toBe(3)
	})

	it('an unchanged pairing is the same state', () => {
		const pinned = { a: entry(1, 0, 0, 'b'), b: entry(0, 0, 0, 'a') }
		const state = pairedAs({ a: 'b', b: 'a', c: 'd', d: 'c' }, pinned)
		expect(withFacingRepinned(state, nemesis)).toBe(state)
	})

	it('an unpinned player keeps the live opponent', () => {
		const state = pairedAs(
			{ a: 'c', c: 'a', b: 'd', d: 'b' },
			{ a: entry(1, 0) },
		)
		expect(withFacingRepinned(state, nemesis)).toBe(state)
	})
})

// Both players have played their hands out with these scores.
function playedOut(
	state: RefereeState,
	scores: { [id: string]: string },
): RefereeState {
	const players = { ...state.round.players }
	const handRound = { ...state.facts.handRound }
	for (const id of Object.keys(scores)) {
		players[id] = { ...players[id], score: scores[id], handsLeft: 0 }
		handRound[id] = state.round.roundId
	}
	return {
		...state,
		round: { ...state.round, players },
		facts: { ...state.facts, handRound },
	}
}

describe('a PvP round that resolves through the tick', () => {
	it('closes with the spend gone, the baseline at the skips, and the base bank', () => {
		let s = skip(skip(begin(), 'a', 3), 'b', 1)
		s = must(reduceTimerSpend(s, 'a', { runId: 'r1', ms: 30_000 }, world(s, [])))
		expect(bankOf(s, 'a')).toBe(BASE + 2 * INC - 30_000)
		s = tick({ ...s, lastStart: startOf(IDS) }, 1_000, [])
		expect(s.round.phase).toBe('playing')
		s = skip(s, 'a', 4)
		s = { ...s, facts: { ...s.facts, skips: spentOut(
					settings(),
					s.facts.skips,
					'a',
					5_000,
					world(s, []).opponentOf,
				) } }
		s = playedOut(s, { a: '9', b: '1' })
		s = tick(s, 2_000, [])
		expect(s.round.phase).not.toBe('playing')
		expect(s.facts.skips.a.spentMs).toBe(0)
		expect(s.facts.skips.a.skipsAtPvp).toBe(s.facts.skips.a.skips)
		expect(s.facts.skips.b.skipsAtPvp).toBe(s.facts.skips.b.skips)
		expect(bankOf(s, 'a')).toBe(BASE)
	})
})

describe('the facts reducers stay registered', () => {
	it('pvp.skip is a fact reducer', () => {
		expect(FACT_REDUCERS['pvp.skip']).toBe(reduceSkip)
	})
})
