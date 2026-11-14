import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import {
	type LobbyMatchState,
	lobbyMatchJoin,
	lobbyMatchLeave,
	lobbyMatchLoop,
} from './match'
import { ClientOp } from './protocol'
import { type Lobby, join, newLobby } from './state'

// Only the seat's current joined session speaks for it: a frame from a session
// that already left, or from an older one after a rejoin, is dropped unanswered.

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

const presence = (userId: string, session = 's1') => ({
	userId,
	sessionId: `${userId}-${session}`,
	username: userId,
	node: 'n',
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
		lobby = join(lobby, id, `${id}-s1`, info(id), 0).lobby
	return lobby
}

const nk = fakeNk({
	binaryToString: (b: Uint8Array) => new TextDecoder().decode(b),
}) as unknown as nkruntime.Nakama
const ctx = { ...playerCtx(''), matchId: 'm1' } as nkruntime.Context

function harness() {
	const sent: unknown[] = []
	const dispatcher = {
		broadcastMessage: (...args: unknown[]) => sent.push(args),
		matchKick: () => {},
		matchLabelUpdate: () => {},
	} as unknown as nkruntime.MatchDispatcher
	const state = {
		lobby: twoPlayerLobby(),
		presences: { a: presence('a'), b: presence('b') },
		pendingInfo: {},
		label: '',
	} as unknown as LobbyMatchState
	return { sent, dispatcher, state }
}

const frame = (
	from: ReturnType<typeof presence>,
	opCode: number,
	body: { [key: string]: unknown },
) => ({
	sender: from,
	opCode,
	data: new TextEncoder().encode(JSON.stringify(body)),
})
const readyAction = {
	cid: 'c1',
	action: 'spdrn_player_ready',
	to: '*',
	params: {},
}

function loop(
	dispatcher: nkruntime.MatchDispatcher,
	state: LobbyMatchState,
	...messages: ReturnType<typeof frame>[]
): LobbyMatchState {
	const after = lobbyMatchLoop(
		ctx,
		fakeLogger,
		nk,
		dispatcher,
		1,
		state,
		messages as never,
	)
	if (!after) throw new Error('match ended')
	return after.state
}

const awaySinceOf = (state: LobbyMatchState, id: string) =>
	state.lobby.players.find((p) => p.id === id)?.awaySince

describe('the match loop session gate', () => {
	it('drops an action from a session after its own leave, the seat stays away', () => {
		const { sent, dispatcher, state } = harness()
		const left = lobbyMatchLeave(ctx, fakeLogger, nk, dispatcher, 1, state, [
			presence('a'),
		] as never)
		const away = left?.state as LobbyMatchState
		expect(away.presences.a).toBeUndefined()
		expect(awaySinceOf(away, 'a')).not.toBeNull()
		sent.length = 0
		const after = loop(dispatcher, away, frame(presence('a'), ClientOp.ACTION, readyAction))
		expect(awaySinceOf(after, 'a')).toBe(awaySinceOf(away, 'a'))
		expect(sent).toEqual([])
	})

	it('warns once per stale session in a tick, however many frames it sent', () => {
		const { dispatcher, state } = harness()
		const left = lobbyMatchLeave(ctx, fakeLogger, nk, dispatcher, 1, state, [presence('a')] as never)
		const warns: unknown[][] = []
		const logger = { ...fakeLogger, warn: (...args: unknown[]) => warns.push(args) } as unknown as nkruntime.Logger
		const stale = frame(presence('a'), ClientOp.ACTION, readyAction)
		const other = frame(presence('a', 's0'), ClientOp.ACTION, readyAction)
		lobbyMatchLoop(ctx, logger, nk, dispatcher, 2, left?.state as LobbyMatchState, [stale, stale, stale, other] as never)
		expect(warns.map((w) => w[3])).toEqual(['a', 'a'])
		expect(warns.length).toBe(2)
	})

	describe('an old session frame after the new session joined', () => {
		const rejoined = () => {
			const { sent, dispatcher, state } = harness()
			const left = lobbyMatchLeave(ctx, fakeLogger, nk, dispatcher, 1, state, [
				presence('a'),
			] as never)
			const joined = lobbyMatchJoin(
				ctx,
				fakeLogger,
				nk,
				dispatcher,
				2,
				// What matchJoinAttempt records for a join it accepted.
				{ ...(left?.state as LobbyMatchState), pendingInfo: { a: info('a') } },
				[presence('a', 's2')] as never,
			)
			sent.length = 0
			return { sent, dispatcher, state: joined?.state as LobbyMatchState }
		}

		it('has no effect for an ACTION', () => {
			const { sent, dispatcher, state } = rejoined()
			const after = loop(dispatcher, state, frame(presence('a'), ClientOp.ACTION, readyAction))
			expect(after.lobby).toEqual(state.lobby)
			expect(sent).toEqual([])
		})

		it('has no effect for a LEAVE', () => {
			const { sent, dispatcher, state } = rejoined()
			const after = loop(dispatcher, state, frame(presence('a'), ClientOp.LEAVE, {}))
			expect(after.lobby.players.map((p) => p.id)).toEqual(['a', 'b'])
			expect(after.lobby).toEqual(state.lobby)
			expect(sent).toEqual([])
		})

		it('still serves the new session', () => {
			const { dispatcher, state } = rejoined()
			const after = loop(dispatcher, state, frame(presence('a', 's2'), ClientOp.LEAVE, {}))
			expect(after.lobby.players.map((p) => p.id)).not.toContain('a')
		})
	})
})
