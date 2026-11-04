import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from '../config'
import { writeBans } from '../moderation/bans'
import { writeModReport } from '../standing/storage'
import { type FakeNk, fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { sweep } from './clock'
import { rpcTournamentDevFill, rpcTournamentDevTime } from './dev'
import {
	catchUpTournament,
	rpcTournamentCancel,
	rpcTournamentCheckIn,
	rpcTournamentCreate,
	rpcTournamentGet,
	rpcTournamentJoin,
	rpcTournamentLeave,
	rpcTournamentList,
	rpcTournamentMine,
	rpcTournamentOpen,
	rpcTournamentStart,
} from './rpc'
import { TOURNAMENT_DUE, TOURNAMENT_MINE } from './storage'

const MIN = 60 * 1000
const T0 = Date.UTC(2026, 10, 7, 12, 0)
const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const P = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
const DEV = { BMP_SERVER_KIND: 'dev' }
const OFFICIAL = { BMP_SERVER_KIND: 'official' }

type Rpc = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string

let nk: FakeNk
let ids = 0
let clocks: string[] = []

function setup(enabled = true) {
	ids = 0
	clocks = []
	nk = fakeNk({
		uuidv4: () => `cccccccc-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
		matchList: () => clocks.map((id) => ({ matchId: id, authoritative: true, label: 'bmp_tournament_clock', size: 0 })),
		matchCreate: (module: string) => {
			const id = `clock-${clocks.length + 1}`
			clocks.push(id)
			return id
		},
	})
	writeConfig(nk as unknown as nkruntime.Nakama, { ...DEFAULT_CONFIG, tournamentsEnabled: enabled })
	for (const id of [ORG, P(1), P(2), P(3), P(4)]) writeModReport(nk as unknown as nkruntime.Nakama, id, { mods: [], reportedAt: T0 })
}

function call(rpc: Rpc, userId: string, body: object = {}, env = DEV) {
	return JSON.parse(rpc(playerCtx(userId, env), fakeLogger, nk as unknown as nkruntime.Nakama, JSON.stringify(body)))
}

function fails(rpc: Rpc, userId: string, body: object = {}, env = DEV): { code: number; message: string } {
	try {
		rpc(playerCtx(userId, env), fakeLogger, nk as unknown as nkruntime.Nakama, JSON.stringify(body))
	} catch (e) {
		return e as { code: number; message: string }
	}
	throw new Error('expected the RPC to refuse')
}

const SETTINGS = {
	name: 'Saturday Showdown',
	format: 'single_elim',
	maxPlayers: 8,
	startsAt: T0 + 60 * MIN,
	checkInMinutes: 30,
	rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 } },
	timetable: { kind: 'preset', preset: 'live_event', options: {} },
}

function created(extra: object = {}) {
	return call(rpcTournamentCreate, ORG, { ...SETTINGS, ...extra }).tournament
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(T0)
	setup()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('the tournamentsEnabled switch', () => {
	it('refuses every tournament RPC while off (the default)', () => {
		setup(false)
		expect(fails(rpcTournamentCreate, ORG, SETTINGS).message).toMatch(/not enabled/)
		expect(fails(rpcTournamentList, P(1)).message).toMatch(/not enabled/)
	})

	it('keeps the clock idle while off', () => {
		const t = created()
		call(rpcTournamentOpen, ORG, { id: t.summary.id })
		writeConfig(nk as unknown as nkruntime.Nakama, { ...DEFAULT_CONFIG, tournamentsEnabled: false })
		expect(sweep(nk as unknown as nkruntime.Nakama, fakeLogger, T0 + 120 * MIN, catchUpTournament)).toBe(0)
	})
})

describe('a tournament from creation to start', () => {
	it('creates a draft only its organisers can see, then lists it once open', () => {
		const t = created()
		expect(t.summary.status).toBe('draft')
		expect(t.role).toBe('organiser')
		expect(t.inviteCode).toMatch(/^[A-Z2-9]{6}$/)
		expect(fails(rpcTournamentGet, P(1), { id: t.summary.id }).code).toBe(5)
		expect(call(rpcTournamentList, P(1)).tournaments).toEqual([])
		call(rpcTournamentOpen, ORG, { id: t.summary.id })
		const list = call(rpcTournamentList, P(1))
		expect(list.serverNow).toBe(T0)
		expect(list.tournaments.map((x: { id: string }) => x.id)).toEqual([t.summary.id])
		expect(list.tournaments[0]).toMatchObject({ players: 0, maxPlayers: 8, format: 'single_elim', gameMode: 'pvp_nemesis', startsAt: T0 + 60 * MIN })
		expect(clocks.length).toBe(1)
	})

	it('joins, shows up in "mine", checks in at the right time and starts', () => {
		const id = created().summary.id
		call(rpcTournamentOpen, ORG, { id })
		for (const n of [1, 2, 3]) expect(call(rpcTournamentJoin, P(n), { id }).tournament.role).toBe('entrant')
		const mine = call(rpcTournamentMine, P(1))
		expect(mine.tournaments.map((x: { id: string }) => x.id)).toEqual([id])
		expect(fails(rpcTournamentCheckIn, P(1), { id }).message).toMatch(/Check-in is not open/)

		vi.setSystemTime(T0 + 30 * MIN)
		expect(call(rpcTournamentCheckIn, P(1), { id }).tournament.summary.status).toBe('check_in')
		call(rpcTournamentCheckIn, P(2), { id })

		// The clock starts it at the start time; P(3) never checked in.
		vi.setSystemTime(T0 + 60 * MIN)
		expect(sweep(nk as unknown as nkruntime.Nakama, fakeLogger, Date.now(), catchUpTournament)).toBe(1)
		const t = call(rpcTournamentGet, P(1), { id }).tournament
		expect(t.summary.status).toBe('running')
		expect(t.entrants.map((e: { id: string }) => e.id).sort()).toEqual([P(1), P(2)].sort())
		expect(t.bracket[0]).toMatchObject({ id: 'W1-1', status: 'ready', clock: { phase: 'ready_up' } })
		expect(t.you.nextMatchId).toBe('W1-1')
		// P(3) is still told about it in their list (as removed).
		expect(call(rpcTournamentMine, P(3)).tournaments).toEqual([])
	})

	it('keeps private tournaments out of the list; the invite code finds and joins them', () => {
		const t = created({ visibility: 'private' })
		const id = t.summary.id
		call(rpcTournamentOpen, ORG, { id })
		expect(call(rpcTournamentList, P(1)).tournaments).toEqual([])
		expect(fails(rpcTournamentJoin, P(1), { id }).code).toBe(5)
		expect(call(rpcTournamentGet, P(1), { code: t.inviteCode.toLowerCase() }).tournament.summary.id).toBe(id)
		expect(call(rpcTournamentJoin, P(1), { code: t.inviteCode }).tournament.role).toBe('entrant')
		expect(call(rpcTournamentGet, P(1), { id }).tournament.inviteCode).toBeUndefined()
	})

	it('lets the organiser start early and cancel; leaving after the start is a drop', () => {
		const id = created({ checkInMinutes: null }).summary.id
		call(rpcTournamentOpen, ORG, { id })
		for (const n of [1, 2, 3, 4]) call(rpcTournamentJoin, P(n), { id })
		expect(fails(rpcTournamentStart, P(1), { id }).code).toBe(7)
		expect(call(rpcTournamentStart, ORG, { id }).tournament.summary.status).toBe('running')
		const left = call(rpcTournamentLeave, P(1), { id }).tournament
		expect(left.entrants.find((e: { id: string }) => e.id === P(1)).dropped).toBe(true)
		expect(call(rpcTournamentCancel, ORG, { id }).tournament.summary.status).toBe('cancelled')
		// Done: nothing left for the clock.
		expect(nk.objects.has(`${TOURNAMENT_DUE}/00000000-0000-0000-0000-000000000000/${id}`)).toBe(false)
	})

	it('keeps each player list in step with joins and leaves', () => {
		const id = created().summary.id
		call(rpcTournamentOpen, ORG, { id })
		call(rpcTournamentJoin, P(1), { id })
		expect(nk.objects.get(`${TOURNAMENT_MINE}/${P(1)}/list`)?.value).toEqual({ ids: [id] })
		call(rpcTournamentLeave, P(1), { id })
		expect(nk.objects.get(`${TOURNAMENT_MINE}/${P(1)}/list`)?.value).toEqual({ ids: [] })
		expect(nk.objects.get(`${TOURNAMENT_MINE}/${ORG}/list`)?.value).toEqual({ ids: [id] })
	})

	it('refuses players banned from matchmaking', () => {
		const id = created().summary.id
		call(rpcTournamentOpen, ORG, { id })
		writeBans(nk as unknown as nkruntime.Nakama, P(4), { queue: { banId: 'b1', expiresAt: null, reason: 'test' } })
		const refused = fails(rpcTournamentJoin, P(4), { id })
		expect(refused.code).toBe(7)
		expect(refused.message).toMatch(/banned from matchmaking/)
	})
})

describe('dev helpers', () => {
	it('are refused outside a Dev server', () => {
		const id = created().summary.id
		expect(fails(rpcTournamentDevFill, ORG, { id, count: 4 }, OFFICIAL).message).toMatch(/Testing RPCs/)
		expect(fails(rpcTournamentDevTime, ORG, { id, minutes: 5 }, OFFICIAL).message).toMatch(/Testing RPCs/)
	})

	it('fill a tournament with checked-in bots and skip its clock ahead', () => {
		const id = created({ maxPlayers: 16 }).summary.id
		call(rpcTournamentOpen, ORG, { id })
		call(rpcTournamentJoin, P(1), { id })
		const filled = call(rpcTournamentDevFill, ORG, { id, count: 20 }).tournament
		expect(filled.summary.players).toBe(16)
		// 30 minutes ahead opens check-in; 30 more reach the start.
		expect(call(rpcTournamentDevTime, ORG, { id, minutes: 30 }).tournament.summary.status).toBe('check_in')
		const t = call(rpcTournamentDevTime, ORG, { id, minutes: 30 }).tournament
		// P(1) never checked in; the bots did -- and bots ready up and play
		// by themselves, so an all-bot tournament plays out at once.
		expect(t.entrants.length).toBe(15)
		expect(t.summary.status).toBe('finished')
		expect(t.placements.length).toBe(15)
		expect(t.serverNow).toBe(T0 + 60 * MIN)
	})

	it('starts with everyone when the whole check-in window was skipped (e.g. server down)', () => {
		const id = created({ maxPlayers: 4 }).summary.id
		call(rpcTournamentOpen, ORG, { id })
		call(rpcTournamentJoin, P(1), { id })
		call(rpcTournamentDevFill, ORG, { id, count: 3 })
		const t = call(rpcTournamentDevTime, ORG, { id, minutes: 60 }).tournament
		expect(t.summary.status).toBe('running')
		expect(t.entrants.length).toBe(4)
	})
})
