import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { withRules } from '../../testing/pvp_rules'
import { settingsAtStart } from '../../testing/pvp_settings'
import { pickMode } from './modes'
import {
	clockRowOf,
	isBlindKey,
	isBossBlind,
	modeOfQueue,
	rulesetIds,
	settingsFromMetadata,
} from './settings'
import type { AnteClock, ClockRules, PvpMode } from './state'

const PVP_CLOCK = { baseMs: 60_000, handMs: 10_000 }

// H2: every ruleset the PvP mod registers. A byte-identical copy lives in the PvP repo
// (tests/fixtures/net-v1/ruleset_ids.json), where a test checks it against the mod's
// rulesets/ files; this side checks it against the clock table.
const RULESET_IDS: string[] = JSON.parse(
	readFileSync(
		new URL('../__fixtures__/net-v1/ruleset_ids.json', import.meta.url),
		'utf8',
	),
)

const two = ['a', 'b']
const three = ['a', 'b', 'c']

describe('modeOfQueue', () => {
	it.each<[unknown, PvpMode | null]>([
		['pvp_nemesis', 'nemesis'],
		['pvp_experimental', 'nemesis'],
		['pvp_manhunt', 'manhunt'],
		['pvp_teams', 'teams'],
		['pvp_royale', 'royale'],
		['pvp_smallworld', 'royale'],
		['pvp_unknown', null],
		['toString', null],
		['', null],
		[undefined, null],
		[7, null],
	])('%s is %s', (queueMode, mode) => {
		expect(modeOfQueue(queueMode)).toBe(mode)
	})
})

describe('settingsAtStart', () => {
	it('reads every key of a complete lobby', () => {
		expect(settingsAtStart(withRules(), two)).toEqual({
			mode: 'nemesis',
			startedCount: 2,
			startingLives: 4,
			hunterLives: 7,
			deathOnRoundLoss: true,
			pvpStartAnte: 2,
			clocks: { ante: 'none', pvp: null, personal: null },
			timerBaseMs: 150_000,
			timerIncrementMs: null,
			skipTimeRule: 'lead',
			timerForgiveness: 0,
		})
	})

	it('reads the host-written keys', () => {
		expect(
			settingsAtStart(
				withRules({
					queue_mode: 'pvp_manhunt',
					starting_lives: 6,
					manhunt_hunter_lives: '9',
					pvp_start_round: 3,
					ruleset: 'ruleset_mp_experimental',
				}),
				three,
			),
		).toEqual({
			mode: 'manhunt',
			startedCount: 3,
			startingLives: 6,
			hunterLives: 9,
			deathOnRoundLoss: true,
			pvpStartAnte: 3,
			clocks: {
				ante: 'personal',
				pvp: { baseMs: 60_000, handMs: 10_000 },
				personal: {
					kind: 'pressure',
					baseMs: 300_000,
					timedRate: 2,
					previewCostMs: 3500,
				},
			},
			timerBaseMs: 150_000,
			timerIncrementMs: null,
			skipTimeRule: 'lead',
			timerForgiveness: 0,
		})
	})

	it.each<[string, unknown, number]>([
		['90 seconds', 90, 90_000],
		['a numeric string', '45', 45_000],
		['a fraction rounds to whole ms', 10.0004, 10_000],
		['under 10 seconds clamps up', 3, 10_000],
		['zero clamps up', 0, 10_000],
		['a negative clamps up', -5, 10_000],
		['over 60 minutes clamps down', 7200, 3_600_000],
	])('timer_base_seconds %s', (_name, value, expected) => {
		expect(
			settingsAtStart(withRules({ timer_base_seconds: value }), two).timerBaseMs,
		).toBe(expected)
	})

	it.each<[string, unknown, number]>([
		['3 forgiven', 3, 3],
		['a numeric string', '2', 2],
		['over 9 clamps down', 12, 9],
		['a negative clamps up', -1, 0],
	])('timer_forgiveness %s', (_name, value, expected) => {
		expect(
			settingsAtStart(withRules({ timer_forgiveness: value }), two).timerForgiveness,
		).toBe(expected)
	})

	it.each<[string, ClockRules['pvp']]>([
		['ruleset_mp_experimental', PVP_CLOCK],
		['ruleset_mp_balanced', PVP_CLOCK],
		['ruleset_mp_expanded', PVP_CLOCK],
		['ruleset_mp_speedlatro', null],
		['ruleset_mp_majorleague', null],
	])('clocks.pvp of %s', (ruleset, pvp) => {
		expect(settingsAtStart(withRules({ ruleset }), two).clocks.pvp).toEqual(pvp)
	})

	it.each<[string, { [k: string]: unknown }, 'bad_rules' | AnteClock]>([
		['a missing ruleset', {}, 'bad_rules'],
		['an unknown ruleset', { ruleset: 'ruleset_mp_nope' }, 'bad_rules'],
		['an inherited key', { ruleset: 'toString' }, 'bad_rules'],
		['a non-string ruleset', { ruleset: 7 }, 'bad_rules'],
		[
			'experimental_legacy',
			{ ruleset: 'ruleset_mp_experimental_legacy' },
			'bank',
		],
		['balanced', { ruleset: 'ruleset_mp_balanced' }, 'bank'],
		['majorleague', { ruleset: 'ruleset_mp_majorleague' }, 'bank'],
		['experimental', { ruleset: 'ruleset_mp_experimental' }, 'personal'],
		['speedlatro', { ruleset: 'ruleset_mp_speedlatro' }, 'personal'],
		['chaos', { ruleset: 'ruleset_mp_chaos' }, 'personal'],
		['traditional', { ruleset: 'ruleset_mp_traditional' }, 'none'],
	])('the ante clock of %s', (_name, over, expected) => {
		const found = clockRowOf(over.ruleset)
		expect(found.ok ? found.row.ante : found.reason).toBe(expected)
		const metadata = withRules({ ruleset: over.ruleset })
		if (expected === 'bad_rules')
			expect(settingsFromMetadata(metadata, two)).toEqual({
				ok: false,
				reason: 'bad_rules',
				key: 'ruleset',
			})
		else expect(settingsAtStart(metadata, two).clocks.ante).toBe(expected)
	})

	it.each(RULESET_IDS)('%s is in the table', (ruleset) => {
		expect(clockRowOf(ruleset).ok).toBe(true)
	})

	it('the table has a row for exactly the rulesets the mod registers', () => {
		expect([...rulesetIds()].sort()).toEqual(RULESET_IDS)
	})

	it('Speedlatro and Chaos keep their numbers; Pressure reads the lobby base', () => {
		const speedlatro = {
			kind: 'speedlatro',
			baseMs: 147_000,
			pvpMs: 73_500,
			graceMs: 4000,
			timedRate: 2,
			previewCostMs: 0,
		}
		for (const ruleset of ['ruleset_mp_speedlatro', 'ruleset_mp_chaos'])
			expect(settingsAtStart(withRules({ ruleset }), two).clocks.personal).toEqual(
				speedlatro,
			)
		expect(
			settingsAtStart(
				withRules({ ruleset: 'ruleset_mp_experimental', timer_base_seconds: 100 }),
				two,
			).clocks.personal,
		).toEqual({
			kind: 'pressure',
			baseMs: 200_000,
			timedRate: 2,
			previewCostMs: 3500,
		})
	})

	it('starting_lives reads a whole number or a numeric string', () => {
		expect(settingsAtStart(withRules({ starting_lives: '5' }), two).startingLives).toBe(5)
	})

	it('a lobby that writes no timer_increment_seconds has no skip time', () => {
		expect(
			settingsAtStart(withRules({ timer_increment_seconds: undefined }), two)
				.timerIncrementMs,
		).toBeNull()
	})
})

// D1c: the server reads what the client always writes and invents nothing. A key it
// reads that is missing or malformed is a bad_rules result naming the key.
describe('settingsFromMetadata refuses a missing or malformed key (D1c)', () => {
	const missingOrBad: [string, string, unknown][] = [
		['ruleset', 'a missing ruleset', undefined],
		['queue_mode', 'a missing queue_mode', undefined],
		['queue_mode', 'an unknown queue_mode', 'pvp_mystery'],
		['queue_mode', 'an inherited queue_mode', 'toString'],
		['starting_lives', 'a missing starting_lives', undefined],
		['starting_lives', 'zero lives', 0],
		['starting_lives', 'negative lives', -3],
		['starting_lives', 'fractional lives', 2.5],
		['starting_lives', 'text lives', 'abc'],
		['starting_lives', 'null lives', null],
		['manhunt_hunter_lives', 'a missing hunter lives', undefined],
		['manhunt_hunter_lives', 'zero hunter lives', '0'],
		['pvp_start_round', 'a missing pvp_start_round', undefined],
		['pvp_start_round', 'an empty pvp_start_round', ''],
		['timer_base_seconds', 'a missing timer base', undefined],
		['timer_base_seconds', 'a text timer base', 'abc'],
		['timer_base_seconds', 'a null timer base', null],
		['timer_base_seconds', 'an infinite timer base', Number.POSITIVE_INFINITY],
		['timer_forgiveness', 'a missing forgiveness', undefined],
		['timer_forgiveness', 'a text forgiveness', 'x'],
		['timer_increment_seconds', 'a text increment', 'soon'],
	]

	it.each(missingOrBad)('%s: %s', (key, _name, value) => {
		expect(settingsFromMetadata(withRules({ [key]: value }), two)).toEqual({
			ok: false,
			reason: 'bad_rules',
			key,
		})
	})

	it('names the first bad key when several are bad', () => {
		const result = settingsFromMetadata(
			withRules({ starting_lives: 'x', timer_base_seconds: 'y' }),
			two,
		)
		expect(result).toEqual({ ok: false, reason: 'bad_rules', key: 'starting_lives' })
	})

	it.each(['ruleset_mp_majorleague', 'ruleset_mp_minorleague'])(
		'%s needs no timer keys: it forces them',
		(ruleset) => {
			const result = settingsFromMetadata(
				withRules({
					ruleset,
					timer_base_seconds: undefined,
					timer_forgiveness: undefined,
				}),
				two,
			)
			expect(result.ok).toBe(true)
		},
	)

	it('never throws on hostile metadata', () => {
		expect(() =>
			settingsFromMetadata({ ruleset: {}, queue_mode: [], starting_lives: {} }, two),
		).not.toThrow()
	})
})

describe('queue_mode x startedCount -> mode and rule set', () => {
	it.each([
		['pvp_nemesis', two, 'nemesis', 'duel'],
		['pvp_nemesis', three, 'nemesis', 'nemesis'],
		['pvp_experimental', two, 'nemesis', 'duel'],
		['pvp_experimental', three, 'nemesis', 'nemesis'],
		['pvp_royale', two, 'royale', 'duel'],
		['pvp_royale', three, 'royale', 'royale'],
		['pvp_smallworld', two, 'royale', 'duel'],
		['pvp_smallworld', three, 'royale', 'royale'],
		['pvp_manhunt', two, 'manhunt', 'manhunt'],
		['pvp_manhunt', three, 'manhunt', 'manhunt'],
		['pvp_teams', two, 'teams', 'teams'],
		['pvp_teams', three, 'teams', 'teams'],
	])('%s with %i players', (queueMode, ids, mode, rules) => {
		const settings = settingsAtStart(withRules({ queue_mode: queueMode }), ids)
		expect(settings.mode).toBe(mode)
		expect(settings.startedCount).toBe(ids.length)
		expect(pickMode(settings.mode, settings.startedCount).name).toBe(rules)
	})
})

describe('isBlindKey and isBossBlind', () => {
	it.each<[unknown, boolean]>([
		['2:Boss', true],
		['10:Small', true],
		['1:Big', true],
		['Boss', false],
		['2:boss', false],
		['2:Boss\n', false],
		[2, false],
		[undefined, false],
	])('isBlindKey(%j) is %s', (value, ok) => {
		expect(isBlindKey(value)).toBe(ok)
	})

	it.each([
		['2:Boss', true],
		['1:Boss', true],
		['0:Boss', true],
		['2:Small', false],
		['9:Big', false],
	])('isBossBlind(%s) is %s', (blindKey, expected) => {
		expect(isBossBlind(blindKey)).toBe(expected)
	})

})

// The league rulesets force the lobby's timers (the client's majorleague.lua:11-12 and
// minorleague.lua:7-8): whatever the host's lobby metadata says, the frozen settings
// read the forced numbers.
describe('the league rulesets force their timers (D1c)', () => {
	const host = { timer_base_seconds: 600, timer_forgiveness: 3 }
	it.each([
		['ruleset_mp_majorleague', 180_000, 0],
		['ruleset_mp_minorleague', 210_000, 1],
	])('%s freezes base %i ms and forgiveness %i whatever the host wrote', (ruleset, baseMs, forgiveness) => {
		const s = settingsAtStart(withRules({ ruleset, ...host }), two)
		expect(s.timerBaseMs).toBe(baseMs)
		expect(s.timerForgiveness).toBe(forgiveness)
	})

	it('a ruleset without forced timers still reads the host values', () => {
		const s = settingsAtStart(withRules(host), two)
		expect(s.timerBaseMs).toBe(600_000)
		expect(s.timerForgiveness).toBe(3)
	})
})
