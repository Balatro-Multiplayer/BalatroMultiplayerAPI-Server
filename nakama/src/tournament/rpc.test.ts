import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from '../config'
import { writeBans } from '../moderation/bans'
import { defaultProfile, writeProfile } from '../player/profile'
import { writeModReport } from '../standing/storage'
import { type FakeNk, fakeLogger, fakeNk, playerCtx, storeLikeNakama } from '../testing/fake_nk'
import { sweep } from './clock'
import { rpcTournamentDevFill, rpcTournamentDevTime } from './dev'
import {
	catchUpTournament,
	rpcTournamentCancel,
	rpcTournamentCoOrganiserCode,
	rpcTournamentCoOrganiserJoin,
	rpcTournamentCoOrganisersSet,
	rpcTournamentCheckIn,
	rpcTournamentCreate,
	rpcTournamentGet,
	rpcTournamentJoin,
	rpcTournamentLeave,
	rpcTournamentList,
	rpcTournamentMine,
	rpcTournamentOpen,
	rpcTournamentPause,
	rpcTournamentResume,
	rpcTournamentStart,
	rpcTournamentUpdate,
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
	// Saved like Nakama saves: a field cleared with undefined comes back null.
	nk = storeLikeNakama(fakeNk({
		uuidv4: () => `cccccccc-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
		matchList: () => clocks.map((id) => ({ matchId: id, authoritative: true, label: 'bmp_tournament_clock', size: 0 })),
		matchCreate: (module: string) => {
			const id = `clock-${clocks.length + 1}`
			clocks.push(id)
			return id
		},
	}))
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
		expect(mine.tournaments[0]).toMatchObject({ role: 'entrant', organiser: false })
		expect(call(rpcTournamentMine, ORG).tournaments[0]).toMatchObject({ role: 'organiser', organiser: true })
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

describe('co-organisers join with a code', () => {
	it('the organiser shares a code; whoever enters it helps run it', () => {
		const id = created().summary.id
		expect(fails(rpcTournamentCoOrganiserCode, P(1), { id }).message).toMatch(/Only the organiser/)
		const code = call(rpcTournamentCoOrganiserCode, ORG, { id }).tournament.coOrganiserCode
		expect(code).toMatch(/^[A-Z2-9]{6}$/)
		const joined = call(rpcTournamentCoOrganiserJoin, P(1), { code: code.toLowerCase() }).tournament
		expect(joined.role).toBe('co_organiser')
		// Only the organiser sees the code.
		expect(joined.coOrganiserCode).toBeUndefined()
		const seen = call(rpcTournamentGet, ORG, { id }).tournament
		expect(seen.coOrganisers.map((c: { id: string }) => c.id)).toEqual([P(1)])
		expect(seen.coOrganisers[0].name).not.toBe('?')
		expect(call(rpcTournamentMine, P(1)).tournaments[0].role).toBe('co_organiser')
		// A new code: the old one no longer works.
		const fresh = call(rpcTournamentCoOrganiserCode, ORG, { id }).tournament.coOrganiserCode
		expect(fresh).not.toBe(code)
		expect(fails(rpcTournamentCoOrganiserJoin, P(2), { code }).message).toMatch(/not valid/)
		call(rpcTournamentCoOrganiserJoin, P(2), { code: fresh })
		// The organiser removes one.
		const after = call(rpcTournamentCoOrganisersSet, ORG, { id, userIds: [P(2)] }).tournament
		expect(after.coOrganisers.map((c: { id: string }) => c.id)).toEqual([P(2)])
		expect(fails(rpcTournamentCoOrganiserJoin, ORG, { code: fresh }).message).toMatch(/already run/)
	})
})

describe('tournaments that need a ranked profile', () => {
	const verify = (userId: string, verified: boolean) =>
		nk.storageWrite([{ collection: 'integrity', key: 'status', userId, value: { verified, expiresAt: null }, permissionRead: 0, permissionWrite: 0 }])

	it('hold players to the ranked rule: join, check-in, and their view says so', () => {
		writeConfig(nk as unknown as nkruntime.Nakama, { ...DEFAULT_CONFIG, tournamentsEnabled: true, integrityEnforced: true })
		const t = created({ requireRanked: true })
		expect(t.summary.requireRanked).toBe(true)
		const id = t.summary.id
		call(rpcTournamentOpen, ORG, { id })
		// Not on the launcher: refused, with what to do.
		expect(fails(rpcTournamentJoin, P(1), { id }).message).toMatch(/ranked profile/)
		verify(P(1), true)
		const joined = call(rpcTournamentJoin, P(1), { id }).tournament
		expect(joined.rankedProfile).toEqual({ ok: true, message: null })
		expect(call(rpcTournamentMine, P(1)).tournaments[0].rankedOk).toBe(true)
		// The verdict lapses: the view and the list say so, and check-in refuses.
		verify(P(1), false)
		const view = call(rpcTournamentGet, P(1), { id }).tournament
		expect(view.rankedProfile.ok).toBe(false)
		expect(view.rankedProfile.message).toMatch(/ranked profile/)
		expect(call(rpcTournamentMine, P(1)).tournaments[0].rankedOk).toBe(false)
		vi.setSystemTime(T0 + 30 * MIN)
		expect(fails(rpcTournamentCheckIn, P(1), { id }).message).toMatch(/ranked profile/)
		verify(P(1), true)
		expect(call(rpcTournamentCheckIn, P(1), { id }).tournament.summary.status).toBe('check_in')
	})

	it('reminds players not on it when check-in opens', () => {
		writeConfig(nk as unknown as nkruntime.Nakama, { ...DEFAULT_CONFIG, tournamentsEnabled: true, integrityEnforced: true })
		const id = created({ requireRanked: true }).summary.id
		call(rpcTournamentOpen, ORG, { id })
		for (const n of [1, 2]) {
			verify(P(n), true)
			call(rpcTournamentJoin, P(n), { id })
		}
		verify(P(2), false)
		vi.setSystemTime(T0 + 30 * MIN)
		sweep(nk as unknown as nkruntime.Nakama, fakeLogger, Date.now(), catchUpTournament)
		const reminded = nk.notifications.filter((n) => n.content && n.content.kind === 'ranked_profile_needed').map((n) => n.userId)
		expect(reminded).toEqual([P(2)])
	})

	it('needs only allowed mods where the server does not enforce the launcher', () => {
		const id = created({ requireRanked: true }).summary.id
		call(rpcTournamentOpen, ORG, { id })
		expect(call(rpcTournamentJoin, P(1), { id }).tournament.rankedProfile.ok).toBe(true)
	})

	it("leaves other tournaments' views as they were", () => {
		const id = created().summary.id
		call(rpcTournamentOpen, ORG, { id })
		expect(call(rpcTournamentJoin, P(1), { id }).tournament.rankedProfile).toBeUndefined()
	})
})

describe('the provisional bracket', () => {
	it('draws a tournament that has not started from its sign-ups, when asked', () => {
		const id = created({ checkInMinutes: null }).summary.id
		call(rpcTournamentOpen, ORG, { id })
		// Nobody yet: the full 8-player bracket, all open spots.
		const empty = call(rpcTournamentGet, P(4), { id, provisional: true }).tournament
		expect(empty.bracket.length).toBe(7)
		expect(empty.bracket[0].players.map((p: { name: string }) => p.name)).toEqual(['Open spot', 'Open spot'])
		for (const n of [1, 2, 3]) call(rpcTournamentJoin, P(n), { id })
		const plain = call(rpcTournamentGet, P(1), { id }).tournament
		expect(plain.bracket).toBeNull()
		const drawn = call(rpcTournamentGet, P(1), { id, provisional: true }).tournament
		expect(drawn.provisional).toBe(true)
		expect(drawn.summary.status).toBe('registration')
		// Still the full size; the three players are the top seeds.
		expect(drawn.bracket.length).toBe(7)
		const seeded = drawn.bracket.filter((m: { round: number }) => m.round === 1).map((m: { players: { name: string }[] }) => m.players[0].name)
		expect(seeded.filter((n: string) => n !== 'Open spot').length).toBe(3)
		expect(drawn.schedule.length).toBeGreaterThan(0)
		expect(drawn.bracket.every((m: { clock: unknown }) => m.clock === null)).toBe(true)
		// Nothing was saved: still not started.
		expect(call(rpcTournamentGet, ORG, { id }).tournament.bracket).toBeNull()
		// The same draw on every refresh.
		expect(JSON.stringify(call(rpcTournamentGet, P(2), { id, provisional: true }).tournament.bracket)).toBe(JSON.stringify(drawn.bracket))
		// Nothing is played in it, even by bots (dev fill).
		call(rpcTournamentDevFill, ORG, { id, count: 4 })
		const bots = call(rpcTournamentGet, P(1), { id, provisional: true }).tournament
		expect(bots.bracket.filter((m: { status: string; outcome: { reason: string } | null }) => m.status === 'done' && m.outcome?.reason !== 'bye').length).toBe(0)
	})
})

describe('pause and resume', () => {
	it('resumes once, moving the open deadlines by the paused time', () => {
		const id = created({ checkInMinutes: null }).summary.id
		call(rpcTournamentOpen, ORG, { id })
		for (const n of [1, 2]) call(rpcTournamentJoin, P(n), { id })
		const started = call(rpcTournamentStart, ORG, { id }).tournament
		const deadline = started.bracket[0].clock.deadline
		expect(deadline).toBeGreaterThan(T0)

		vi.setSystemTime(T0 + 1 * MIN)
		expect(call(rpcTournamentPause, ORG, { id }).tournament.paused).toBe(true)
		vi.setSystemTime(T0 + 3 * MIN)
		const resumed = call(rpcTournamentResume, ORG, { id }).tournament
		expect(resumed.paused).toBe(false)
		expect(resumed.bracket[0].clock.deadline).toBe(deadline + 2 * MIN)
		// Read back from storage: still running, and a second resume is refused.
		const again = call(rpcTournamentGet, ORG, { id }).tournament
		expect(again.paused).toBe(false)
		expect(again.bracket[0].clock.deadline).toBe(deadline + 2 * MIN)
		expect(fails(rpcTournamentResume, ORG, { id }).message).toMatch(/Not paused/)
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
		// Times moved closer instead of the clock running ahead: one clock for clients.
		expect(t.serverNow).toBe(T0)
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

describe('official tournaments', () => {
	function grant(userId: string) {
		writeProfile(nk as unknown as nkruntime.Nakama, userId, { ...defaultProfile(userId), privileges: ['tournament_official'] })
	}

	it('can only be created by players with official rights', () => {
		expect(fails(rpcTournamentCreate, P(1), { ...SETTINGS, official: true }).message).toMatch(/official rights/)
		grant(P(1))
		expect(call(rpcTournamentCreate, P(1), { ...SETTINGS, official: true }).tournament.summary.official).toBe(true)
	})

	it('are flagged and listed first', () => {
		const plain = created({ startsAt: T0 + 30 * MIN }).summary.id
		grant(P(2))
		const official = call(rpcTournamentCreate, P(2), { ...SETTINGS, name: 'BMP Official Cup', official: true }).tournament.summary.id
		call(rpcTournamentOpen, ORG, { id: plain })
		call(rpcTournamentOpen, P(2), { id: official })
		const list = call(rpcTournamentList, P(3)).tournaments
		expect(list.map((t: { id: string }) => t.id)).toEqual([official, plain])
		expect(list.map((t: { official: boolean }) => t.official)).toEqual([true, false])
	})

	it("can't be switched on without the rights", () => {
		const id = created().summary.id
		expect(fails(rpcTournamentUpdate, ORG, { id, official: true }).message).toMatch(/official rights/)
	})
})
