import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from '../config'
import { writeModReport } from '../standing/storage'
import { type FakeNk, fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { rpcTournamentCheckIn, rpcTournamentCreate, rpcTournamentGet, rpcTournamentJoin, rpcTournamentOpen, rpcTournamentResultSet, rpcTournamentStart } from './rpc'

// A round that continues at a set time with its own check-in: the limits on
// that time, and checking in through tournament_check_in while running.

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN
const T0 = Date.UTC(2026, 10, 7, 12, 0)
const START = T0 + 60 * MIN
const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const P = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
const DEV = { BMP_SERVER_KIND: 'dev' }

type Rpc = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string

let nk: FakeNk
let ids = 0
const NK = () => nk as unknown as nkruntime.Nakama

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(T0)
	ids = 0
	nk = fakeNk({
		uuidv4: () => `cccccccc-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
		matchList: () => [],
		matchCreate: (module: string) => `${module}-${++ids}`,
		matchGet: () => null,
		matchSignal: () => 'ok',
	})
	writeConfig(NK(), { ...DEFAULT_CONFIG, tournamentsEnabled: true })
	for (const id of [ORG, P(1), P(2), P(3), P(4)]) writeModReport(NK(), id, { mods: [], reportedAt: T0 })
})

afterEach(() => {
	vi.useRealTimers()
})

function call(rpc: Rpc, userId: string, body: object = {}) {
	return JSON.parse(rpc(playerCtx(userId, DEV), fakeLogger, NK(), JSON.stringify(body)))
}

function fails(rpc: Rpc, userId: string, body: object): string {
	try {
		call(rpc, userId, body)
	} catch (e) {
		return (e as { message: string }).message
	}
	throw new Error('expected a failure')
}

function settings(rounds: object, maxPlayers = 4) {
	return {
		name: 'Final Next Day',
		format: 'single_elim',
		maxPlayers,
		startsAt: START,
		checkInMinutes: null,
		seeding: { kind: 'random' },
		rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 } },
		timetable: { kind: 'preset', preset: 'live_event', options: { readyUpMinutes: 10 }, rounds },
	}
}

describe('limits on a round set to a date and time', () => {
	it('refuses one before the tournament starts', () => {
		expect(fails(rpcTournamentCreate, ORG, settings({ FINAL: { startAt: START - 30 * MIN } }))).toMatch(/after the tournament starts/)
	})

	it("refuses a check-in that opens before the tournament starts", () => {
		expect(fails(rpcTournamentCreate, ORG, settings({ FINAL: { startAt: START + 30 * MIN, checkInMinutes: 45 } }))).toMatch(/check-in can't open before/)
		expect(call(rpcTournamentCreate, ORG, settings({ FINAL: { startAt: START + 30 * MIN, checkInMinutes: 30 } })).tournament).toBeTruthy()
	})

	it('refuses timed rounds out of order', () => {
		expect(fails(rpcTournamentCreate, ORG, settings({ SEMI: { startAt: START + 2 * DAY }, FINAL: { startAt: START + DAY } }, 8))).toMatch(/round order/)
		expect(call(rpcTournamentCreate, ORG, settings({ SEMI: { startAt: START + DAY }, FINAL: { startAt: START + 2 * DAY } }, 8)).tournament).toBeTruthy()
	})

	it('refuses a check-in on a round without a set time', () => {
		expect(fails(rpcTournamentCreate, ORG, settings({ FINAL: { breakBefore: 10, checkInMinutes: 30 } }))).toMatch(/needs startAt/)
	})
})

describe('checking in for a round while running', () => {
	function running(): { id: string; semis: { id: string; winner: string; loser: string }[] } {
		const id = call(rpcTournamentCreate, ORG, settings({ FINAL: { startAt: START + DAY, checkInMinutes: 30 } })).tournament.summary.id
		call(rpcTournamentOpen, ORG, { id })
		for (let n = 1; n <= 4; n++) call(rpcTournamentJoin, P(n), { id })
		const view = call(rpcTournamentStart, ORG, { id }).tournament
		const semis = view.bracket
			.filter((m: { round: number }) => m.round === 1)
			.map((m: { id: string; players: { id: string }[] }) => ({ id: m.id, winner: m.players[0].id, loser: m.players[1].id }))
		for (const s of semis) call(rpcTournamentResultSet, ORG, { id, matchId: s.id, scope: 'match', winner: s.winner })
		return { id, semis }
	}

	it('tells the players still in, lets them check in, and forfeits who did not', () => {
		const { id, semis } = running()
		const [a, b] = [semis[0].winner, semis[1].winner]
		const before = call(rpcTournamentGet, a, { id }).tournament.you.roundCheckIn
		expect(before).toMatchObject({ open: false, checkedIn: false, startsAt: START + DAY, opensAt: START + DAY - 30 * MIN, firstRound: 2 })
		expect(fails(rpcTournamentCheckIn, a, { id })).toMatch(/not open/)

		vi.setSystemTime(START + DAY - 20 * MIN)
		nk.notifications.length = 0
		call(rpcTournamentGet, ORG, { id })
		const told = nk.notifications.filter((n) => n.content.kind === 'round_check_in').map((n) => n.userId)
		expect(told.sort()).toEqual([a, b].sort())
		expect(fails(rpcTournamentCheckIn, semis[0].loser, { id })).toMatch(/no longer in/)

		const after = call(rpcTournamentCheckIn, a, { id }).tournament
		expect(after.you.roundCheckIn).toMatchObject({ open: true, checkedIn: true })

		vi.setSystemTime(START + DAY)
		const done = call(rpcTournamentGet, a, { id }).tournament
		expect(done.summary.status).toBe('finished')
		expect(done.placements[0].id).toBe(a)
		expect(done.events.map((e: { kind: string }) => e.kind)).toContain('check_in_missed')
	})
})
