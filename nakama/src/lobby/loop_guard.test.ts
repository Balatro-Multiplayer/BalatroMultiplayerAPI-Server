import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import {
	type LobbyMatchState,
	lobbyMatchJoin,
	lobbyMatchJoinAttempt,
	lobbyMatchLeave,
	lobbyMatchLoop,
} from './match'
import {
	CURRENT_LOBBY_COLLECTION,
	CURRENT_LOBBY_KEY,
	ClientOp,
} from './protocol'
import { type Lobby, join, newLobby } from './state'

// Each flag makes that state step throw.
const boom = vi.hoisted(() => ({ join: false, disconnect: false, tick: false }))
vi.mock('./state', async (importOriginal) => {
	const real = await importOriginal<typeof import('./state')>()
	const throwing =
		<A extends unknown[], R>(key: keyof typeof boom, f: (...args: A) => R) =>
		(...args: A): R => {
			if (boom[key]) throw new Error(`${key} threw`)
			return f(...args)
		}
	return {
		...real,
		join: throwing('join', real.join),
		disconnect: throwing('disconnect', real.disconnect),
		tick: throwing('tick', real.tick),
	}
})

// Nakama ends a match whose callback throws, which drops every player in it.
// A step that throws is logged and skipped instead.

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

function twoPlayerLobby(): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'M',
		maxPlayers: 4,
		creatorId: 'a',
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ['a', 'b'])
		lobby = join(lobby, id, `${id}-s`, info(id)).lobby
	return lobby
}

const presence = (userId: string) => ({
	userId,
	sessionId: `${userId}-s`,
	username: userId,
	node: 'n',
})
const dispatcher = {
	broadcastMessage: () => {},
	matchKick: () => {},
	matchLabelUpdate: () => {},
} as unknown as nkruntime.MatchDispatcher
const ctx = { ...playerCtx(''), matchId: 'm1' } as nkruntime.Context

describe('a step that throws', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		boom.join = false
		boom.disconnect = false
		boom.tick = false
	})

	it('is skipped: the match goes on and the next message is still read', () => {
		const nk = fakeNk({
			binaryToString: (b: Uint8Array) => new TextDecoder().decode(b),
		})
		const state = {
			lobby: twoPlayerLobby(),
			presences: { a: presence('a'), b: presence('b') },
			pendingInfo: {},
			label: '',
		} as unknown as LobbyMatchState
		const message = (userId: string, catchingUp: boolean) => ({
			sender: presence(userId),
			opCode: ClientOp.CATCHING_UP,
			data: new TextEncoder().encode(JSON.stringify({ catchingUp })),
		})
		// The first message's step reads the clock first: that read throws.
		let calls = 0
		vi.spyOn(Date, 'now').mockImplementation(() => {
			calls += 1
			if (calls === 1) throw new Error('boom')
			return 1000
		})
		const after = lobbyMatchLoop(
			ctx,
			fakeLogger,
			nk as unknown as nkruntime.Nakama,
			dispatcher,
			1,
			state,
			[message('a', true), message('b', true)] as never,
		)
		expect(after).not.toBeNull()
		const players = after?.state.lobby.players ?? []
		expect(
			players.find((p) => p.id === 'a')?.catchingUpSince ?? null,
		).toBeNull()
		expect(players.find((p) => p.id === 'b')?.catchingUpSince).toBe(1000)
	})

	it('in a join attempt refuses the joiner instead', () => {
		// c's current-lobby record names another match, and looking it up throws.
		const nk = fakeNk({
			accountGetId: (id: string) => ({ user: { userId: id, username: id } }),
			matchGet: () => {
				throw new Error('match lookup failed')
			},
		})
		nk.storageWrite([
			{
				collection: CURRENT_LOBBY_COLLECTION,
				key: CURRENT_LOBBY_KEY,
				userId: 'c',
				value: { matchId: 'm2', code: 'XYZ789' },
			},
		])
		const state = {
			lobby: twoPlayerLobby(),
			presences: {},
			pendingInfo: {},
			label: '',
		} as unknown as LobbyMatchState
		const attempt = lobbyMatchJoinAttempt(
			ctx,
			fakeLogger,
			nk as unknown as nkruntime.Nakama,
			dispatcher,
			1,
			state,
			presence('c') as never,
			{ modId: 'M' },
		)
		expect(attempt).toMatchObject({
			accept: false,
			rejectMessage: 'Could not join, try again',
		})
	})

	it.each([
		[
			'not found: the other match is gone, so the join goes on',
			'failed to signal match: match not found',
			true,
		],
		[
			'busy: the other match may still seat them, so the join is refused',
			'failed to signal match: match busy',
			false,
		],
	])('in the other-lobby check, %s', (_name, error, accept) => {
		const nk = fakeNk({
			accountGetId: (id: string) => ({ user: { userId: id, username: id } }),
			matchGet: () => ({ matchId: 'm2' }),
			matchSignal: () => {
				throw new Error(error)
			},
		})
		nk.storageWrite([
			{
				collection: CURRENT_LOBBY_COLLECTION,
				key: CURRENT_LOBBY_KEY,
				userId: 'c',
				value: { matchId: 'm2', code: 'XYZ789' },
			},
		])
		const state = {
			lobby: twoPlayerLobby(),
			presences: {},
			pendingInfo: {},
			label: '',
		} as unknown as LobbyMatchState
		const attempt = lobbyMatchJoinAttempt(
			ctx,
			fakeLogger,
			nk as unknown as nkruntime.Nakama,
			dispatcher,
			1,
			state,
			presence('c') as never,
			{ modId: 'M' },
		)
		expect(attempt.accept).toBe(accept)
	})

	it('in a join kicks the joiner, who is not seated', () => {
		const kicked: string[] = []
		const kicking = {
			...dispatcher,
			matchKick: (who: { userId: string }[]) =>
				kicked.push(...who.map((p) => p.userId)),
		} as unknown as nkruntime.MatchDispatcher
		const state = {
			lobby: twoPlayerLobby(),
			presences: {},
			pendingInfo: {},
			label: '',
		} as unknown as LobbyMatchState
		boom.join = true
		const after = lobbyMatchJoin(
			ctx,
			fakeLogger,
			fakeNk() as unknown as nkruntime.Nakama,
			kicking,
			1,
			state,
			[presence('c') as never],
		)
		expect(kicked).toEqual(['c'])
		expect(after?.state.presences.c).toBeUndefined()
		expect(after?.state.lobby.players.map((p) => p.id)).toEqual(['a', 'b'])
	})

	it('in a leave still marks the seat away, so its grace runs out and the lobby closes', () => {
		const nk = fakeNk() as unknown as nkruntime.Nakama
		const state = {
			lobby: twoPlayerLobby(),
			presences: { a: presence('a'), b: presence('b') },
			pendingInfo: {},
			label: '',
		} as unknown as LobbyMatchState
		vi.spyOn(Date, 'now').mockReturnValue(1000)
		boom.disconnect = true
		const left = lobbyMatchLeave(ctx, fakeLogger, nk, dispatcher, 1, state, [
			presence('a'),
			presence('b'),
		] as never)
		boom.disconnect = false
		expect(left?.state.lobby.players.map((p) => p.awaySince)).toEqual([
			1000, 1000,
		])
		expect(left?.state.presences).toEqual({})
		vi.spyOn(Date, 'now').mockReturnValue(1000 + 10_000 + 1)
		expect(
			lobbyMatchLoop(
				ctx,
				fakeLogger,
				nk,
				dispatcher,
				2,
				left?.state as LobbyMatchState,
				[],
			),
		).toBeNull()
	})

	it('in a tick stage every tick closes the lobby after 5 s of ticks', () => {
		const nk = fakeNk()
		let state = {
			lobby: twoPlayerLobby(),
			presences: { a: presence('a'), b: presence('b') },
			pendingInfo: {},
			label: '',
		} as unknown as LobbyMatchState
		vi.spyOn(Date, 'now').mockReturnValue(1000)
		boom.tick = true
		for (let n = 1; n < 25; n++) {
			const after = lobbyMatchLoop(
				ctx,
				fakeLogger,
				nk as unknown as nkruntime.Nakama,
				dispatcher,
				n,
				state,
				[],
			)
			expect(after).not.toBeNull()
			state = after?.state as LobbyMatchState
		}
		expect(state.failedTicks).toBe(24)
		expect(
			lobbyMatchLoop(
				ctx,
				fakeLogger,
				nk as unknown as nkruntime.Nakama,
				dispatcher,
				25,
				state,
				[],
			),
		).toBeNull()
	})

	it('in a tick stage, on closing, still tells everyone the lobby closed', () => {
		const sent: string[] = []
		const listening = {
			...dispatcher,
			broadcastMessage: (_op: number, data: string) => sent.push(data),
		} as unknown as nkruntime.MatchDispatcher
		const nk = fakeNk() as unknown as nkruntime.Nakama
		const state = {
			lobby: twoPlayerLobby(),
			presences: { a: presence('a'), b: presence('b') },
			pendingInfo: {},
			label: '',
			failedTicks: 24,
		} as unknown as LobbyMatchState
		vi.spyOn(Date, 'now').mockReturnValue(1000)
		boom.tick = true
		expect(
			lobbyMatchLoop(ctx, fakeLogger, nk, listening, 25, state, []),
		).toBeNull()
		expect(sent.some((data) => data.includes('lobby_closed'))).toBe(true)
	})

	it('in a tick stage once is forgiven by the next clean tick', () => {
		const nk = fakeNk() as unknown as nkruntime.Nakama
		const state = {
			lobby: twoPlayerLobby(),
			presences: { a: presence('a'), b: presence('b') },
			pendingInfo: {},
			label: '',
		} as unknown as LobbyMatchState
		vi.spyOn(Date, 'now').mockReturnValue(1000)
		boom.tick = true
		const failed = lobbyMatchLoop(ctx, fakeLogger, nk, dispatcher, 1, state, [])
		boom.tick = false
		expect(failed?.state.failedTicks).toBe(1)
		const clean = lobbyMatchLoop(
			ctx,
			fakeLogger,
			nk,
			dispatcher,
			2,
			failed?.state as LobbyMatchState,
			[],
		)
		expect(clean?.state.failedTicks).toBe(0)
	})
})
