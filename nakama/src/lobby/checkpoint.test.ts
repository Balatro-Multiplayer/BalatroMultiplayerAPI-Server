import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import {
	CHECKPOINT_TTL_MS,
	CLAIM_TIMEOUT_MS,
	checkpointOf,
	isClaimable,
	readCheckpoint,
	resumeFrom,
	resumeLobby,
	saveCheckpoint,
} from './checkpoint'
import { bindCode, reserveCode } from './codes'
import { lobbyMatchInit, lobbyMatchLoop, lobbyMatchTerminate } from './match'
import { CURRENT_LOBBY_COLLECTION, CURRENT_LOBBY_KEY, LOBBY_CODE_COLLECTION, ServerOp, SYSTEM_USER_ID } from './protocol'
import { rpcLobbyCurrent, rpcLobbyFind } from './rpc'
import { type Lobby, join, newLobby } from './state'

const info = (name: string) => ({ displayName: name, preferredJoker: null, mods: null })

function startedLobby(): Lobby {
	let lobby = newLobby({ code: 'ABC123', modId: 'M', maxPlayers: 4, creatorId: 'a', now: 0, graceMs: 10_000 })
	lobby = join(lobby, 'a', 'a-s', info('a')).lobby
	lobby = join(lobby, 'b', 'b-s', info('b')).lobby
	return {
		...lobby,
		spectators: ['c'],
		actionBudget: { a: { tokens: 1, at: 5 } },
		game: { ...lobby.game, settleFrom: 1000, reports: { a: [] }, reportOrder: ['a'] },
	}
}

// A fake Nakama with live matches: matchCreate runs the real lobbyMatchInit.
function nakama() {
	const matches: { [id: string]: Lobby } = {}
	let next = 0
	const nk: any = fakeNk({
		matchGet: (id: string) => (matches[id] ? { matchId: id } : null),
		matchCreate: (_name: string, params: any) => {
			const id = `m${++next}`
			const init = lobbyMatchInit({ ...playerCtx(''), matchId: id }, fakeLogger, nk, params)
			matches[id] = init.state.lobby
			return id
		},
		matchSignal: (id: string, data: string) => {
			const signal = JSON.parse(data)
			return matches[id].players.some((p) => p.id === signal.userId) ? 'yes' : 'no'
		},
	})
	return { nk, matches }
}

describe('checkpointOf / resumeFrom', () => {
	it('keeps a lobby with players, not an empty or closed one', () => {
		const lobby = startedLobby()
		expect(checkpointOf(lobby, 5)).toEqual({ lobby, at: 5, claimedAt: null, expiresAt: 5 + CHECKPOINT_TTL_MS })
		expect(checkpointOf({ ...lobby, players: [] }, 5)).toBeNull()
		expect(checkpointOf({ ...lobby, closed: true }, 5)).toBeNull()
	})

	it('brings everyone back away with a fresh grace period and rebases the result clock', () => {
		const lobby = startedLobby()
		const resumed = resumeFrom({ lobby, at: 2000, claimedAt: null }, 9000)
		expect(resumed.players.map((p) => [p.id, p.awaySince, p.sessionId])).toEqual([
			['a', 9000, ''],
			['b', 9000, ''],
		])
		expect(resumed.game.settleFrom).toBe(1000 + 7000)
		expect(resumed.game.reports).toEqual({ a: [] })
		expect(resumed.hostId).toBe('a')
		expect(resumed.spectators).toEqual([])
		expect(resumed.actionBudget).toEqual({})
		expect(resumed.createdAt).toBe(9000)
		// JSON round trip, as storage does it.
		expect(resumeFrom(JSON.parse(JSON.stringify({ lobby, at: 2000, claimedAt: null })), 9000)).toEqual(resumed)
	})

	it('lets a stuck claim be taken over, and expires', () => {
		const cp = { lobby: startedLobby(), at: 0, claimedAt: 100 }
		expect(isClaimable(cp, 100 + CLAIM_TIMEOUT_MS - 1)).toBe(false)
		expect(isClaimable(cp, 100 + CLAIM_TIMEOUT_MS)).toBe(true)
		expect(isClaimable({ ...cp, claimedAt: null }, CHECKPOINT_TTL_MS)).toBe(false)
	})
})

describe('a restart', () => {
	it('checkpoints the lobby on shutdown and tells the players', () => {
		const { nk } = nakama()
		const sent: any[] = []
		const dispatcher: any = { broadcastMessage: (...args: any[]) => sent.push(args) }
		const lobby = startedLobby()
		const presences = { a: { userId: 'a' }, b: { userId: 'b' } }
		const state: any = { lobby, presences, pendingInfo: {}, label: '' }
		const ended = lobbyMatchTerminate({ ...playerCtx(''), matchId: 'm0' }, fakeLogger, nk, dispatcher, 1, state, 20)
		expect(ended.state.stopping).toBe(true)
		expect(lobbyMatchLoop({ ...playerCtx(''), matchId: 'm0' }, fakeLogger, nk, dispatcher, 2, ended.state, [])).toBeNull()
		expect(readCheckpoint(nk, 'ABC123')!.checkpoint.lobby).toEqual(lobby)
		expect(sent.map((s) => [s[0], JSON.parse(s[1]), s[2].length])).toEqual([[ServerOp.SERVER_RESTARTING, { graceSeconds: 20 }, 2]])
	})

	it('resumes the lobby under its code once a player comes back, once', () => {
		const { nk, matches } = nakama()
		const lobby = startedLobby()
		bindCode(nk, 'ABC123', 'gone', 'M')
		for (const id of ['a', 'b'])
			nk.storageWrite([
				{ collection: CURRENT_LOBBY_COLLECTION, key: CURRENT_LOBBY_KEY, userId: id, value: { matchId: 'gone', code: 'ABC123', modId: 'M' } },
			])
		saveCheckpoint(nk, { lobby, at: Date.now(), claimedAt: null })
		// Its code can't be handed out meanwhile.
		expect(reserveCode(nk, 'ABC123', 'M')).toBe(false)

		const seat = JSON.parse(rpcLobbyCurrent(playerCtx('a'), fakeLogger, nk, '{}'))
		expect(seat).toEqual({ matchId: 'm1', code: 'ABC123', modId: 'M' })
		expect(matches.m1.players.map((p) => p.awaySince !== null)).toEqual([true, true])
		expect(matches.m1.game.reports).toEqual({ a: [] })
		// The other player, the code and the checkpoint all moved on.
		expect(JSON.parse(rpcLobbyCurrent(playerCtx('b'), fakeLogger, nk, '{}')).matchId).toBe('m1')
		expect(JSON.parse(rpcLobbyFind(playerCtx('c'), fakeLogger, nk, '{"code":"ABC123"}')).matchId).toBe('m1')
		expect(nk.objects.get(`${LOBBY_CODE_COLLECTION}/${SYSTEM_USER_ID}/ABC123`).value.matchId).toBe('m1')
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
		expect(Object.keys(matches)).toEqual(['m1'])
	})

	it('tells a second caller to wait while a resume is under way', () => {
		const { nk } = nakama()
		saveCheckpoint(nk, { lobby: startedLobby(), at: Date.now(), claimedAt: Date.now() })
		nk.storageWrite([
			{ collection: CURRENT_LOBBY_COLLECTION, key: CURRENT_LOBBY_KEY, userId: 'a', value: { matchId: 'gone', code: 'ABC123', modId: 'M' } },
		])
		expect(JSON.parse(rpcLobbyCurrent(playerCtx('a'), fakeLogger, nk, '{}'))).toEqual({ resuming: true })
		expect(() => rpcLobbyFind(playerCtx('a'), fakeLogger, nk, '{"code":"ABC123"}')).toThrow(/resuming/)
		// The record is kept for the retry.
		expect(nk.objects.has(`${CURRENT_LOBBY_COLLECTION}/a/${CURRENT_LOBBY_KEY}`)).toBe(true)
	})

	it('drops an expired checkpoint', () => {
		const { nk } = nakama()
		saveCheckpoint(nk, { lobby: startedLobby(), at: Date.now() - CHECKPOINT_TTL_MS, claimedAt: null })
		expect(reserveCode(nk, 'ABC123', 'M')).toBe(true)
		expect(resumeLobby(nk, null, 'ABC123', Date.now())).toEqual({ kind: 'none' })
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
	})
})

describe('Run saves across a restart', () => {
	const save = (id: string, pos: number) => ({ id, pos, hash: 'a'.repeat(64), data: `data-${id}`, at: 7 })
	const pending = (id: string) => ({ id, count: 3, pos: 9, hash: 'b'.repeat(64), parts: { '0': 'x' } })

	function restartAndResume() {
		const { nk, matches } = nakama()
		const base = startedLobby()
		const lobby: Lobby = {
			...base,
			game: {
				...base.game,
				runSaves: { a: save('s1', 4), b: save('s2', 6) },
				runSavePending: { a: pending('s3') },
			},
		}
		bindCode(nk, 'ABC123', 'gone', 'M')
		const dispatcher: any = { broadcastMessage: () => {} }
		const state: any = { lobby, presences: {}, pendingInfo: {}, label: '' }
		lobbyMatchTerminate({ ...playerCtx(''), matchId: 'm0' }, fakeLogger, nk, dispatcher, 1, state, 20)
		const result = resumeLobby(nk, null, 'ABC123', Date.now())
		expect(result.kind).toBe('resumed')
		return { resumed: matches.m1, lobby }
	}

	it('gives the restored lobby each player latest complete Run save, unchanged', () => {
		const { resumed, lobby } = restartAndResume()
		expect(resumed.game.runSaves).toEqual(lobby.game.runSaves)
	})

	it('does not carry unfinished parts', () => {
		const { resumed } = restartAndResume()
		expect(resumed.game.runSavePending).toBeUndefined()
	})
})
