import { describe, expect, it } from 'vitest'
import { ServerOp } from './protocol'
import {
	CREATOR_JOIN_TIMEOUT_MS,
	FORFEITED_SEAT,
	adminRemove,
	adminView,
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
	setMetadata,
	setCatchingUp,
	setOwnState,
	setPlayerInfo,
	tick,
} from './state'

const GRACE = 10_000
const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

function lobbyWith(...ids: string[]): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerPvP',
		maxPlayers: 4,
		creatorId: ids[0],
		now: 0,
		graceMs: GRACE,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	return lobby
}

function events(
	step: Step,
): { type: string; playerId?: string; to: string[] }[] {
	return step.out
		.filter(
			(o): o is Extract<Outbound, { kind: 'send' }> =>
				o.kind === 'send' && o.op === ServerOp.EVENT,
		)
		.map((o) => ({
			...(o.payload as { type: string; playerId?: string }),
			to: o.to,
		}))
}

function eventTypes(step: Step): string[] {
	return events(step).map((e) => e.type)
}

describe('joinRejection', () => {
	it('keeps others out until the creator has joined', () => {
		const lobby = newLobby({
			code: 'ABC123',
			modId: 'm',
			maxPlayers: 2,
			creatorId: 'a',
			now: 0,
			graceMs: GRACE,
		})
		expect(joinRejection(lobby, 'b', 'm')).toBe('Lobby is not open yet')
		expect(joinRejection(lobby, 'a', 'm')).toBeNull()
	})

	it('rejects a full lobby, the wrong mod, and kicked players, but lets members back in', () => {
		let lobby = newLobby({
			code: 'ABC123',
			modId: 'm',
			maxPlayers: 2,
			creatorId: 'a',
			now: 0,
			graceMs: GRACE,
		})
		lobby = join(lobby, 'a', 'a-s1', info('a')).lobby
		expect(joinRejection(lobby, 'b', 'other')).toBe(
			'Lobby is for a different mod',
		)
		lobby = join(lobby, 'b', 'b-s1', info('b')).lobby
		expect(joinRejection(lobby, 'c', 'm')).toBe('Lobby is full')
		expect(joinRejection(lobby, 'b', 'm')).toBeNull()
		lobby = kick(lobby, 'a', 'b').lobby
		expect(joinRejection(lobby, 'b', 'm')).toBe(
			'You were kicked from this lobby',
		)
	})

	it('refuses a member rejoining from another mod', () => {
		let lobby = newLobby({
			code: 'ABC123',
			modId: 'MultiplayerPvP',
			maxPlayers: 2,
			creatorId: 'a',
			now: 0,
			graceMs: GRACE,
		})
		lobby = join(lobby, 'a', 'a-s1', info('a')).lobby
		expect(joinRejection(lobby, 'a', 'MultiplayerSPDRN')).toBe('Lobby is for a different mod')
		expect(joinRejection(lobby, 'a', '')).toBe('Lobby is for a different mod')
		expect(joinRejection(lobby, 'a', 'MultiplayerPvP')).toBeNull()
	})
})

describe('matchmade lobbies', () => {
	const made = () =>
		newLobby({
			code: 'ABCDE',
			modId: 'm',
			maxPlayers: 2,
			creatorId: 'a',
			rankedMode: 'mode',
			allowedIds: ['a', 'b'],
			now: 0,
			graceMs: GRACE,
		})

	it('seats only the matched players, in any order', () => {
		const lobby = made()
		expect(joinRejection(lobby, 'b', 'm')).toBeNull()
		expect(joinRejection(lobby, 'x', 'm')).toBe(
			'This lobby is reserved for matched players',
		)
	})

	it('makes whoever arrives first the host and reports the lobby as ranked', () => {
		const lobby = join(made(), 'b', 'b-s1', info('b')).lobby
		expect(lobby.hostId).toBe('b')
		expect(snapshotFor(lobby, 'b').type).toBe('ranked')
		expect(snapshotFor(lobbyWith('a'), 'a').type).toBe('private')
	})

	it('tells the joiner how long the server holds a dropped seat, in seconds', () => {
		const lobby = newLobby({ code: 'ABC123', modId: 'm', maxPlayers: 2, creatorId: 'a', now: 0, graceMs: 30_000 })
		expect(snapshotFor(lobby, 'a').graceSeconds).toBe(30)
	})
})

describe('join', () => {
	it('sends the joiner a snapshot and tells the others', () => {
		const lobby = lobbyWith('a')
		const step = join(lobby, 'b', 'b-s1', info('b'))
		const snapshot = step.out.find(
			(o) => o.kind === 'send' && o.op === ServerOp.SNAPSHOT,
		)
		expect(snapshot).toMatchObject({
			to: ['b'],
			payload: {
				code: 'ABC123',
				hostId: 'a',
				players: [{ id: 'a' }, { id: 'b' }],
			},
		})
		expect(events(step)).toEqual([
			expect.objectContaining({
				type: 'player_joined',
				playerId: 'b',
				to: ['a'],
			}),
		])
		expect(step.out).toContainEqual({ kind: 'setCurrent', userId: 'b' })
		expect(JSON.parse(labelOf(step.lobby))).toMatchObject({
			code: 'ABC123',
			size: 2,
			open: true,
		})
	})
})

describe('labelOf', () => {
	it('labels a code lobby private, not started, and not spectatable', () => {
		expect(JSON.parse(labelOf(lobbyWith('a', 'b')))).toMatchObject({
			type: 'private',
			mode: '',
			started: false,
			spectatable: false,
			spectators: 0,
		})
	})
	it('labels a matchmade lobby public with its queue, and spectatable', () => {
		const lobby = { ...lobbyWith('a', 'b'), allowedIds: ['a', 'b'], gameMode: 'ranked:x', spectators: ['c'] }
		expect(JSON.parse(labelOf(lobby))).toMatchObject({
			type: 'public',
			mode: 'ranked:x',
			spectatable: true,
			spectators: 1,
		})
	})
	it('marks a private lobby spectatable when its host allows it, and started once a game runs', () => {
		const base = lobbyWith('a', 'b')
		const lobby = { ...base, metadata: { spectatable: true }, game: { ...base.game, started: { at: 1 } as any } }
		expect(JSON.parse(labelOf(lobby))).toMatchObject({ spectatable: true, started: true, open: false })
	})
})

describe('leave', () => {
	it('removes the player, passes host on in join order, and kicks the presence', () => {
		const step = leave(lobbyWith('a', 'b', 'c'), 'a')
		expect(step.lobby.hostId).toBe('b')
		expect(step.lobby.players.map((p) => p.id)).toEqual(['b', 'c'])
		expect(eventTypes(step)).toEqual(['player_left', 'host_changed'])
		expect(events(step)[0].to).toEqual(['b', 'c'])
		expect(step.out).toContainEqual({ kind: 'kick', userId: 'a' })
		expect(step.out).toContainEqual({ kind: 'clearCurrent', userId: 'a' })
	})

	it('closes the lobby when the last player leaves', () => {
		const step = leave(lobbyWith('a'), 'a')
		expect(step.lobby.closed).toBe(true)
	})

	it('skips away players when passing host on', () => {
		let lobby = lobbyWith('a', 'b', 'c')
		lobby = disconnect(lobby, 'b', 'b-s1', 1).lobby
		expect(leave(lobby, 'a').lobby.hostId).toBe('c')
	})
})

describe('disconnect and grace period', () => {
	it('marks the player away, moves host on at once, and restores them on rejoin', () => {
		let lobby = lobbyWith('a', 'b')
		lobby = setOwnState(lobby, 'a', { seat: 1 }).lobby
		const dropped = disconnect(lobby, 'a', 'a-s1', 1000)
		expect(eventTypes(dropped)).toEqual(['player_disconnected', 'host_changed'])
		expect(dropped.lobby.hostId).toBe('b')
		expect(dropped.lobby.players[0].awaySince).toBe(1000)

		const back = join(dropped.lobby, 'a', 'a-s2', info('a'))
		expect(eventTypes(back)).toEqual(['player_reconnected'])
		expect(back.lobby.players[0]).toMatchObject({
			awaySince: null,
			sessionId: 'a-s2',
		})
		const snapshot = back.out.find(
			(o) => o.kind === 'send' && o.op === ServerOp.SNAPSHOT,
		)
		expect(snapshot).toMatchObject({
			payload: { ownState: { seat: 1 }, hostId: 'b' },
		})
	})

	it("sends a rejoining participant the others' logs of the running game", () => {
		const lobby = lobbyWith('a', 'b')
		const started = {
			...lobby,
			game: {
				...lobby.game,
				started: { runId: 'r1', players: [{ id: 'a' }, { id: 'b' }] } as any,
				logs: {
					a: { lines: ['[1,"hand_result",["10",3]]'], bytes: 0, truncated: false },
					b: { lines: ['[2,"hand_result",["50",2]]'], bytes: 0, truncated: false },
				},
			},
		}
		const back = join(disconnect(started, 'a', 'a-s1', 1000).lobby, 'a', 'a-s2', info('a'))
		const tail = back.out.find((o) => o.kind === 'send' && o.op === ServerOp.REPLAY_TAIL)
		expect(tail).toEqual({
			kind: 'send',
			op: ServerOp.REPLAY_TAIL,
			payload: { runId: 'r1', tails: [{ playerId: 'b', events: [{ t: 2, opcode: 'hand_result', args: ['50', 2] }] }] },
			to: ['a'],
		})
		// Not on a plain re-join, and not with no game running.
		expect(join(started, 'a', 'a-s2', info('a')).out.some((o) => o.kind === 'send' && o.op === ServerOp.REPLAY_TAIL)).toBe(false)
		const idle = join(disconnect(lobby, 'a', 'a-s1', 1000).lobby, 'a', 'a-s2', info('a'))
		expect(idle.out.some((o) => o.kind === 'send' && o.op === ServerOp.REPLAY_TAIL)).toBe(false)
	})

	it("ignores a stale session's leave after the player already rejoined", () => {
		let lobby = lobbyWith('a', 'b')
		lobby = join(lobby, 'b', 'b-s2', info('b')).lobby
		const step = disconnect(lobby, 'b', 'b-s1', 1000)
		expect(step.out).toEqual([])
		expect(step.lobby.players[1].awaySince).toBeNull()
	})

	it('drops an away player once the grace period runs out', () => {
		let lobby = lobbyWith('a', 'b')
		lobby = disconnect(lobby, 'b', 'b-s1', 1000).lobby
		expect(tick(lobby, 1000 + GRACE - 1).out).toEqual([])
		const expired = tick(lobby, 1000 + GRACE)
		expect(eventTypes(expired)).toEqual(['player_left'])
		expect(expired.lobby.players.map((p) => p.id)).toEqual(['a'])
	})

	describe('a seat forfeited by the grace period', () => {
		const running = () => {
			const lobby = lobbyWith('a', 'b')
			return {
				...lobby,
				game: { ...lobby.game, started: { runId: 'r1', players: [{ id: 'a' }, { id: 'b' }] } as any },
			}
		}
		const forfeitB = (lobby: Lobby) => tick(disconnect(lobby, 'b', 'b-s1', 1000).lobby, 1000 + GRACE).lobby

		it('refuses the player back with a forfeit reason while the game runs', () => {
			const lobby = forfeitB(running())
			expect(joinRejection(lobby, 'b', 'MultiplayerPvP')).toBe(FORFEITED_SEAT)
		})

		it('still refuses them once the game has ended and the lobby is a waiting room again', () => {
			const lobby = forfeitB(running())
			const ended = { ...lobby, game: { ...lobby.game, started: null } }
			expect(joinRejection(ended, 'b', 'MultiplayerPvP')).toBe(FORFEITED_SEAT)
		})

		it('does not refuse a seat lost outside a game, or another player', () => {
			const idle = forfeitB(lobbyWith('a', 'b'))
			expect(joinRejection(idle, 'b', 'MultiplayerPvP')).toBeNull()
			const lobby = forfeitB(running())
			expect(joinRejection(lobby, 'a', 'MultiplayerPvP')).toBeNull()
		})

		it('forgets the forfeit when a new game has started', () => {
			const lobby = forfeitB(running())
			const next = { ...lobby, game: { ...lobby.game, started: { runId: 'r2', players: [{ id: 'a' }] } as any } }
			expect(joinRejection(next, 'b', 'MultiplayerPvP')).toBe('The game has already started')
		})
	})

	it('closes the lobby straight away once nobody is connected', () => {
		let lobby = lobbyWith('a', 'b')
		lobby = disconnect(lobby, 'b', 'b-s1', 1000).lobby
		const step = disconnect(lobby, 'a', 'a-s1', 2000)
		expect(step.lobby.closed).toBe(true)
		expect(eventTypes(step)).toContain('lobby_closed')
		expect(step.out).toContainEqual({ kind: 'clearCurrent', userId: 'a' })
		expect(step.out).toContainEqual({ kind: 'clearCurrent', userId: 'b' })
	})
})

describe('a started match with every seat away', () => {
	const running = () => {
		const lobby = lobbyWith('a', 'b')
		return {
			...lobby,
			game: { ...lobby.game, started: { runId: 'r1', players: [{ id: 'a' }, { id: 'b' }] } as any },
		}
	}

	it('stays open while a seat is within its grace, and closes when the last grace runs out', () => {
		let lobby = disconnect(running(), 'b', 'b-s1', 1000).lobby
		lobby = disconnect(lobby, 'a', 'a-s1', 2000).lobby
		expect(lobby.closed).toBe(false)
		const midway = tick(lobby, 1000 + GRACE)
		expect(midway.lobby.closed).toBe(false)
		expect(midway.lobby.players.map((p) => p.id)).toEqual(['a'])
		const last = tick(midway.lobby, 2000 + GRACE)
		expect(last.lobby.closed).toBe(true)
		expect(eventTypes(last)).toContain('lobby_closed')
	})

	it('lets the last seat rejoin after the other seat forfeited, and that seat holds the match', () => {
		let lobby = disconnect(running(), 'a', 'a-s1', 1000).lobby
		lobby = tick(lobby, 1000 + GRACE).lobby
		lobby = disconnect(lobby, 'b', 'b-s1', 1000 + GRACE).lobby
		expect(lobby.closed).toBe(false)
		expect(lobby.forfeitedSeats).toEqual({ a: 'r1' })
		lobby = join(lobby, 'b', 'b-s2', info('b')).lobby
		expect(lobby.closed).toBe(false)
		expect(lobby.players.map((p) => [p.id, p.awaySince])).toEqual([['b', null]])
		expect(tick(lobby, 1000 + GRACE + 5000).lobby.closed).toBe(false)
	})

	it('stays open when the last seat leaves for good while the other is within its grace', () => {
		let lobby = disconnect(running(), 'b', 'b-s1', 1000).lobby
		lobby = leave(lobby, 'a').lobby
		expect(lobby.closed).toBe(false)
		expect(tick(lobby, 1000 + GRACE).lobby.closed).toBe(true)
	})

	it('still closes at once when the match has not started', () => {
		let lobby = disconnect(lobbyWith('a', 'b'), 'b', 'b-s1', 1000).lobby
		lobby = disconnect(lobby, 'a', 'a-s1', 2000).lobby
		expect(lobby.closed).toBe(true)
	})
})

describe('kick', () => {
	it('is host only and never targets the host', () => {
		const lobby = lobbyWith('a', 'b')
		expect(kick(lobby, 'b', 'a').out).toEqual([
			{
				kind: 'send',
				op: ServerOp.ERROR,
				payload: { message: 'Only the host can kick players' },
				to: ['b'],
			},
		])
		expect(kick(lobby, 'a', 'a').lobby).toBe(lobby)
	})

	it('refuses the host of a matchmade lobby', () => {
		const lobby = { ...lobbyWith('a', 'b'), allowedIds: ['a', 'b'] }
		const step = kick(lobby, 'a', 'b')
		expect(step.lobby).toBe(lobby)
		expect(step.out).toEqual([
			{
				kind: 'send',
				op: ServerOp.ERROR,
				payload: { message: 'Players cannot be kicked from a matchmade lobby' },
				to: ['a'],
			},
		])
	})

	it('tells everyone, the target included, then removes and kicks them', () => {
		const step = kick(lobbyWith('a', 'b', 'c'), 'a', 'b')
		expect(events(step)).toEqual([
			expect.objectContaining({
				type: 'player_kicked',
				playerId: 'b',
				to: ['a', 'b', 'c'],
			}),
		])
		expect(step.lobby.players.map((p) => p.id)).toEqual(['a', 'c'])
		expect(step.lobby.kickedIds).toEqual(['b'])
		expect(step.out).toContainEqual({ kind: 'kick', userId: 'b' })
	})
})

describe('adminRemove', () => {
	it('kicks a player for the server, who may not come back', () => {
		const step = adminRemove(lobbyWith('a', 'b'), 'b', 'banned')
		expect(events(step)).toEqual([
			expect.objectContaining({ type: 'player_kicked', playerId: 'b', data: { kickedBy: 'server', reason: 'banned' } }),
		])
		expect(step.lobby.kickedIds).toEqual(['b'])
		expect(step.out).toContainEqual({ kind: 'kick', userId: 'b' })
		expect(joinRejection(step.lobby, 'b', 'MultiplayerPvP')).toBeTruthy()
	})
	it('can leave a player alone until a game runs', () => {
		const lobby = lobbyWith('a', 'b')
		expect(adminRemove(lobby, 'b', 'banned', true).lobby).toBe(lobby)
		const started = { ...lobby, game: { ...lobby.game, started: { at: 1 } as any } }
		expect(adminRemove(started, 'b', 'banned', true).lobby.kickedIds).toEqual(['b'])
	})
	it('ignores a player not in the lobby', () => {
		const lobby = lobbyWith('a')
		expect(adminRemove(lobby, 'z', 'x')).toEqual({ lobby, out: [] })
	})
})

describe('adminView', () => {
	it('lists the seated players for webadmin', () => {
		expect(adminView(lobbyWith('a', 'b'))).toMatchObject({
			code: 'ABC123',
			hostId: 'a',
			started: false,
			players: [
				{ id: 'a', displayName: 'a', connected: true },
				{ id: 'b', displayName: 'b', connected: true },
			],
		})
	})
})

describe('setMetadata', () => {
	it('shallow-merges host updates and broadcasts them', () => {
		let lobby = lobbyWith('a', 'b')
		lobby = setMetadata(lobby, 'a', { ruleset: 'standard', stake: 1 }).lobby
		const step = setMetadata(lobby, 'a', { stake: 2 })
		expect(step.lobby.metadata).toEqual({ ruleset: 'standard', stake: 2 })
		expect(step.out[0]).toMatchObject({
			op: ServerOp.METADATA,
			payload: { ruleset: 'standard', stake: 2 },
			to: ['a', 'b'],
		})
		expect(eventTypes(step)).toEqual(['metadata_changed'])
	})

	it('refuses non-hosts and non-objects', () => {
		const lobby = lobbyWith('a', 'b')
		expect(setMetadata(lobby, 'b', { x: 1 }).lobby).toBe(lobby)
		expect(setMetadata(lobby, 'a', [1, 2]).lobby).toBe(lobby)
	})
})

describe('tick', () => {
	it('closes a lobby its creator never joined', () => {
		const lobby = newLobby({
			code: 'ABC123',
			modId: 'm',
			maxPlayers: 2,
			creatorId: 'a',
			now: 0,
			graceMs: GRACE,
		})
		expect(tick(lobby, CREATOR_JOIN_TIMEOUT_MS - 1).lobby.closed).toBe(false)
		expect(tick(lobby, CREATOR_JOIN_TIMEOUT_MS).lobby.closed).toBe(true)
	})
})

describe('setPlayerInfo', () => {
	it('updates the player and tells everyone, the player too', () => {
		const step = setPlayerInfo(lobbyWith('a', 'b'), 'b', { displayName: 'Bee', preferredJoker: 'j_mime' })
		expect(step.lobby.players.find((p) => p.id === 'b')!.info).toEqual({ displayName: 'Bee', preferredJoker: 'j_mime', mods: null })
		expect(step.out).toEqual([
			{
				kind: 'send',
				op: ServerOp.PLAYER_INFO,
				payload: { playerId: 'b', info: { displayName: 'Bee', preferredJoker: 'j_mime', mods: null } },
				to: ['a', 'b'],
			},
		])
	})

	it('ignores players not in the lobby', () => {
		const lobby = lobbyWith('a')
		expect(setPlayerInfo(lobby, 'z', { displayName: 'Z' })).toEqual({ lobby, out: [] })
	})
})

describe('catching up', () => {
	const snapshotOf = (step: Step) =>
		step.out.find((o) => o.kind === 'send' && o.op === ServerOp.SNAPSHOT) as
			| { payload: { players: { id: string; catchingUp: boolean }[] } }
			| undefined

	it('tells the others, and marks the player in every snapshot', () => {
		const lobby = lobbyWith('a', 'b')
		const step = setCatchingUp(lobby, 'b', true, 5000)
		expect(events(step)).toMatchObject([
			{ type: 'player_catching_up', playerId: 'b', data: { catchingUp: true }, to: ['a'] },
		])
		const later = join(step.lobby, 'a', 'a-s2', info('a'))
		expect(snapshotOf(later)?.payload.players.map((p) => [p.id, p.catchingUp])).toEqual([
			['a', false],
			['b', true],
		])
	})

	it('clears the mark and tells the others when the player has caught up', () => {
		let lobby = setCatchingUp(lobbyWith('a', 'b'), 'b', true, 5000).lobby
		const step = setCatchingUp(lobby, 'b', false, 9000)
		expect(events(step)).toMatchObject([
			{ type: 'player_catching_up', playerId: 'b', data: { catchingUp: false }, to: ['a'] },
		])
		expect(step.lobby.players[1].catchingUpSince).toBeNull()
	})

	it('keeps the time the player started catching up, and says nothing twice', () => {
		const first = setCatchingUp(lobbyWith('a', 'b'), 'b', true, 5000)
		const again = setCatchingUp(first.lobby, 'b', true, 8000)
		expect(again.out).toEqual([])
		expect(again.lobby.players[1].catchingUpSince).toBe(5000)
		expect(setCatchingUp(lobbyWith('a', 'b'), 'b', false, 8000).out).toEqual([])
	})

	it('ignores a player who is not seated', () => {
		const lobby = lobbyWith('a', 'b')
		expect(setCatchingUp(lobby, 'zz', true, 1)).toEqual({ lobby, out: [] })
	})

	it('starts again from not catching up when the player joins a new session', () => {
		let lobby = setCatchingUp(lobbyWith('a', 'b'), 'b', true, 1000).lobby
		lobby = disconnect(lobby, 'b', 'b-s1', 2000).lobby
		const back = join(lobby, 'b', 'b-s2', info('b'))
		// The new session reports again: a join starts from "not catching up".
		expect(back.lobby.players[1].catchingUpSince).toBeNull()
		expect(snapshotOf(back)?.payload.players.map((p) => p.catchingUp)).toEqual([false, false])
		// The others hear the badge go, as well as the reconnect.
		expect(eventTypes(back)).toEqual(['player_reconnected', 'player_catching_up'])
	})
})
