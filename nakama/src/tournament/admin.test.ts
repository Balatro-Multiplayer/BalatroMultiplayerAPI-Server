import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from '../config'
import { writeModReport } from '../standing/storage'
import { type FakeNk, fakeLogger, fakeNk, playerCtx, serverCtx } from '../testing/fake_nk'
import { rpcAdminTournamentGet, rpcAdminTournamentList, rpcAdminTournamentSettings } from './admin'
import { rpcAdminTournamentClose, rpcTournamentCreate, rpcTournamentJoin, rpcTournamentNoticeSet, rpcTournamentOpen } from './rpc'

const MIN = 60 * 1000
const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const DEV = { BMP_SERVER_KIND: 'dev' }

type Rpc = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string

let nk: FakeNk
let ids = 0
const NK = () => nk as unknown as nkruntime.Nakama

beforeEach(() => {
	ids = 0
	nk = fakeNk({ uuidv4: () => `cccccccc-0000-4000-8000-${String(++ids).padStart(12, '0')}` })
	writeConfig(NK(), { ...DEFAULT_CONFIG, tournamentsEnabled: true, tournamentCreationRestricted: false })
	for (const id of [ORG, P1]) writeModReport(NK(), id, { mods: [], reportedAt: Date.now() })
})

function call(rpc: Rpc, userId: string, body: object = {}) {
	return JSON.parse(rpc(playerCtx(userId, DEV), fakeLogger, NK(), JSON.stringify(body)))
}

function admin(rpc: Rpc, body: object = {}) {
	return JSON.parse(rpc(serverCtx(DEV), fakeLogger, NK(), JSON.stringify(body)))
}

function create(name: string, visibility: 'public' | 'private', open = true): { id: string; inviteCode: string } {
	const t = call(rpcTournamentCreate, ORG, {
		name,
		description: 'Bring snacks',
		visibility,
		format: 'single_elim',
		maxPlayers: 8,
		startsAt: Date.now() + 60 * MIN,
		checkInMinutes: null,
		seeding: { kind: 'random' },
		rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 } },
		timetable: { kind: 'preset', preset: 'live_event', options: { readyUpMinutes: 10 } },
	}).tournament
	if (open) call(rpcTournamentOpen, ORG, { id: t.summary.id })
	return { id: t.summary.id, inviteCode: t.inviteCode }
}

describe('admin_tournament_list', () => {
	it('is for the server only', () => {
		expect(() => call(rpcAdminTournamentList, ORG)).toThrow()
	})

	it('lists private tournaments and drafts too, and ended ones on request', () => {
		const pub = create('Public Cup', 'public')
		const priv = create('Secret Cup', 'private')
		const draft = create('Draft Cup', 'public', false)
		const closed = create('Closed Cup', 'public')
		admin(rpcAdminTournamentClose, { id: closed.id, reason: 'Spam' })

		const active = admin(rpcAdminTournamentList).tournaments.map((t: { id: string }) => t.id)
		expect(active.sort()).toEqual([pub.id, priv.id, draft.id].sort())
		expect(admin(rpcAdminTournamentList, { status: 'over' }).tournaments.map((t: { id: string }) => t.id)).toEqual([closed.id])
		const all = admin(rpcAdminTournamentList, { status: 'all' }).tournaments
		expect(all).toHaveLength(4)
		expect(all[3].id).toBe(closed.id)
		expect(all[0].organiserId).toBe(ORG)
	})

	it('searches names, organisers and invite codes', () => {
		const a = create('Spring Open', 'public')
		const b = create('Winter Cup', 'private')
		const find = (search: string) => admin(rpcAdminTournamentList, { search }).tournaments.map((t: { id: string }) => t.id)
		expect(find('spring')).toEqual([a.id])
		expect(find(b.inviteCode.toLowerCase())).toEqual([b.id])
		expect(find('nothing like this')).toEqual([])
	})

	it('refuses an unknown status', () => {
		expect(() => admin(rpcAdminTournamentList, { status: 'soon' })).toThrow()
	})
})

describe('admin_tournament_get', () => {
	it('shows the texts players see and who takes part', () => {
		const t = create('Spring Open', 'public')
		call(rpcTournamentNoticeSet, ORG, { id: t.id, text: 'Round 1 at 8' })
		call(rpcTournamentJoin, P1, { id: t.id })
		const got = admin(rpcAdminTournamentGet, { id: t.id }).tournament
		expect(got).toMatchObject({ name: 'Spring Open', description: 'Bring snacks', notice: 'Round 1 at 8', status: 'registration', inviteCode: t.inviteCode, closed: null })
		expect(got.organiser.id).toBe(ORG)
		expect(got.entrants.map((e: { id: string }) => e.id)).toEqual([P1])
	})

	it('gives the moderator reason once closed', () => {
		const t = create('Spring Open', 'public')
		admin(rpcAdminTournamentClose, { id: t.id, reason: 'Abusive name' })
		const got = admin(rpcAdminTournamentGet, { id: t.id }).tournament
		expect(got.status).toBe('cancelled')
		expect(got.closed).toMatchObject({ reason: 'moderator', message: 'Abusive name' })
	})

	it('is for the server only, and knows unknown ids', () => {
		const t = create('Spring Open', 'public')
		expect(() => call(rpcAdminTournamentGet, ORG, { id: t.id })).toThrow()
		expect(() => admin(rpcAdminTournamentGet, { id: 'dddddddd-0000-4000-8000-000000000009' })).toThrow('No such tournament')
	})
})

describe('admin_tournament_settings', () => {
	it('says whether creation is restricted', () => {
		expect(admin(rpcAdminTournamentSettings)).toEqual({ creationRestricted: false })
		writeConfig(NK(), { ...DEFAULT_CONFIG, tournamentsEnabled: true })
		expect(admin(rpcAdminTournamentSettings)).toEqual({ creationRestricted: true })
	})

	it('is for the server only', () => {
		expect(() => call(rpcAdminTournamentSettings, ORG)).toThrow()
	})
})
