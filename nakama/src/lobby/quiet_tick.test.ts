// A tick that changes nothing does no projection work, and a tick that changes
// something is still announced. The match state is passed through `fromRuntime`, so
// every nested read is a new copy, as in the Nakama runtime.
import { afterEach, describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { fromRuntime } from '../testing/runtime_state'
import { type LobbyMatchState, lobbyMatchLoop } from './match'
import {
	changedKeys,
	registerMatchKey,
	unregisterMatchKey,
} from './match_state'
import { ServerOp } from './protocol'
import { type Lobby, join, newLobby } from './state'

const KEY = 'test.seats'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

function lobbyOf(ids: string[]): Lobby {
	let lobby = newLobby({
		code: 'ABCD',
		modId: 'M',
		maxPlayers: 8,
		creatorId: ids[0],
		now: 0,
		graceMs: 60_000,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
	return lobby
}

const presence = (userId: string) =>
	({
		userId,
		sessionId: `${userId}-s`,
		username: userId,
		node: 'n',
	}) as nkruntime.Presence

// One loop step over `lobby`, with no messages. Returns what was broadcast.
function runLoop(
	lobby: Lobby,
): { op: number; body: { [key: string]: unknown } }[] {
	const sent: { op: number; body: { [key: string]: unknown } }[] = []
	const nk = fakeNk({
		binaryToString: (data: ArrayBuffer) => Buffer.from(data).toString('utf8'),
		matchLabelUpdate: () => undefined,
	}) as unknown as nkruntime.Nakama
	const dispatcher = {
		broadcastMessage: (op: number, data: string) =>
			sent.push({ op, body: JSON.parse(data) }),
		matchKick: () => undefined,
		matchLabelUpdate: () => undefined,
	} as unknown as nkruntime.MatchDispatcher
	const ctx = { ...playerCtx(''), matchId: 'm1' } as nkruntime.Context
	const state = fromRuntime({
		lobby,
		presences: Object.fromEntries(
			lobby.players.map((p) => [p.id, presence(p.id)]),
		),
		pendingInfo: {},
		label: '',
	}) as unknown as LobbyMatchState
	lobbyMatchLoop(ctx, fakeLogger, nk, dispatcher, 1, state, [])
	return sent
}

describe('a quiet tick', () => {
	afterEach(() => unregisterMatchKey(KEY))

	it('projects nothing for the same lobby object', () => {
		let projections = 0
		const lobby = lobbyOf(['u1', 'u2'])
		registerMatchKey(KEY, () => ++projections)
		expect(changedKeys(lobby, lobby)).toEqual([])
		expect(projections).toBe(0)
	})

	it('still compares two different lobbies', () => {
		registerMatchKey(KEY, (l) => l.players.length)
		const before = lobbyOf(['u1', 'u2'])
		const after = lobbyOf(['u1'])
		expect(changedKeys(before, after)).toEqual([KEY])
	})

	it('does no projection work in the match loop', () => {
		let projections = 0
		const lobby = lobbyOf(['u1', 'u2'])
		registerMatchKey(KEY, () => ++projections)
		const sent = runLoop(lobby)
		expect(projections).toBe(0)
		expect(sent).toEqual([])
	})

	it('still announces a change a tick made', () => {
		registerMatchKey(KEY, (l) => l.players.length)
		// u2 has been away past the grace window: the tick removes the seat.
		const lobby = lobbyOf(['u1', 'u2'])
		const away: Lobby = {
			...lobby,
			players: lobby.players.map((p) =>
				p.id === 'u2' ? { ...p, awaySince: 0 } : p,
			),
		}
		const sent = runLoop(away).filter((m) => m.op === ServerOp.STATE)
		expect(sent.map((m) => m.body.changed)).toEqual([{ [KEY]: 1 }])
	})
})
