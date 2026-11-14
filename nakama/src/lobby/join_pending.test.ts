import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { lobbyMatchInit, lobbyMatchJoin } from './match'
import type { PlayerInfo } from './protocol'

const ctx = { ...playerCtx(''), matchId: 'm1' } as nkruntime.Context
const nk = fakeNk({ matchGet: () => null }) as unknown as nkruntime.Nakama

const presence = (userId: string) =>
	({ userId, sessionId: `${userId}-s`, username: userId, node: 'n' }) as nkruntime.Presence

function created() {
	return lobbyMatchInit(ctx, fakeLogger, nk, {
		code: 'ABC123',
		modId: 'M',
		maxPlayers: 4,
		creatorId: 'host',
	}).state
}

describe('lobbyMatchJoin without join info', () => {
	it('kicks the presence and does not seat it', () => {
		const kicked: nkruntime.Presence[][] = []
		const dispatcher = {
			broadcastMessage: () => undefined,
			matchKick: (p: nkruntime.Presence[]) => kicked.push(p),
			matchLabelUpdate: () => undefined,
		} as unknown as nkruntime.MatchDispatcher
		const joined = lobbyMatchJoin(ctx, fakeLogger, nk, dispatcher, 1, created(), [presence('host')])
		expect(kicked).toEqual([[presence('host')]])
		expect(joined?.state.lobby.players).toEqual([])
		expect(joined?.state.presences).toEqual({})
	})
})

describe('lobbyMatchJoin of a user who already has a seat', () => {
	it('takes the new session without join info instead of kicking it', () => {
		const kicked: nkruntime.Presence[][] = []
		const dispatcher = {
			broadcastMessage: () => undefined,
			matchKick: (p: nkruntime.Presence[]) => kicked.push(p),
			matchLabelUpdate: () => undefined,
		} as unknown as nkruntime.MatchDispatcher
		const info = { displayName: 'host' } as unknown as PlayerInfo
		const first = lobbyMatchJoin(ctx, fakeLogger, nk, dispatcher, 1, { ...created(), pendingInfo: { host: info } }, [
			presence('host'),
		])
		const retry = { ...presence('host'), sessionId: 'host-s2' } as nkruntime.Presence
		const second = lobbyMatchJoin(ctx, fakeLogger, nk, dispatcher, 2, first!.state, [retry])
		expect(kicked).toEqual([])
		expect(second?.state.presences.host).toEqual(retry)
		expect(second?.state.lobby.players.map((p) => [p.id, p.sessionId])).toEqual([['host', 'host-s2']])
	})
})

