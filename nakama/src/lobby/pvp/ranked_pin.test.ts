import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pinFor, rankedPinOf, splitPinnedPatch } from './ranked_pin'
import { settingsFromMetadata } from './settings'

// The five ranked tickets the client queues (pvp_api/queue.lua, PVP._join_ranked_ruleset:
// balanced, expanded, vanilla, majorleague, smallworld), each "pvp_ranked_<ruleset short>".
// The client's lobby defaults (core.lua) give lives 4, PvP from ante 2, a 150 s base,
// no forgiveness and a 60 s skip increment; the league ruleset forces its own timers.
const OPEN = {
	queue_mode: 'pvp_nemesis',
	starting_lives: 4,
	manhunt_hunter_lives: 7,
	pvp_start_round: 2,
	timer_base_seconds: 150,
	timer_forgiveness: 0,
	timer_increment_seconds: 60,
}

describe('rankedPinOf: the rules a ranked lobby is pinned to (D1b)', () => {
	it.each([
		['balanced', { ruleset: 'ruleset_mp_balanced', ...OPEN }],
		['expanded', { ruleset: 'ruleset_mp_expanded', ...OPEN }],
		['vanilla', { ruleset: 'ruleset_mp_vanilla', ...OPEN }],
		['smallworld', { ruleset: 'ruleset_mp_smallworld', ...OPEN }],
	])(
		'pvp_ranked_%s pins its ruleset, Nemesis, lives, start ante and timers',
		(short, pin) => {
			expect(rankedPinOf(`pvp_ranked_${short}`)).toEqual({ ok: true, pin })
		},
	)

	it('pvp_ranked_majorleague leaves the timers the ruleset forces out of the pin', () => {
		expect(rankedPinOf('pvp_ranked_majorleague')).toEqual({
			ok: true,
			pin: {
				ruleset: 'ruleset_mp_majorleague',
				queue_mode: 'pvp_nemesis',
				starting_lives: 4,
				manhunt_hunter_lives: 7,
				pvp_start_round: 2,
				timer_increment_seconds: 60,
			},
		})
	})

	it.each([
		'',
		'pvp_ranked_standard',
		'pvp_ranked_',
		'pvp_ranked_chaos',
		'ranked:pvp_ranked_balanced',
		'balanced',
		'pvp_ranked_toString',
		'pvp_ranked___proto__',
	])('%j is an unknown ranked mode', (mode) => {
		expect(rankedPinOf(mode)).toEqual({
			ok: false,
			reason: 'unknown_ranked_mode',
		})
	})

	it.each(['balanced', 'expanded', 'vanilla', 'majorleague', 'smallworld'])(
		'a pin plus the keys the host adds always freezes (pvp_ranked_%s)',
		(short) => {
			const found = rankedPinOf(`pvp_ranked_${short}`)
			if (!found.ok) throw new Error('no pin')
			const metadata = {
				...found.pin,
				manhunt_hunter_lives: 7,
				deck: 'Red Deck',
			}
			expect(settingsFromMetadata(metadata, ['a', 'b']).ok).toBe(true)
		},
	)
})

describe('pinFor: which lobbies are pinned', () => {
	it('a PvP ranked lobby takes its pin', () => {
		expect(pinFor('MultiplayerPvP', 'pvp_ranked_balanced')).toEqual(
			rankedPinOf('pvp_ranked_balanced'),
		)
	})

	it('a casual lobby (no ranked mode) and another mod have no pin', () => {
		expect(pinFor('MultiplayerPvP', '')).toEqual({ ok: true, pin: {} })
		expect(pinFor('MultiplayerSPDRN', 'duel')).toEqual({ ok: true, pin: {} })
	})

	it('an unknown PvP ranked mode is refused', () => {
		expect(pinFor('MultiplayerPvP', 'pvp_ranked_standard')).toEqual({
			ok: false,
			reason: 'unknown_ranked_mode',
		})
	})
})

describe('splitPinnedPatch: a ranked lobby keeps its pinned keys', () => {
	const pin = {
		ruleset: 'ruleset_mp_balanced',
		starting_lives: 4,
		queue_mode: 'pvp_nemesis',
	}

	it('accepts a pinned key written with the pinned value and refuses a different one, per key', () => {
		expect(
			splitPinnedPatch(
				{
					ruleset: 'ruleset_mp_balanced',
					starting_lives: 9,
					queue_mode: 'pvp_royale',
					deck: 'Blue Deck',
				},
				pin,
			),
		).toEqual({
			accepted: { ruleset: 'ruleset_mp_balanced', deck: 'Blue Deck' },
			refused: ['starting_lives', 'queue_mode'],
		})
	})

	it('an honest lobby_ready patch (deck, stake, kind) is accepted whole', () => {
		const patch = { deck: 'Red Deck', stake: '1', kind: 'ranked' }
		expect(splitPinnedPatch(patch, pin)).toEqual({
			accepted: patch,
			refused: [],
		})
	})

	it('a key the pin does not name is never refused', () => {
		fc.assert(
			fc.property(
				fc.dictionary(
					fc.string().filter((k) => !(k in pin) && k !== '__proto__'),
					fc.jsonValue(),
				),
				(patch) => {
					const split = splitPinnedPatch(patch, pin)
					expect(split.refused).toEqual([])
					expect(split.accepted).toEqual(patch)
				},
			),
		)
	})

	it('an empty pin accepts everything', () => {
		expect(splitPinnedPatch({ ruleset: 'x' }, {})).toEqual({
			accepted: { ruleset: 'x' },
			refused: [],
		})
	})
})
