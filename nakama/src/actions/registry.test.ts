import { describe, expect, it } from 'vitest'
import { ServerOp } from '../lobby/protocol'
import { action } from '../lobby/relay'
import {
	type Lobby,
	type Outbound,
	type Step,
	disconnect,
	join,
	newLobby,
	tick,
} from '../lobby/state'

const GRACE = 10_000
const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

function send(lobby: Lobby, from: string, key: string, params: unknown = {}, now = 1000): Step {
	return action(
		lobby,
		from,
		{ cid: `${key}-${from}`, action: key, to: 'server', params },
		{ now, newSeed: () => 'SEED1234', newId: () => 'RUN1', random: () => 0 },
	)
}

type Send = Extract<Outbound, { kind: 'send' }>
function rejection(step: Step): string | undefined {
	const r = step.out.filter(
		(o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION_REJECTED,
	)[0]
	return r && (r.payload as { reason: string }).reason
}

// Host a, then b and c, with b and c ready.
function readyLobby(): Lobby {
	let lobby = newLobby({ code: 'ABC123', modId: 'm', maxPlayers: 8, creatorId: 'a', now: 0, graceMs: GRACE })
	for (const id of ['a', 'b', 'c']) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	for (const id of ['b', 'c']) lobby = send(lobby, id, 'mpapi_ready', { ready: true }).lobby
	return lobby
}

const seatIds = (lobby: Lobby) => lobby.players.map((p) => p.id)

describe('mpapi_start_game with a seat away', () => {
	it('is refused player_away while a seat that was ready is away', () => {
		const dropped = disconnect(readyLobby(), 'b', 'b-s1', 1000).lobby
		expect(rejection(send(dropped, 'a', 'mpapi_start_game'))).toBe('player_away')
	})

	it('starts on every seat once the seat is back, its Ready kept through the drop', () => {
		let lobby = disconnect(readyLobby(), 'b', 'b-s1', 1000).lobby
		lobby = join(lobby, 'b', 'b-s2', info('b'), 2000).lobby
		const step = send(lobby, 'a', 'mpapi_start_game')
		expect(rejection(step)).toBeUndefined()
		expect(step.lobby.game.started?.players.map((p) => p.id)).toEqual(['a', 'b', 'c'])
	})

	it('starts when the away seat is gone after its grace', () => {
		let lobby = disconnect(readyLobby(), 'b', 'b-s1', 1000).lobby
		lobby = tick(lobby, 1000 + GRACE).lobby
		const step = send(lobby, 'a', 'mpapi_start_game')
		expect(rejection(step)).toBeUndefined()
		expect(step.lobby.game.started?.players.map((p) => p.id)).toEqual(['a', 'c'])
	})
})

describe('mpapi_restart_game with a seat away', () => {
	it('keeps the away seat in the new game, seated, with its grace still running', () => {
		let lobby = send(readyLobby(), 'a', 'mpapi_start_game').lobby
		lobby = disconnect(lobby, 'c', 'c-s1', 1500).lobby
		const step = send(lobby, 'a', 'mpapi_restart_game', {}, 2000)
		expect(rejection(step)).toBeUndefined()
		expect(step.lobby.game.started?.players.map((p) => p.id)).toEqual(['a', 'b', 'c'])
		expect(seatIds(step.lobby)).toEqual(['a', 'b', 'c'])
		expect(step.lobby.players.find((p) => p.id === 'c')?.awaySince).toBe(1500)
		expect(step.lobby.game.presence?.filter((e) => e.userId === 'c')).toEqual([
			{ userId: 'c', kind: 'joined', at: 2000 },
			{ userId: 'c', kind: 'disconnected', at: 2000 },
		])
		const expired = tick(step.lobby, 1500 + GRACE)
		expect(seatIds(expired.lobby)).toEqual(['a', 'b'])
	})
})
