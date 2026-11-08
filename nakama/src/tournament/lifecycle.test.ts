import { describe, expect, it } from 'vitest'
import { resolveBracket } from './engine/resolve'
import { seededRng } from './engine/seeding'
import {
	type RatingsLookup,
	advance,
	cancel,
	checkInEntrant,
	createTournament,
	fittedFormatOptions,
	joinTournament,
	leaveTournament,
	openRegistration,
	promote,
	setManualSeeding,
	setRegistrationClosed,
	start,
	updateSettings,
	wakeAt,
} from './lifecycle'
import { type Input, type Tournament, roundNamesOf, roundNumberOf, roundSettingsFor } from './model'

const MIN = 60 * 1000
const NOW = Date.UTC(2026, 10, 7, 12, 0)
const START = NOW + 2 * 60 * MIN
const ORG = { id: 'org', name: 'Organiser' }

function settings(extra: Input = {}): Input {
	return {
		name: 'Friday Cup',
		format: 'single_elim',
		maxPlayers: 8,
		startsAt: START,
		checkInMinutes: 30,
		rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 } },
		timetable: { kind: 'preset', preset: 'live_event', options: {} },
		...extra,
	}
}

function value(r: { ok: true; value: Tournament } | { ok: false; error: { message: string } }): Tournament {
	if (!r.ok) throw new Error(r.error.message)
	return r.value
}

function opened(extra: Input = {}): Tournament {
	return value(openRegistration(value(createTournament('t1', ORG, settings(extra), 'ABC123', NOW)), 'org', NOW))
}

function withPlayers(t: Tournament, n: number): Tournament {
	let out = t
	for (let i = 1; i <= n; i++) out = value(joinTournament(out, { id: `p${i}`, name: `Player ${i}` }, NOW))
	return out
}

const ratings: RatingsLookup = (ids) => {
	const out: { [id: string]: number } = {}
	// p1 unrated; higher number = higher rating.
	for (const id of ids) if (id !== 'p1') out[id] = 1000 + Number(id.slice(1)) * 10
	return out
}

function kinds(t: Tournament): string[] {
	return t.events.map((e) => e.kind)
}

describe('create and open', () => {
	it('creates a draft and validates the settings', () => {
		const t = value(createTournament('t1', ORG, settings(), 'ABC123', NOW))
		expect(t).toMatchObject({ status: 'draft', organiserId: 'org', inviteCode: 'ABC123', maxPlayers: 8, checkInMinutes: 30 })
		expect(createTournament('t1', ORG, settings({ name: 'x' }), 'C', NOW).ok).toBe(false)
		expect(createTournament('t1', ORG, settings({ startsAt: NOW + MIN }), 'C', NOW).ok).toBe(false)
		expect(createTournament('t1', ORG, settings({ maxPlayers: 129 }), 'C', NOW).ok).toBe(false)
		expect(createTournament('t1', ORG, settings({ checkInMinutes: 5 }), 'C', NOW).ok).toBe(false)
		expect(createTournament('t1', ORG, settings({ rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'x', bestOf: 2 } } }), 'C', NOW).ok).toBe(false)
		expect(createTournament('t1', ORG, settings({ timetable: { kind: 'preset', preset: 'nope' } }), 'C', NOW).ok).toBe(false)
	})

	it("can't be given another id or status through the settings", () => {
		const t = value(createTournament('t1', ORG, settings({ id: 'evil', status: 'running' }), 'C', NOW))
		expect(t.id).toBe('t1')
		expect(t.status).toBe('draft')
	})

	it('accepts per-round overrides and a deck draft', () => {
		const t = value(
			createTournament(
				't1',
				ORG,
				settings({
					rounds: {
						defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1, deck: { kind: 'draft', decks: ['b_red', 'b_blue'], stakes: [1, 2], banOrder: 'lower_seed_first' } },
						overrides: { W3: { bestOf: 5, deck: { kind: 'locked', deck: 'b_red', stake: 8 } } },
					},
				}),
				'C',
				NOW,
			),
		)
		expect(t.rounds.overrides.W3).toMatchObject({ bestOf: 5 })
	})

	it('needs the decks a Cocktail mixes, locked or in a pool', () => {
		const deck = (d: Input) => settings({ rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1, deck: d } } })
		const made = (d: Input) => createTournament('t1', ORG, deck(d), 'C', NOW)
		const beans = { name: " Bean's Cocktail ", decks: ['b_abandoned', 'b_erratic', 'b_checkered'] }
		const locked = made({ kind: 'locked', deck: 'b_mp_cocktail', stake: 6, cocktail: beans })
		expect(locked.ok && locked.value.rounds.defaults.deck).toEqual({ kind: 'locked', deck: 'b_mp_cocktail', stake: 6, cocktail: { name: "Bean's Cocktail", decks: beans.decks } })
		expect(made({ kind: 'locked', deck: 'b_mp_cocktail', stake: 6 }).ok).toBe(false)
		expect(made({ kind: 'locked', deck: 'b_mp_cocktail', stake: 6, cocktail: { decks: [] } }).ok).toBe(false)
		expect(made({ kind: 'locked', deck: 'b_mp_cocktail', stake: 6, cocktail: { decks: ['b_red', 'b_blue', 'b_green', 'b_black'] } }).ok).toBe(false)
		expect(made({ kind: 'locked', deck: 'b_mp_cocktail', stake: 6, cocktail: { decks: ['b_red', 'b_red'] } }).ok).toBe(false)
		expect(made({ kind: 'locked', deck: 'b_mp_cocktail', stake: 6, cocktail: { decks: ['b_mp_cocktail'] } }).ok).toBe(false)
		// Another deck ignores a recipe.
		const red = made({ kind: 'locked', deck: 'b_red', stake: 1, cocktail: beans })
		expect(red.ok && red.value.rounds.defaults.deck).toEqual({ kind: 'locked', deck: 'b_red', stake: 1 })
		// A pool holds Cocktails as their own items, each with its mix.
		const pool = made({ kind: 'draft', decks: ['b_red'], stakes: [1], banOrder: 'random', cocktails: [{ decks: ['b_red', 'b_blue'] }, { name: 'Mix', decks: ['b_black'] }] })
		expect(pool.ok && pool.value.rounds.defaults.deck).toMatchObject({ decks: ['b_red'], cocktails: [{ decks: ['b_red', 'b_blue'] }, { name: 'Mix', decks: ['b_black'] }] })
		expect(made({ kind: 'draft', decks: [], stakes: [1], banOrder: 'random', cocktails: [{ decks: ['b_red'] }] }).ok).toBe(true)
		expect(made({ kind: 'draft', decks: [], stakes: [1], banOrder: 'random' }).ok).toBe(false)
		expect(made({ kind: 'draft', decks: ['b_mp_cocktail'], stakes: [1], banOrder: 'random' }).ok).toBe(false)
		expect(made({ kind: 'draft', decks: ['b_red'], stakes: [1], banOrder: 'random', cocktails: [{ decks: [] }] }).ok).toBe(false)
	})

	it("takes PvP's stakes above Gold (Planet, Spectral, Spectral+ are 9-11)", () => {
		const deck = (d: Input) => settings({ rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1, deck: d } } })
		expect(createTournament('t1', ORG, deck({ kind: 'locked', deck: 'b_red', stake: 11 }), 'C', NOW).ok).toBe(true)
		expect(createTournament('t1', ORG, deck({ kind: 'draft', decks: ['b_red'], stakes: [5, 9, 10, 11], banOrder: 'random' }), 'C', NOW).ok).toBe(true)
		expect(createTournament('t1', ORG, deck({ kind: 'locked', deck: 'b_red', stake: 33 }), 'C', NOW).ok).toBe(false)
		expect(createTournament('t1', ORG, deck({ kind: 'draft', decks: ['b_red'], stakes: [0], banOrder: 'random' }), 'C', NOW).ok).toBe(false)
	})

	it('takes "no check-in" and empty format options the way a Lua client sends them', () => {
		const t = value(createTournament('t1', ORG, settings({ format: 'round_robin', formatOptions: { groupSize: 4 } }), 'C', NOW))
		const off = value(updateSettings(t, 'org', { checkInMinutes: false, formatOptions: [] }, NOW))
		expect(off.checkInMinutes).toBeNull()
		expect(off.formatOptions).toEqual({})
	})

	it('only the organiser opens registration', () => {
		const t = value(createTournament('t1', ORG, settings(), 'C', NOW))
		expect(openRegistration(t, 'someone', NOW).ok).toBe(false)
		expect(value(openRegistration(t, 'org', NOW)).status).toBe('registration')
	})
})

describe('registration', () => {
	it('fills up, then waitlists; no automatic promotion', () => {
		let t = withPlayers(opened({ maxPlayers: 2 }), 3)
		expect(t.entrants.map((e) => e.userId)).toEqual(['p1', 'p2'])
		expect(t.waitlist.map((e) => e.userId)).toEqual(['p3'])
		t = value(leaveTournament(t, 'p1', NOW))
		expect(t.entrants.map((e) => e.userId)).toEqual(['p2'])
		expect(t.waitlist.map((e) => e.userId)).toEqual(['p3'])
		t = value(promote(t, 'org', 'p3', NOW))
		expect(t.entrants.map((e) => e.userId)).toEqual(['p2', 'p3'])
		expect(joinTournament(t, { id: 'p2', name: 'again' }, NOW).ok).toBe(false)
	})

	it('can be closed early and reopened by the organiser', () => {
		let t = value(setRegistrationClosed(opened(), 'org', true, NOW))
		expect(joinTournament(t, { id: 'p1', name: 'P' }, NOW).ok).toBe(false)
		t = value(setRegistrationClosed(t, 'org', false, NOW))
		expect(joinTournament(t, { id: 'p1', name: 'P' }, NOW).ok).toBe(true)
	})

	it("won't lower the player limit below who has joined", () => {
		const t = withPlayers(opened(), 4)
		expect(updateSettings(t, 'org', { maxPlayers: 3 }, NOW).ok).toBe(false)
		expect(updateSettings(t, 'org', { maxPlayers: 4 }, NOW).ok).toBe(true)
	})

	it('wakes for check-in, then for the start', () => {
		const t = opened()
		expect(wakeAt(t)).toBe(START - 30 * MIN)
		expect(wakeAt(opened({ checkInMinutes: null }))).toBe(START)
		expect(wakeAt(value(createTournament('t', ORG, settings(), 'C', NOW)))).toBe(null)
	})
})

describe('check-in and start', () => {
	it('opens check-in, removes no-shows, seeds by rating (unrated last), builds the bracket', () => {
		let t = withPlayers(opened(), 5)
		expect(advance(t, START - 31 * MIN, ratings, seededRng(1))).toBe(null)
		t = advance(t, START - 30 * MIN, ratings, seededRng(1)) as Tournament
		expect(t.status).toBe('check_in')
		expect(joinTournament(t, { id: 'late', name: 'Late' }, NOW).ok).toBe(false)
		for (const id of ['p1', 'p2', 'p3', 'p4']) t = value(checkInEntrant(t, id, START - 10 * MIN))
		t = advance(t, START, ratings, seededRng(1)) as Tournament
		expect(t.status).toBe('running')
		expect(t.entrants.map((e) => e.userId)).toEqual(['p1', 'p2', 'p3', 'p4'])
		expect(t.bracket?.seeds).toEqual(['p4', 'p3', 'p2', 'p1'])
		expect(kinds(t)).toEqual(expect.arrayContaining(['check_in_opened', 'no_shows_removed', 'started', 'block_started', 'match_opened']))
		const open = Object.keys(t.clock?.matches ?? {})
		expect(open.sort()).toEqual(['W1-1', 'W1-2'])
	})

	it('cancels when fewer than two players checked in', () => {
		let t = withPlayers(opened(), 3)
		t = advance(t, START - 30 * MIN, ratings, seededRng(1)) as Tournament
		t = value(checkInEntrant(t, 'p1', START - 5 * MIN))
		t = advance(t, START, ratings, seededRng(1)) as Tournament
		expect(t.status).toBe('cancelled')
		expect(t.events[t.events.length - 1]).toMatchObject({ kind: 'cancelled', reason: 'not_enough_players' })
	})

	it('starts everyone when there is no check-in', () => {
		const t = advance(withPlayers(opened({ checkInMinutes: null }), 3), START, ratings, seededRng(1)) as Tournament
		expect(t.status).toBe('running')
		expect(t.bracket?.seeds.length).toBe(3)
	})

	it('puts players the organiser did not place after the manual seeds', () => {
		let t = withPlayers(opened({ checkInMinutes: null }), 4)
		t = value(setManualSeeding(t, 'org', ['p3', 'p1'], NOW))
		t = value(start(t, NOW, ratings, seededRng(1)))
		expect(t.bracket?.seeds).toEqual(['p3', 'p1', 'p2', 'p4'])
	})

	it('fits Swiss rounds and group sizes to the turnout', () => {
		expect(fittedFormatOptions('swiss', { swissRounds: 7 }, 4)).toEqual({ swissRounds: 3 })
		expect(fittedFormatOptions('round_robin', { groupSize: 2 }, 3)).toEqual({ groupSize: 3 })
		const t = value(start(withPlayers(opened({ checkInMinutes: null, format: 'swiss', formatOptions: { swissRounds: 5 } }), 3), NOW, ratings, seededRng(1)))
		expect(t.bracket?.options.swissRounds).toBe(2)
	})
})

describe('round by round settings', () => {
	const ORANGE_ON_BLACK = { kind: 'locked', deck: 'b_red', stake: 4 }
	const BLACK_ON_ORANGE = { kind: 'locked', deck: 'b_black', stake: 7 }
	function startedWith(format: string, players: number, overrides: Input) {
		const rounds = { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 }, overrides }
		return value(start(withPlayers(opened({ checkInMinutes: null, format, maxPlayers: 16, rounds }), players), NOW, ratings, seededRng(1)))
	}

	it('numbers rounds in playing order and names them from the end', () => {
		const se = startedWith('single_elim', 16, {}).bracket!
		expect([1, 2, 3, 4].map((r) => roundNumberOf(se, 'W', r))).toEqual([1, 2, 3, 4])
		expect([1, 2, 3, 4].map((r) => roundNamesOf(se, 'W', r))).toEqual([[], ['QUARTER'], ['SEMI'], ['FINAL']])
		// Double elimination, 8 players: W1 | W2 + L1 | L2 | W3 + L3 | L4 | GF.
		const de = startedWith('double_elim', 8, {}).bracket!
		expect(roundNumberOf(de, 'W', 2)).toBe(2)
		expect(roundNumberOf(de, 'L', 1)).toBe(2)
		expect(roundNumberOf(de, 'L', 2)).toBe(3)
		expect(roundNumberOf(de, 'GF', 1)).toBe(6)
		expect(roundNamesOf(de, 'W', 3)).toEqual(['WINNERS_FINAL'])
		expect(roundNamesOf(de, 'L', 4)).toEqual(['LOSERS_FINAL'])
		expect(roundNamesOf(de, 'GF', 1)).toEqual(['FINAL'])
	})

	it('layers defaults, round numbers, named rounds and exact rounds', () => {
		// A weekly: odd rounds one deck, even rounds another; the final best of 5.
		const t = startedWith('single_elim', 8, {
			R1: { deck: ORANGE_ON_BLACK },
			R2: { deck: BLACK_ON_ORANGE },
			R3: { deck: ORANGE_ON_BLACK, bestOf: 3 },
			FINAL: { bestOf: 5 },
		})
		expect(roundSettingsFor(t, 'W', 1)).toMatchObject({ bestOf: 1, deck: ORANGE_ON_BLACK })
		expect(roundSettingsFor(t, 'W', 2)).toMatchObject({ bestOf: 1, deck: BLACK_ON_ORANGE })
		// 8 players: round 3 is the final. The final only changes the series length.
		expect(roundSettingsFor(t, 'W', 3)).toMatchObject({ bestOf: 5, deck: ORANGE_ON_BLACK })
		// The series length reached the bracket's matches.
		const bestOf = (round: number) => t.bracket!.matches.filter((m) => m.stage === 'W' && m.round === round).map((m) => m.bestOf)
		expect(bestOf(1)).toEqual([1, 1, 1, 1])
		expect(bestOf(3)).toEqual([5])
		// An exact round wins over a named one.
		const exact = startedWith('single_elim', 8, { SEMI: { bestOf: 3 }, W2: { bestOf: 7 } })
		expect(roundSettingsFor(exact, 'W', 2).bestOf).toBe(7)
	})

	it('counts the same rounds with fewer players', () => {
		// Settings for 5 rounds, 5 players: 3 rounds; the named final still lands.
		const t = startedWith('single_elim', 5, { R3: { bestOf: 3 }, R4: { bestOf: 7 }, FINAL: { bestOf: 5 } })
		expect(roundSettingsFor(t, 'W', 3).bestOf).toBe(5)
		expect(roundSettingsFor(t, 'W', 2).bestOf).toBe(1)
	})

	it('refuses unknown round keys', () => {
		const rounds = (overrides: Input) => settings({ rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 }, overrides } })
		expect(createTournament('t1', ORG, rounds({ R12: { bestOf: 3 }, LOSERS_FINAL: { bestOf: 3 } }), 'C', NOW).ok).toBe(true)
		expect(createTournament('t1', ORG, rounds({ FINALS: { bestOf: 3 } }), 'C', NOW).ok).toBe(false)
		expect(createTournament('t1', ORG, rounds({ R: { bestOf: 3 } }), 'C', NOW).ok).toBe(false)
	})
})

describe('while running', () => {
	function running(extra: Input = {}): Tournament {
		return value(start(withPlayers(opened({ checkInMinutes: null, ...extra }), 4), NOW, ratings, seededRng(1)))
	}

	it('only lets the organiser change names and round settings', () => {
		const t = running()
		expect(updateSettings(t, 'org', { maxPlayers: 16 }, NOW).ok).toBe(false)
		expect(updateSettings(t, 'org', { name: 'Renamed Cup' }, NOW).ok).toBe(true)
		expect(updateSettings(t, 'p1', { name: 'Mine now' }, NOW).ok).toBe(false)
	})

	it('applies a new series length to rounds that have not started', () => {
		const t = value(
			updateSettings(
				running(),
				'org',
				{ rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 }, overrides: { W2: { bestOf: 3 } } } },
				NOW,
			),
		)
		expect(t.bracket?.matches.find((m) => m.id === 'W2-1')?.bestOf).toBe(3)
		expect(t.bracket?.matches.find((m) => m.id === 'W1-1')?.bestOf).toBe(1)
	})

	it('treats leaving as a drop: their match is forfeited', () => {
		const t = value(leaveTournament(running(), 'p4', NOW))
		expect(t.dropped).toEqual(['p4'])
		const first = resolveBracket(t.bracket as NonNullable<Tournament['bracket']>, t.dropped).byId['W1-1']
		expect(first.outcome).toMatchObject({ winner: 'p1', reason: 'dropped' })
	})

	it('plays to the end on the clock alone (nobody readies: unplayed -> fallback)', () => {
		let t = running()
		let now = NOW
		for (let i = 0; i < 50 && t.status === 'running'; i++) {
			const wake = t.nextWakeAt
			if (wake === null || wake === undefined) throw new Error('stuck')
			now = wake
			t = advance(t, now, ratings, seededRng(1)) ?? t
		}
		expect(t.status).toBe('finished')
		expect(kinds(t)).toContain('tournament_finished')
		// Higher seed advances every time.
		expect(t.bracket?.seeds[0]).toBe('p4')
		expect(kinds(t).filter((k) => k === 'fallback_applied').length).toBe(3)
	})

	it('can be cancelled by the organiser only, and not once over', () => {
		const t = running()
		expect(cancel(t, 'p1', NOW).ok).toBe(false)
		const c = value(cancel(t, 'org', NOW))
		expect(c.status).toBe('cancelled')
		expect(cancel(c, 'org', NOW).ok).toBe(false)
	})
})
