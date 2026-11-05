import { describe, expect, it, vi } from 'vitest'
import { drainMirror, MIRROR_PAGE } from '../../features/nakama/mirror.job.js'
import {
	type MirrorPull,
	type PulledChat,
	type PulledRun,
	chatRowsOf,
	createMirrorService,
	rankedGameModeOf,
	runRowsOf,
} from '../../features/nakama/mirror.service.js'
import { DELETED_PLAYER_ID } from '../../shared/deleted-player.js'
import { decompressFromBase64 } from '../../shared/utils/compression.js'
import { err, ok } from '../../shared/utils/result.js'

const T0 = 1_790_000_000_000
const DAY = 24 * 60 * 60 * 1000

function run(over: Partial<PulledRun['run']> = {}): PulledRun {
	return {
		key: 'k-run',
		kind: 'run',
		at: T0 + 60_000,
		run: {
			runId: '11111111-1111-4111-8111-111111111111',
			code: 'ABCDE',
			modId: 'M',
			startedAt: T0,
			endedAt: T0 + 60_000,
			status: 'agreed',
			placements: [
				{ playerId: 'na', place: 1 },
				{ playerId: 'nb', place: 2 },
			],
			reports: {},
			players: [
				{ id: 'na', displayName: 'Ay' },
				{ id: 'nb', displayName: 'Bee' },
			],
			rankedMode: 'duel',
			gameMode: 'ranked:duel',
			lobbyType: 'public',
			logChecks: { na: 'match', nb: 'mismatch' },
			...over,
		},
		logs: {
			na: { events: [[1, 'x', null]], eventCount: 1, truncated: false, carbonHash: 'h', check: 'match' },
		},
		rating: { modId: 'M', mode: 'duel', season: 2 },
		ratings: {
			na: { rating: 615.6, wins: 1, losses: 0, gamesPlayed: 1, seasonBest: null, lastMatchAt: T0 + 60_000 },
		},
	}
}

const ids = new Map([
	['na', 'pg-a'],
	['nb', 'pg-b'],
])

describe('runRowsOf', () => {
	it('builds the compressed events from the exact lines', () => {
		const entry = run()
		// Key order and number text that a parse and stringify would change.
		const lines = ['[1,"x",{"b":1,"a":1.0}]', '[2,"y",null]']
		entry.logs.na = { lines, eventCount: 2, truncated: false, carbonHash: 'h', check: 'match' } as never
		const [a] = runRowsOf(entry, ids).logs
		expect(decompressFromBase64(a.compressedEvents)).toBe(`[${lines.join(',')}]`)
	})

	it('maps a ranked run onto its run, logs, match and ratings', () => {
		const rows = runRowsOf(run(), ids)
		expect(rows.lobbyRun).toMatchObject({
			lobbyCode: 'ABCDE',
			lobbyType: 'public',
			status: 'completed',
			matchmakingMatchId: rows.lobbyRun.id,
		})
		const [a, b] = rows.logs
		expect(a).toMatchObject({ playerId: 'pg-a', status: 'complete', flagReason: null, carbonHash: 'h', eventCount: 1 })
		expect(a.expiresAt).toEqual(new Date(T0 + 60_000 + 180 * DAY))
		expect(JSON.parse(decompressFromBase64(a.compressedEvents))).toEqual([[1, 'x', null]])
		// b's log never arrived but its check failed: flagged. The sweep keeps it
		// past expiresAt while its report or ban is open.
		expect(b).toMatchObject({ playerId: 'pg-b', flagReason: 'hash_mismatch', eventCount: 0 })
		expect(b.expiresAt).toEqual(new Date(T0 + 60_000 + 180 * DAY))
		expect(rows.flagged).toEqual([{ playerId: 'pg-b', reason: 'hash_mismatch' }])
		expect(rows.match).toMatchObject({
			gameMode: 'ranked:duel',
			players: ['pg-a', 'pg-b'],
			lobbyState: { playerInfos: { 'pg-a': { displayName: 'Ay' } } },
			resultPlacements: [
				{ playerId: 'pg-a', place: 1 },
				{ playerId: 'pg-b', place: 2 },
			],
			status: 'resolved',
		})
		expect(rows.ratings).toEqual([
			expect.objectContaining({ playerId: 'pg-a', gameMode: 'ranked:duel', season: 2, rating: 616, gamesPlayed: 1 }),
		])
	})

	it('maps a PvP season best onto the score columns, past 1e15 too', () => {
		const entry = run()
		const pvp = {
			...entry,
			rating: { modId: 'MultiplayerPvP', mode: 'duel', season: 2 },
			ratings: { na: { ...entry.ratings.na, seasonBest: '20.17609125905568,3' } },
		}
		expect(runRowsOf(pvp, ids).ratings[0]).toMatchObject({
			seasonBest: null,
			seasonBestLen: 2,
			seasonBestRev: [3, 20.17609125905568],
			seasonBestText: '20.17609125905568,3',
		})
	})

	it('maps a private, abandoned or restarted run without a match or ratings', () => {
		const entry = { ...run({ gameMode: undefined, rankedMode: undefined, lobbyType: undefined, status: 'abandoned', logChecks: {} }), rating: null }
		const rows = runRowsOf(entry, ids)
		expect(rows.lobbyRun).toMatchObject({ lobbyType: 'private', status: 'abandoned', matchmakingMatchId: null })
		expect(rows.match).toBeNull()
		expect(rows.ratings).toEqual([])
		expect(rows.logs.map((l) => l.status)).toEqual(['complete', 'partial'])
		expect(runRowsOf({ ...entry, run: { ...entry.run, status: 'restarted' } }, ids).lobbyRun.status).toBe('terminated')
	})
})

describe('runRowsOf: flags and disputes', () => {
	it("gives a disputed run's logs the evidence limit, 180 days from the end", () => {
		const rows = runRowsOf(run({ status: 'disputed' }), ids)
		const limit = new Date(T0 + 60_000 + 180 * DAY)
		expect(rows.logs.map((l) => l.expiresAt)).toEqual([limit, limit])
	})

	it('marks which players Nakama rated, so a void replays the same games', () => {
		const rated = runRowsOf(run({ ratings: { na: {}, nb: {} } }), ids)
		expect(rated.match?.resultPlacements).toEqual([
			{ playerId: 'pg-a', place: 1, rated: true },
			{ playerId: 'pg-b', place: 2, rated: true },
		])
		// Disputed (nobody rated) and a flagged player (left out).
		expect(runRowsOf(run({ status: 'disputed', ratings: {} }), ids).match?.resultPlacements.map((p) => p.rated)).toEqual([false, false])
		// A flagged agreed run is rated by the live code and by the Season replay,
		// so a late pull of one stored before that keeps it rated.
		expect(runRowsOf(run({ flags: { na: 'hash_mismatch' }, ratings: {} }), ids).match?.resultPlacements.map((p) => p.rated)).toEqual([true, true])
		expect(runRowsOf(run({ status: 'disputed', flags: { na: 'hash_mismatch' }, ratings: {} }), ids).match?.resultPlacements.map((p) => p.rated)).toEqual([false, false])
		expect(runRowsOf(run({ placements: [{ playerId: 'na', place: 1 }], flags: { na: 'hash_mismatch' }, ratings: {} }), ids).match?.resultPlacements.map((p) => p.rated)).toEqual([false])
		// A casual run, or a record from before ratings were stored: no marker.
		expect(runRowsOf(run({ rankedMode: undefined, gameMode: 'duel', ratings: {} }), ids).match?.resultPlacements[0]).not.toHaveProperty('rated')
		expect(runRowsOf(run(), ids).match?.resultPlacements[0]).not.toHaveProperty('rated')
	})

	it('makes no anti-cheat item when every player of the match is flagged, and one when a single player is', () => {
		const both = runRowsOf(run({ flags: { na: 'hash_mismatch', nb: 'hash_mismatch' } }), ids)
		expect(both.flagged).toHaveLength(2)
		expect(both.raiseAntiCheatItems).toBe(false)
		const one = runRowsOf(run({ flags: { nb: 'hash_mismatch' } }), ids)
		expect(one.raiseAntiCheatItems).toBe(true)
	})

	it('takes the run\'s own flags over its log checks', () => {
		const rows = runRowsOf(run({ flags: { na: 'elapsed_time_gate' } }), ids)
		expect(rows.logs.map((l) => l.flagReason)).toEqual(['elapsed_time_gate', null])
		expect(rows.flagged).toEqual([{ playerId: 'pg-a', reason: 'elapsed_time_gate' }])
	})

	it('files each report that differs from a disputed matchmade result', () => {
		const ab = [
			{ playerId: 'na', place: 1 },
			{ playerId: 'nb', place: 2 },
		]
		const ba = [
			{ playerId: 'na', place: 2 },
			{ playerId: 'nb', place: 1 },
		]
		const disputed = run({ status: 'disputed', placements: ab, reports: { nb: ba, na: ab }, reportOrder: ['nb', 'na'] })
		expect(runRowsOf(disputed, ids).conflicts).toEqual([
			{
				matchId: disputed.run.runId,
				lobbyCode: 'ABCDE',
				firstReporterId: 'pg-a',
				firstPlacements: [
					{ playerId: 'pg-a', place: 1 },
					{ playerId: 'pg-b', place: 2 },
				],
				conflictingReporterId: 'pg-b',
				conflictingPlacements: [
					{ playerId: 'pg-a', place: 2 },
					{ playerId: 'pg-b', place: 1 },
				],
			},
		])
		// Not for an agreed game.
		expect(runRowsOf(run({ reports: { na: ab, nb: ba } }), ids).conflicts).toEqual([])
	})

	it('files a private disputed game too, marked private', () => {
		const ab = [
			{ playerId: 'na', place: 1 },
			{ playerId: 'nb', place: 2 },
		]
		const ba = [
			{ playerId: 'na', place: 2 },
			{ playerId: 'nb', place: 1 },
		]
		const rows = runRowsOf(
			run({ status: 'disputed', gameMode: undefined, rankedMode: undefined, placements: ab, reports: { na: ab, nb: ba }, reportOrder: ['na', 'nb'] }),
			ids,
		)
		expect(rows.conflicts).toHaveLength(1)
		expect(rows.lobbyKind).toBe('private')
	})
})

describe('runRowsOf: contests', () => {
	const contested = (over: Partial<PulledRun['run']> = {}) =>
		run({ status: 'contested', ratings: {}, contest: { by: 'nb', against: 'na', at: T0 + 30_000 }, ...over })

	it('files the contester and the contested player, as player ids', () => {
		const rows = runRowsOf(contested(), ids)
		expect(rows.contest).toMatchObject({ contesterId: 'pg-b', againstId: 'pg-a', at: expect.any(Date) })
		expect(rows.lobbyRun.status).toBe('completed')
		expect(runRowsOf(run(), ids).contest).toBeNull()
	})

	it('leaves every player unrated, so a rebuild skips the run until a moderator decides', () => {
		// Nothing was rated, so the board read at pull time holds no rating for this run.
		const rows = runRowsOf({ ...contested(), ratings: {} }, ids)
		expect(rows.match?.resultPlacements.map((p) => p.rated)).toEqual([false, false])
		expect(rows.ratings).toEqual([])
	})

	it('gives the logs the evidence limit', () => {
		const limit = new Date(T0 + 60_000 + 180 * DAY)
		expect(runRowsOf(contested(), ids).logs.map((l) => l.expiresAt)).toEqual([limit, limit])
	})
})

describe('chatRowsOf', () => {
	const line = (flagged: boolean): PulledChat => ({
		key: 'k-chat',
		kind: 'chat',
		at: T0,
		line: { lobbyCode: 'ABC123', userId: 'na', message: 'hi', flagged, verdict: flagged ? { source: 'remote', band: 'high' } : null },
	})

	it('keeps a clean line for 90 days', () => {
		const rows = chatRowsOf(line(false), 'pg-a', 'hash')
		expect(rows.chat).toMatchObject({ playerId: 'pg-a', moderationId: 'hash', mirrorKey: 'k-chat', flagged: false })
		expect(rows.chat.expiresAt).toEqual(new Date(T0 + 90 * DAY))
		expect(rows.flaggedMessage).toBeNull()
	})

	it('keeps a flagged line 180 days as evidence and files it for review', () => {
		const rows = chatRowsOf(line(true), 'pg-a', null)
		expect(rows.chat.expiresAt).toEqual(new Date(T0 + 180 * DAY))
		expect(rows.flaggedMessage?.expiresAt).toEqual(new Date(T0 + 180 * DAY))
		expect(rows.flaggedMessage).toMatchObject({ matches: { source: 'remote', band: 'high' }, mirrorKey: 'k-chat' })
	})

	it('stores the guard score with the verdict, and still files the flag with band only', () => {
		const verdict = { source: 'remote', band: 'review', guardSafety: 'Controversial', guardScore: 0.5, guardContextUsed: true }
		const rows = chatRowsOf({ ...line(true), line: { ...line(true).line, verdict } }, 'pg-a', null)
		expect(rows.chat.moderationVerdict).toEqual(verdict)
		expect(rows.flaggedMessage?.matches).toEqual({ source: 'remote', band: 'review' })
	})

	it('stores the guard score of a line that was not flagged', () => {
		const verdict = { source: 'remote', band: 'clean', guardSafety: 'Safe', guardScore: 0.01, guardContextUsed: false }
		const rows = chatRowsOf({ ...line(false), line: { ...line(false).line, verdict } }, 'pg-a', 'hash')
		expect(rows.chat).toMatchObject({ flagged: false, moderationVerdict: verdict })
		expect(rows.flaggedMessage).toBeNull()
	})

	it('stores no verdict for an older line that has none', () => {
		expect(chatRowsOf(line(false), 'pg-a', 'hash').chat.moderationVerdict).toBeNull()
	})

	it('keeps what the local word filter matched as the API wrote it', () => {
		const matches = [{ word: 'fuck', startIndex: 0, endIndex: 3 }]
		const entry = line(true)
		const rows = chatRowsOf({ ...entry, line: { ...entry.line, verdict: { source: 'local', matches } } }, 'pg-a', null)
		expect(rows.flaggedMessage?.matches).toEqual(matches)
	})
})

function deps() {
	const players = {
		findPlayerIdsByNakamaUserIds: vi.fn(async () => new Map([['na', 'pg-a']])),
		findPlayerById: vi.fn(async (id: string) => (id === 'pg-legacy' ? { id } : null)),
		findPlayerBySteamIdHash: vi.fn(async (hash: string) => (hash === 'h76' ? { id: 'pg-steam' } : null)),
		linkNakamaUser: vi.fn(async () => undefined),
		createPlayer: vi.fn(async (data: { id: string }) => ({ id: data.id })),
	}
	const store = {
		storeRun: vi.fn(async () => undefined),
		storeChat: vi.fn(async () => undefined),
		storeForfeit: vi.fn(async () => undefined),
		storeNoticeAcceptance: vi.fn(async () => undefined),
		storeContest: vi.fn(async () => undefined),
	}
	const service = createMirrorService({ players, store })
	return { players, store, service }
}

describe('the mirror service', () => {
	it('finds or makes a player row for every Nakama user', async () => {
		const { players, service } = deps()
		const resolved = await service.resolvePlayers({
			entries: [],
			players: {
				na: { steamIdHash: 'h1', legacyPlayerId: null, displayName: 'Ay' },
				nb: { steamIdHash: 'h99', legacyPlayerId: 'pg-legacy', displayName: 'Bee' },
				nc: { steamIdHash: 'h76', legacyPlayerId: null, displayName: 'Cee' },
				nd: { steamIdHash: null, legacyPlayerId: null, displayName: '' },
			},
		})
		expect(resolved.get('na')).toBe('pg-a')
		expect(resolved.get('nb')).toBe('pg-legacy')
		expect(resolved.get('nc')).toBe('pg-steam')
		expect(players.linkNakamaUser.mock.calls).toEqual([
			['pg-legacy', 'nb'],
			['pg-steam', 'nc'],
		])
		expect(players.createPlayer).toHaveBeenCalledWith(expect.objectContaining({ steamName: 'Player', nakamaUserId: 'nd' }))
		expect(resolved.get('nd')).toBe(players.createPlayer.mock.calls[0][0].id)
	})

	it('never stores the Nakama id of a deleted account it has no row for', async () => {
		const { players, service } = deps()
		const resolved = await service.resolvePlayers({
			entries: [],
			players: { ngone: { steamIdHash: null, legacyPlayerId: null, displayName: '', deleted: true } },
		})
		const created = players.createPlayer.mock.calls[0][0] as { id: string; nakamaUserId?: string; deleted?: boolean; steamName: string }
		expect(created.nakamaUserId).toBeUndefined()
		expect(created).toEqual(expect.objectContaining({ steamName: '[deleted player]', deleted: true }))
		expect(resolved.get('ngone')).toBe(created.id)
	})

	it("maps the standard deleted-player id to itself, every deleted player's side of a shared game", async () => {
		const { players, service } = deps()
		const resolved = await service.resolvePlayers({
			entries: [],
			players: {
				[DELETED_PLAYER_ID]: {
					steamIdHash: null,
					legacyPlayerId: null,
					displayName: '',
					deleted: true,
				},
			},
		})
		expect(resolved.get(DELETED_PLAYER_ID)).toBe(DELETED_PLAYER_ID)
		expect(players.createPlayer).not.toHaveBeenCalled()
	})

	it('stores what it can and leaves the rest', async () => {
		const { store, service } = deps()
		store.storeRun.mockRejectedValueOnce(new Error('db down'))
		const chat: PulledChat = { key: 'k-chat', kind: 'chat', at: T0, line: { lobbyCode: 'X', userId: 'na', message: 'm', flagged: false, verdict: null } }
		const result = await service.storePull({
			entries: [run(), chat],
			players: { na: { steamIdHash: 'h1', legacyPlayerId: null, displayName: '' }, nb: { steamIdHash: null, legacyPlayerId: null, displayName: '' } },
		})
		expect(result).toEqual({ stored: ['k-chat'], failed: ['k-run'] })
		expect(store.storeChat).toHaveBeenCalledWith(expect.objectContaining({ chat: expect.objectContaining({ moderationId: 'h1' }) }))
	})
})

describe('a forfeit entry', () => {
	it('becomes a reconciliation flag for the player', async () => {
		const { store, service } = deps()
		await service.storePull({
			entries: [{ key: 'k-f', kind: 'forfeit', at: T0 + 30_000, userId: 'na', runId: 'r1', code: 'ABCDE', forfeitedAt: T0 }],
			players: { na: { steamIdHash: null, legacyPlayerId: null, displayName: '' } },
		})
		expect(store.storeForfeit).toHaveBeenCalledWith({
			matchId: 'r1',
			lobbyCode: 'ABCDE',
			playerId: 'pg-a',
			forfeitedAt: new Date(T0),
			reconnectedAt: new Date(T0 + 30_000),
		}, null)
	})
})

describe('a notice entry', () => {
	it('records which Notice version the player accepted, and when', async () => {
		const { store, service } = deps()
		const result = await service.storePull({
			entries: [{ key: 'k-n', kind: 'notice', at: T0, userId: 'na', version: 2 }],
			players: { na: { steamIdHash: null, legacyPlayerId: null, displayName: '' } },
		})
		expect(result.stored).toEqual(['k-n'])
		expect(store.storeNoticeAcceptance).toHaveBeenCalledWith({ playerId: 'pg-a', version: 2, acceptedAt: new Date(T0) })
	})
})

describe('drainMirror', () => {
	const chat = (n: number): PulledChat => ({ key: `k${n}`, kind: 'chat', at: n, line: { lobbyCode: 'X', userId: 'na', message: 'm', flagged: false, verdict: null } })
	const page = (from: number, count: number): MirrorPull => ({
		entries: Array.from({ length: count }, (_, i) => chat(from + i)),
		players: { na: { steamIdHash: null, legacyPlayerId: null, displayName: '' } },
	})

	it('pulls pages until a short one, acking each', async () => {
		const { service } = deps()
		const pages = [page(0, MIRROR_PAGE), page(MIRROR_PAGE, 3)]
		const rpc = vi.fn(async (id: string, _body: Record<string, unknown>) => (id === 'admin_mirror_pull' ? ok(pages.shift()) : ok({ acked: 1 })))
		expect(await drainMirror(rpc as never, service)).toBe(MIRROR_PAGE + 3)
		const acks = rpc.mock.calls.filter(([id]) => id === 'admin_mirror_ack').map(([, body]) => (body.keys as string[]).length)
		expect(acks).toEqual([MIRROR_PAGE, 3])
	})

	it('stops quietly when Nakama is off or away', async () => {
		const { service } = deps()
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		expect(await drainMirror((async () => err('disabled')) as never, service)).toBe(0)
		expect(warn).not.toHaveBeenCalled()
		expect(await drainMirror((async () => err('unreachable')) as never, service)).toBe(0)
		expect(warn).toHaveBeenCalledOnce()
		warn.mockRestore()
	})

	it('does not spin on a page with a failure', async () => {
		const { store, service } = deps()
		store.storeChat.mockRejectedValueOnce(new Error('x'))
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const rpc = vi.fn(async (id: string) => (id === 'admin_mirror_pull' ? ok(page(0, MIRROR_PAGE)) : ok({})))
		expect(await drainMirror(rpc as never, service)).toBe(MIRROR_PAGE - 1)
		expect(rpc.mock.calls.filter(([id]) => id === 'admin_mirror_pull')).toHaveLength(1)
		error.mockRestore()
	})
})

describe('rankedGameModeOf', () => {
	it('keys a Nakama board the way the website reads it', () => {
		expect(rankedGameModeOf('duel')).toBe('ranked:duel')
		expect(rankedGameModeOf('ranked:duel')).toBe('ranked:duel')
	})
})

describe('a contest entry', () => {
	it('records the Contest of a game that is still running', async () => {
		const { store, service } = deps()
		const result = await service.storePull({
			entries: [{ key: 'k-c', kind: 'contest', at: T0, runId: 'r1', code: 'ABCDE', by: 'na', against: 'nb', lobbyKind: 'ranked' }],
			players: {
				na: { steamIdHash: null, legacyPlayerId: null, displayName: '' },
				nb: { steamIdHash: null, legacyPlayerId: null, displayName: '' },
			},
		})
		expect(result.stored).toEqual(['k-c'])
		expect(store.storeContest).toHaveBeenCalledWith(
			expect.objectContaining({ runId: 'r1', contesterId: 'pg-a', madeAt: new Date(T0) }),
		)
	})
})
