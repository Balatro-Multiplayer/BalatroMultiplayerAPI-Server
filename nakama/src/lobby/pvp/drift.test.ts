// apply() in match.ts announces a game start, restart and end: one STATE for
// `pvp.ready` per step that changes it, at rev + 1.
import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx } from '../../testing/fake_nk'
import { type LobbyMatchState, lobbyMatchLoop } from '../match'
import { revOf } from '../match_state'
import { ClientOp, ServerOp, type StateMessage } from '../protocol'
import { join, newLobby } from '../state'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

const presence = (userId: string) =>
	({
		userId,
		sessionId: `${userId}-s`,
		username: userId,
		node: 'n',
	}) as nkruntime.Presence

function harness() {
	const nk = fakeNk({
		binaryToString: (data: ArrayBuffer) => Buffer.from(data).toString('utf8'),
		matchLabelUpdate: () => undefined,
	}) as unknown as nkruntime.Nakama
	const sent: { op: number; body: StateMessage }[] = []
	const dispatcher = {
		broadcastMessage: (op: number, data: string) => {
			if (op === ServerOp.STATE) sent.push({ op, body: JSON.parse(data) })
		},
		matchKick: () => undefined,
		matchLabelUpdate: () => undefined,
	} as unknown as nkruntime.MatchDispatcher
	const ctx = { ...playerCtx(''), matchId: 'm1' } as nkruntime.Context
	let lobby = newLobby({
		code: 'ABCD',
		modId: 'M',
		maxPlayers: 4,
		creatorId: 'u1',
		now: 0,
		graceMs: 60_000,
	})
	for (const id of ['u1', 'u2'])
		lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
	let state: LobbyMatchState = {
		lobby,
		presences: { u1: presence('u1'), u2: presence('u2') },
		pendingInfo: {},
		label: '',
	} as unknown as LobbyMatchState

	const message = (from: string, key: string, params: unknown = {}) =>
		({
			sender: presence(from),
			opCode: ClientOp.ACTION,
			data: new TextEncoder().encode(
				JSON.stringify({
					cid: `${key}-${from}`,
					action: key,
					to: 'server',
					params,
				}),
			).buffer,
		}) as unknown as nkruntime.MatchMessage
	let tickNumber = 0
	return {
		sent,
		get lobby() {
			return state.lobby
		},
		// Nakama's JS runtime hands the match state back as Go maps, and Go
		// randomises map iteration: every object lists its keys in a new order
		// each time it is read.
		goMaps() {
			const wrap = (v: unknown): unknown => {
				if (Array.isArray(v)) return v.map(wrap)
				if (v === null || typeof v !== 'object') return v
				const target: { [key: string]: unknown } = {}
				for (const k of Object.keys(v))
					target[k] = wrap((v as { [key: string]: unknown })[k])
				let flip = false
				return new Proxy(target, {
					ownKeys: (t) => {
						flip = !flip
						const keys = Reflect.ownKeys(t)
						return flip ? keys.reverse() : keys
					},
				})
			}
			state = { ...state, lobby: wrap(state.lobby) as LobbyMatchState['lobby'] }
		},
		// One loop call with these messages; returns the STATEs it sent.
		run(...messages: nkruntime.MatchMessage[]): StateMessage[] {
			sent.length = 0
			const next = lobbyMatchLoop(
				ctx,
				fakeLogger,
				nk,
				dispatcher,
				++tickNumber,
				state,
				messages,
			)
			if (!next) throw new Error('lobby closed')
			state = next.state as LobbyMatchState
			return sent.map((s) => s.body)
		},
		message,
	}
}

describe('match loop announces game start, restart and end', () => {
	it('a start sends one STATE at rev + 1: round 0, the new runId', () => {
		const h = harness()
		const rev = revOf(h.lobby)
		const pushed = h.run(
			h.message('u2', 'mpapi_ready', { ready: true }),
			h.message('u1', 'mpapi_start_game'),
		)
		const runId = h.lobby.game.started?.runId
		expect(runId).toBeTruthy()
		expect(pushed).toHaveLength(1)
		expect(pushed[0].rev).toBe(rev + 1)
		expect(pushed[0].changed['pvp.ready']).toMatchObject({
			runId,
			round: 0,
			lastStart: null,
		})
	})

	it('a restart sends one STATE with a new runId and round 0', () => {
		const h = harness()
		h.run(
			h.message('u2', 'mpapi_ready', { ready: true }),
			h.message('u1', 'mpapi_start_game'),
		)
		const first = h.lobby.game.started?.runId
		const rev = revOf(h.lobby)
		const pushed = h.run(h.message('u1', 'mpapi_restart_game'))
		const second = h.lobby.game.started?.runId
		expect(second).not.toBe(first)
		expect(pushed).toHaveLength(1)
		expect(pushed[0].rev).toBe(rev + 1)
		expect(pushed[0].changed['pvp.ready']).toMatchObject({
			runId: second,
			round: 0,
		})
	})

	it('the same state read with its map keys in another order sends nothing', () => {
		const h = harness()
		h.run(
			h.message('u2', 'mpapi_ready', { ready: true }),
			h.message('u1', 'mpapi_start_game'),
		)
		const runId = h.lobby.game.started?.runId as string
		// A started blind: two players' hands, the shape the live churn had.
		h.lobby.game.pvp = {
			runId,
			round: 1,
			ready: {},
			firstReady: null,
			blindKeys: {},
			order: [],
			readied: [],
			lastStart: {
				roundId: 1,
				firstPlayer: 'u1',
				players: ['u1', 'u2'],
				blindKeys: { u1: '1:Boss', u2: '1:Boss' },
			},
		}
		h.run()
		const rev = revOf(h.lobby)
		h.goMaps()
		expect(h.run()).toEqual([])
		expect(revOf(h.lobby)).toBe(rev)
	})

	it('an abandon sends one STATE with the idle value', () => {
		const h = harness()
		h.run(
			h.message('u2', 'mpapi_ready', { ready: true }),
			h.message('u1', 'mpapi_start_game'),
		)
		const rev = revOf(h.lobby)
		const pushed = h.run(h.message('u1', 'mpapi_abandon_game'))
		expect(h.lobby.game.started).toBeNull()
		expect(pushed).toHaveLength(1)
		expect(pushed[0].rev).toBe(rev + 1)
		expect(pushed[0].changed['pvp.ready']).toMatchObject({
			runId: null,
			round: 0,
		})
	})
})
