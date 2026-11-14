import { describe, expect, it } from 'vitest'
import { SEED_LENGTH, seedFromHex } from '../actions/registry'
import { ServerOp } from './protocol'
import { BURST, MAX_PARAMS_BYTES, type RelayStep, action } from './relay'
import {
	type Lobby,
	type Outbound,
	type Step,
	disconnect,
	join,
	joinRejection,
	kick,
	labelOf,
	leave,
	newLobby,
	snapshotFor,
} from './state'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

function lobbyWith(...ids: string[]): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerSPDRN',
		maxPlayers: 4,
		creatorId: ids[0],
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	return lobby
}

const ctx = { now: 1000, newSeed: () => 'SEED1234', newId: () => 'RUN1', random: () => 0 }

function send(lobby: Lobby, from: string, data: { [key: string]: unknown }) {
	return action(lobby, from, data, ctx)
}

type Send = Extract<Outbound, { kind: 'send' }>
function sends(step: Step, op: number): Send[] {
	return step.out.filter((o): o is Send => o.kind === 'send' && o.op === op)
}
function delivered(step: Step) {
	return sends(step, ServerOp.ACTION)
}
function rejection(step: Step): string | undefined {
	const r = sends(step, ServerOp.ACTION_REJECTED)[0]
	return r && (r.payload as { reason: string }).reason
}

describe('relayed actions', () => {
	it('broadcasts to everyone, the sender included', () => {
		const step = send(lobbyWith('a', 'b', 'c'), 'a', {
			cid: 'c1',
			action: 'spdrn_player_ready',
			to: '*',
			params: { ready: true },
		})
		const [msg] = delivered(step)
		expect(msg.to).toEqual(['a', 'b', 'c'])
		expect(msg.payload).toEqual({
			cid: 'c1',
			action: 'spdrn_player_ready',
			from: 'a',
			to: '*',
			params: { ready: true },
		})
	})

	it('pvp_log_event: the others get t and opcode without args, the sender keeps its own copy', () => {
		const params = { t: 12, opcode: 3, args: ['1e6', 2], score: '1e6' }
		const step = send(lobbyWith('a', 'b', 'c'), 'a', {
			cid: 'c1',
			action: 'pvp_log_event',
			to: '*',
			params,
		})
		const msgs = delivered(step)
		const own = msgs.find((m) => m.to.includes('a'))
		const others = msgs.find((m) => m.to.includes('b'))
		expect(own?.to).toEqual(['a'])
		expect((own?.payload as { params: unknown }).params).toEqual(params)
		expect(others?.to).toEqual(['b', 'c'])
		expect((others?.payload as { params: unknown }).params).toEqual({
			t: 12,
			opcode: 3,
		})
	})

	it('sends a directed action to its target only', () => {
		const step = send(lobbyWith('a', 'b', 'c'), 'a', {
			cid: 'c1',
			action: 'pvp_get_nemesis_deck',
			to: 'c',
			params: {},
		})
		expect(delivered(step)[0].to).toEqual(['c'])
	})

	it('stamps the real sender over a forged from', () => {
		const step = send(lobbyWith('a', 'b'), 'b', {
			cid: 'c1',
			action: 'spdrn_player_won',
			from: 'a',
			to: '*',
			// Its own win: spdrn_player_won is self-or-host (sender_guard.ts).
			params: { player_id: 'b' },
		})
		expect((delivered(step)[0].payload as { from: string }).from).toBe('b')
	})

	it('passes responseTo through', () => {
		const step = send(lobbyWith('a', 'b'), 'b', {
			cid: 'c2',
			action: 'spdrn_location',
			to: 'a',
			params: { x: 1 },
			responseTo: 'c1',
		})
		expect(delivered(step)[0].payload).toMatchObject({ responseTo: 'c1' })
	})

	it('relays mpapi_ keys that are not authoritative', () => {
		const step = send(lobbyWith('a', 'b'), 'a', {
			cid: 'c1',
			action: 'mpapi_sync',
			to: '*',
			params: { obj: 'j_x', kind: 'sync' },
		})
		expect(delivered(step)).toHaveLength(1)
	})

	it('rejects an unknown target, a bad key and oversized params', () => {
		const lobby = lobbyWith('a', 'b')
		expect(
			rejection(send(lobby, 'a', { cid: 'c', action: 'x', to: 'z', params: {} })),
		).toBe('unknown_target')
		expect(
			rejection(
				send(lobby, 'a', { cid: 'c', action: 'Bad Key', to: '*', params: {} }),
			),
		).toBe('bad_action')
		expect(
			rejection(
				send(lobby, 'a', {
					cid: 'c',
					action: 'x',
					to: '*',
					params: { blob: 'x'.repeat(MAX_PARAMS_BYTES) },
				}),
			),
		).toBe('too_large')
	})

	it('ignores senders who are not in the lobby, but names the drop for the log', () => {
		const step = send(lobbyWith('a', 'b'), 'z', {
			cid: 'c',
			action: 'x',
			to: '*',
			params: {},
		})
		expect(step.out).toEqual([])
		expect((step as RelayStep).refused).toEqual({ key: 'x', reason: 'no_seat' })
	})

	it('rate-limits a flooding sender', () => {
		let lobby = lobbyWith('a', 'b')
		let last: Step | null = null
		for (let i = 0; i <= BURST; i++) {
			last = send(lobby, 'a', { cid: `c${i}`, action: 'x', to: '*', params: {} })
			lobby = last.lobby
		}
		expect(rejection(last as Step)).toBe('rate_limited')
		expect((last as RelayStep).refused).toEqual({ key: 'x', reason: 'rate_limited' })
		// Refills with time.
		const later = action(
			lobby,
			'a',
			{ cid: 'late', action: 'x', to: '*', params: {} },
			{ ...ctx, now: ctx.now + 1000 },
		)
		expect(delivered(later)).toHaveLength(1)
	})
})

describe('authoritative actions', () => {
	const ready = (lobby: Lobby, from: string, value: boolean) =>
		send(lobby, from, {
			cid: `r-${from}`,
			action: 'mpapi_ready',
			to: 'server',
			params: { ready: value },
		})
	const start = (lobby: Lobby, from: string, params: unknown = {}) =>
		send(lobby, from, { cid: 's1', action: 'mpapi_start_game', to: 'server', params })

	it('refuses a relayed authoritative action (a forged server result)', () => {
		const step = send(lobbyWith('a', 'b'), 'a', {
			cid: 'c',
			action: 'mpapi_start_game',
			to: '*',
			params: { seed: 'FORGED' },
		})
		expect(rejection(step)).toBe('authoritative_only')
		expect(delivered(step)).toEqual([])
	})

	it('refuses an unregistered action sent to the server', () => {
		const step = send(lobbyWith('a', 'b'), 'a', {
			cid: 'c',
			action: 'spdrn_player_won',
			to: 'server',
			params: {},
		})
		expect(rejection(step)).toBe('not_authoritative')
	})

	it('sets ready and broadcasts the result from the server', () => {
		const step = ready(lobbyWith('a', 'b'), 'b', true)
		expect(step.lobby.game.ready).toEqual({ b: true })
		const [msg] = delivered(step)
		expect(msg.to).toEqual(['a', 'b'])
		expect(msg.payload).toEqual({
			cid: 'r-b',
			action: 'mpapi_ready',
			from: 'server',
			to: '*',
			params: { playerId: 'b', ready: true },
		})
		expect(ready(step.lobby, 'b', false).lobby.game.ready).toEqual({})
	})

	it('rejects bad ready params', () => {
		const step = send(lobbyWith('a', 'b'), 'b', {
			cid: 'c',
			action: 'mpapi_ready',
			to: 'server',
			params: { ready: 'yes' },
		})
		expect(rejection(step)).toBe('bad_params')
	})

	it('forgets ready when a player leaves or is kicked', () => {
		let lobby = ready(lobbyWith('a', 'b', 'c'), 'b', true).lobby
		lobby = ready(lobby, 'c', true).lobby
		lobby = leave(lobby, 'b').lobby
		expect(lobby.game.ready).toEqual({ c: true })
		lobby = kick(lobby, 'a', 'c').lobby
		expect(lobby.game.ready).toEqual({})
	})

	it('only lets the host start, once everyone else is ready', () => {
		let lobby = lobbyWith('a', 'b', 'c')
		expect(rejection(start(lobby, 'b'))).toBe('not_host')
		expect(rejection(start(lobby, 'a'))).toBe('not_all_ready')
		lobby = ready(lobby, 'b', true).lobby
		expect(rejection(start(lobby, 'a'))).toBe('not_all_ready')
		lobby = ready(lobby, 'c', true).lobby
		const step = start(lobby, 'a', { stake: 3, options: { deck: 'b_red' } })
		expect(rejection(step)).toBeUndefined()
		const players = ['a', 'b', 'c'].map((id) => ({ id, displayName: id }))
		expect(step.lobby.game).toEqual({
			ready: {},
			started: {
				runId: 'RUN1',
				seed: 'SEED1234',
				stake: 3,
				options: { deck: 'b_red' },
				startedAt: 1000,
				hostId: 'a',
				players,
			},
			reports: {},
			reportOrder: [],
			settleFrom: null,
			logs: {},
			presence: players.map((p) => ({ userId: p.id, kind: 'joined', at: 1000 })),
		})
		expect(delivered(step)[0].payload).toMatchObject({
			from: 'server',
			params: {
				runId: 'RUN1',
				seed: 'SEED1234',
				stake: 3,
				options: { deck: 'b_red' },
				players,
			},
		})
	})

	it('refuses player_away while any seat is away', () => {
		let lobby = lobbyWith('a', 'b', 'c')
		lobby = ready(lobby, 'b', true).lobby
		lobby = disconnect(lobby, 'c', 'c-s1', 500).lobby
		expect(rejection(start(lobby, 'a'))).toBe('player_away')
	})

	it('needs two players', () => {
		expect(rejection(start(lobbyWith('a'), 'a'))).toBe('too_few_players')
	})

	it('closes the lobby to joins after the start', () => {
		let lobby = ready(lobbyWith('a', 'b'), 'b', true).lobby
		lobby = start(lobby, 'a').lobby
		expect(rejection(start(lobby, 'a'))).toBe('in_game')
		expect(rejection(ready(lobby, 'b', true))).toBe('in_game')
		expect(joinRejection(lobby, 'z', 'MultiplayerSPDRN')).toBe(
			'The game has already started',
		)
		// Members can still rejoin after a drop.
		expect(joinRejection(lobby, 'b', 'MultiplayerSPDRN')).toBeNull()
		expect(JSON.parse(labelOf(lobby)).open).toBe(false)
	})

	it('hands the game state back in the snapshot', () => {
		let lobby = ready(lobbyWith('a', 'b'), 'b', true).lobby
		expect(snapshotFor(lobby, 'b').game.ready).toEqual({ b: true })
		lobby = start(lobby, 'a').lobby
		expect(snapshotFor(lobby, 'b').game.started?.seed).toBe('SEED1234')
	})

	it('tells clients whether the started game holds a pending result', () => {
		let lobby = ready(lobbyWith('a', 'b'), 'b', true).lobby
		lobby = start(lobby, 'a').lobby
		expect(snapshotFor(lobby, 'b').game.resultPending).toBe(false)
		lobby = { ...lobby, game: { ...lobby.game, resultPending: true } }
		expect(snapshotFor(lobby, 'b').game.resultPending).toBe(true)
	})
})

describe('seedFromHex', () => {
	it('makes a Balatro seed', () => {
		const seed = seedFromHex('9f86d081-884c-4d63-9a0e-4e7c8e9b2f1a')
		expect(seed).toHaveLength(SEED_LENGTH)
		expect(seed).toMatch(/^[1-9A-NP-Z]+$/)
	})
})

describe('action from a stranger', () => {
	it('still drops an action from a stranger', () => {
		const step = send(lobbyWith('a', 'b'), 'x', { cid: 'c1', action: 'spdrn_player_ready', to: '*' })
		expect(step.out).toEqual([])
	})
})
