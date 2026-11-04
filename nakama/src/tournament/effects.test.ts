import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from '../config'
import type { RunRecord } from '../lobby/protocol'
import { NotifyCode } from '../notify'
import { writeModReport } from '../standing/storage'
import { type FakeNk, fakeLogger, fakeNk, playerCtx, serverCtx } from '../testing/fake_nk'
import { tournamentGameEnded } from './effects'
import type { TournamentLobbyRef } from './model'
import { rpcTournamentDevFill } from './dev'
import {
	rpcAdminTournamentClose,
	rpcTournamentCreate,
	rpcTournamentGet,
	rpcTournamentJoin,
	rpcTournamentOpen,
	rpcTournamentReady,
	rpcTournamentResultSet,
	rpcTournamentStart,
} from './rpc'

const MIN = 60 * 1000
const T0 = Date.UTC(2026, 10, 7, 12, 0)
const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const P = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
const DEV = { BMP_SERVER_KIND: 'dev' }

type Rpc = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string

let nk: FakeNk
let ids = 0
let lobbies: { id: string; params: { [key: string]: unknown } }[] = []
let alive: Set<string>
let signals: { id: string; data: string }[] = []

function setup() {
	ids = 0
	lobbies = []
	alive = new Set()
	signals = []
	const clocks: string[] = []
	nk = fakeNk({
		uuidv4: () => `cccccccc-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
		matchList: () => clocks.map((id) => ({ matchId: id, authoritative: true, label: 'bmp_tournament_clock', size: 0 })),
		matchCreate: (module: string, params: { [key: string]: unknown }) => {
			const id = `${module}-${clocks.length + lobbies.length + 1}`
			if (module === 'bmp_tournament_clock') clocks.push(id)
			else lobbies.push({ id, params })
			alive.add(id)
			return id
		},
		matchGet: (id: string) => (alive.has(id) ? { matchId: id } : null),
		// admin_close ends the lobby match.
		matchSignal: (id: string, data: string) => {
			signals.push({ id, data })
			if (JSON.parse(data).type === 'admin_close') alive.delete(id)
			return 'ok'
		},
	})
	writeConfig(nk as unknown as nkruntime.Nakama, { ...DEFAULT_CONFIG, tournamentsEnabled: true })
	for (const id of [ORG, P(1), P(2), P(3), P(4)]) writeModReport(nk as unknown as nkruntime.Nakama, id, { mods: [], reportedAt: T0 })
}

const NK = () => nk as unknown as nkruntime.Nakama

function call(rpc: Rpc, userId: string, body: object = {}) {
	return JSON.parse(rpc(playerCtx(userId, DEV), fakeLogger, NK(), JSON.stringify(body)))
}

function sent(code: number, userId?: string) {
	return nk.notifications.filter((n) => n.code === code && (userId === undefined || n.userId === userId))
}

// A running 2-player (or more) tournament, no check-in, bestOf as given.
function startedWith(players: string[], bestOf = 1): string {
	const t = call(rpcTournamentCreate, ORG, {
		name: 'Lobby Cup',
		format: 'single_elim',
		maxPlayers: 8,
		startsAt: T0 + 60 * MIN,
		checkInMinutes: null,
		seeding: { kind: 'random' },
		rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf } },
		timetable: { kind: 'preset', preset: 'live_event', options: { readyUpMinutes: 10 } },
	}).tournament
	const id = t.summary.id
	call(rpcTournamentOpen, ORG, { id })
	for (const p of players) call(rpcTournamentJoin, p, { id })
	call(rpcTournamentStart, ORG, { id })
	return id
}

let runs = 0

// A run stored by that lobby.
function run(lobby: { params: { [key: string]: unknown } }, placements: [string, number][], status: RunRecord['status'] = 'agreed'): RunRecord {
	return {
		runId: `run-${++runs}`,
		code: String(lobby.params.code),
		modId: 'MultiplayerPvP',
		seed: 'S',
		stake: 1,
		options: null,
		startedAt: T0,
		endedAt: T0,
		status,
		placements: placements.map(([playerId, place]) => ({ playerId, place })),
		reports: {},
		players: [],
	}
}

function refOf(lobby: { params: { [key: string]: unknown } }): TournamentLobbyRef {
	return JSON.parse(String(lobby.params.tournament))
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(T0)
	setup()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('a match from ready-up to result', () => {
	it('tells both players to ready up, makes one PvP lobby when both are, and tells them its code', () => {
		const id = startedWith([P(1), P(2)])
		const open1 = sent(NotifyCode.TOURNAMENT_MATCH, P(1))
		expect(open1).toHaveLength(1)
		expect(open1[0].content).toMatchObject({ tournamentId: id, matchId: 'W1-1', kind: 'open', deadline: T0 + 10 * MIN, minutesLeft: 10 })
		expect(open1[0].content.opponent.id).toBe(P(2))

		call(rpcTournamentReady, P(1), { id })
		expect(lobbies).toHaveLength(0)
		const after = call(rpcTournamentReady, P(2), { id }).tournament
		expect(lobbies).toHaveLength(1)
		const params = lobbies[0].params
		expect(params).toMatchObject({ modId: 'MultiplayerPvP', maxPlayers: 2, rankedMode: '', gameMode: '', requiredStanding: 'valid' })
		const seeds = after.entrants.slice().sort((a: { seed: number }, b: { seed: number }) => a.seed - b.seed).map((e: { id: string }) => e.id)
		expect(params.creatorId).toBe(seeds[0])
		expect(String(params.allowedIds).split(',').sort()).toEqual([P(1), P(2)].sort())
		const meta = JSON.parse(String(params.metadata)).tournament
		expect(meta).toMatchObject({ id, matchId: 'W1-1', game: 1, bestOf: 1, gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced' })
		expect(refOf(lobbies[0])).toEqual({ tournamentId: id, matchId: 'W1-1' })

		const code = params.code
		// The ready-up's own answer already shows the lobby to join.
		expect(after.bracket[0].lobby).toEqual({ code, game: 1, status: 'open' })
		for (const p of [P(1), P(2)]) {
			expect(sent(NotifyCode.TOURNAMENT_LOBBY, p).map((n) => n.content)).toEqual([{ tournamentId: id, name: 'Lobby Cup', matchId: 'W1-1', code, game: 1, wins: [0, 0], reused: false }])
		}

		// Asking again (or the clock sweeping) doesn't make a second lobby.
		call(rpcTournamentGet, P(1), { id })
		expect(lobbies).toHaveLength(1)
	})

	it('records the lobby\'s result, finishes the tournament and closes the lobby', () => {
		const id = startedWith([P(1), P(2)])
		call(rpcTournamentReady, P(1), { id })
		call(rpcTournamentReady, P(2), { id })
		tournamentGameEnded(NK(), fakeLogger, refOf(lobbies[0]), run(lobbies[0], [[P(1), 1], [P(2), 2]]))
		// Not from inside the lobby's own handler: the next clock sweep or RPC closes it.
		expect(signals).toEqual([])
		const t = call(rpcTournamentGet, P(1), { id }).tournament
		expect(t.summary.status).toBe('finished')
		expect(t.placements[0].id).toBe(P(1))
		expect(signals).toEqual([{ id: lobbies[0].id, data: JSON.stringify({ type: 'admin_close' }) }])
		expect(t.bracket[0].lobby).toBe(null)
		expect(sent(NotifyCode.TOURNAMENT_UPDATED, P(2)).map((n) => n.content.kind)).toEqual(expect.arrayContaining(['game_recorded', 'tournament_finished', 'lobby_closed']))
		// Closed once.
		call(rpcTournamentGet, P(1), { id })
		expect(signals).toHaveLength(1)
	})

	it('plays a whole Bo3 in the one lobby, then closes it', () => {
		const id = startedWith([P(1), P(2)], 3)
		call(rpcTournamentReady, P(1), { id })
		call(rpcTournamentReady, P(2), { id })
		tournamentGameEnded(NK(), fakeLogger, refOf(lobbies[0]), run(lobbies[0], [[P(1), 2], [P(2), 1]]))
		expect(sent(NotifyCode.TOURNAMENT_MATCH, P(1)).map((n) => n.content.kind)).toEqual(['open', 'series'])
		call(rpcTournamentReady, P(1), { id })
		call(rpcTournamentReady, P(2), { id })
		// Same lobby, told again with the series score.
		expect(lobbies).toHaveLength(1)
		const told = sent(NotifyCode.TOURNAMENT_LOBBY, P(1)).map((n) => n.content)
		expect(told).toHaveLength(2)
		expect(told[1]).toMatchObject({ code: lobbies[0].params.code, game: 2, reused: true })
		expect(told[1].wins.slice().sort()).toEqual([0, 1])
		expect(signals).toEqual([])
		tournamentGameEnded(NK(), fakeLogger, refOf(lobbies[0]), run(lobbies[0], [[P(1), 2], [P(2), 1]]))
		const t = call(rpcTournamentGet, P(1), { id }).tournament
		expect(t.summary.status).toBe('finished')
		expect(signals).toHaveLength(1)
	})

	it('sends a game whose lobby vanished back to ready-up after a minute', () => {
		const id = startedWith([P(1), P(2)])
		call(rpcTournamentReady, P(1), { id })
		call(rpcTournamentReady, P(2), { id })
		alive.delete(lobbies[0].id)
		vi.setSystemTime(T0 + 30 * 1000)
		expect(call(rpcTournamentGet, P(1), { id }).tournament.bracket[0].clock.phase).toBe('in_game')
		vi.setSystemTime(T0 + 61 * 1000)
		const t = call(rpcTournamentGet, P(1), { id }).tournament
		expect(t.bracket[0].clock.phase).toBe('ready_up')
		expect(t.events.map((e: { kind: string }) => e.kind)).toContain('lobby_lost')
	})

	it('flags a disputed game to the organisers, who settle it', () => {
		const id = startedWith([P(1), P(2)])
		call(rpcTournamentReady, P(1), { id })
		call(rpcTournamentReady, P(2), { id })
		tournamentGameEnded(NK(), fakeLogger, refOf(lobbies[0]), run(lobbies[0], [[P(1), 1], [P(2), 1]], 'disputed'))
		expect(sent(NotifyCode.TOURNAMENT_UPDATED, ORG).map((n) => n.content.kind)).toContain('result_disputed')
		const t = call(rpcTournamentResultSet, ORG, { id, matchId: 'W1-1', scope: 'game', winner: P(2) }).tournament
		expect(t.summary.status).toBe('finished')
		expect(t.placements[0].id).toBe(P(2))
	})
})

describe('bots and moderators', () => {
	it('never notifies or seats bots; a human beats a bot by readying', () => {
		const t = call(rpcTournamentCreate, ORG, {
			name: 'Bot Cup',
			format: 'single_elim',
			maxPlayers: 2,
			startsAt: T0 + 60 * MIN,
			checkInMinutes: null,
			rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 } },
			timetable: { kind: 'preset', preset: 'live_event', options: {} },
		}).tournament
		const id = t.summary.id
		call(rpcTournamentOpen, ORG, { id })
		call(rpcTournamentJoin, P(1), { id })
		call(rpcTournamentDevFill, ORG, { id, count: 1 })
		call(rpcTournamentStart, ORG, { id })
		expect(nk.notifications.every((n) => !n.userId.startsWith('dev-bot-'))).toBe(true)
		const done = call(rpcTournamentReady, P(1), { id }).tournament
		expect(lobbies).toHaveLength(0)
		expect(done.summary.status).toBe('finished')
		expect(done.placements[0].id).toBe(P(1))
	})

	it('lets only the server close a tournament', () => {
		const id = startedWith([P(1), P(2)])
		expect(() => rpcAdminTournamentClose(playerCtx(ORG, DEV), fakeLogger, NK(), JSON.stringify({ id, reason: 'x' }))).toThrow()
		const out = JSON.parse(rpcAdminTournamentClose(serverCtx(DEV), fakeLogger, NK(), JSON.stringify({ id, reason: 'Rule break' })))
		expect(out).toEqual({ id, status: 'cancelled' })
		expect(sent(NotifyCode.TOURNAMENT_UPDATED, P(1)).map((n) => n.content.kind)).toContain('cancelled')
	})
})
