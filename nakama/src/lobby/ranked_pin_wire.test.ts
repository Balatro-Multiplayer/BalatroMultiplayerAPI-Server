import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { lobbyMatchInit } from './match'
import { ServerOp } from './protocol'
import { rankedPinOf } from './pvp/ranked_pin'
import { rpcLobbyCreate } from './rpc'
import { join, newLobby, setMetadata } from './state'

const info = { displayName: 'x', preferredJoker: null, mods: null }

function rankedLobby(rankedMode: string, metadata: { [k: string]: unknown }) {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerPvP',
		maxPlayers: 2,
		creatorId: 'a',
		rankedMode,
		allowedIds: ['a', 'b'],
		metadata,
		now: 0,
		graceMs: 1000,
	})
	lobby = join(lobby, 'a', 'sa', info, 0).lobby
	return join(lobby, 'b', 'sb', info, 0).lobby
}

const pinOf = (mode: string): { [k: string]: unknown } => {
	const found = rankedPinOf(mode)
	if (!found.ok) throw new Error('no pin')
	return found.pin
}

describe('a ranked PvP lobby keeps the rules of its queue (D1b)', () => {
	it('lobbyMatchInit starts a ranked PvP lobby on its pin', () => {
		const init = lobbyMatchInit(
			playerCtx('') as never,
			fakeLogger,
			fakeNk() as never,
			{
				code: 'ABC123',
				modId: 'MultiplayerPvP',
				maxPlayers: 2,
				creatorId: 'a',
				rankedMode: 'pvp_ranked_balanced',
				allowedIds: 'a,b',
			},
		)
		expect(init.state.lobby.metadata).toEqual(pinOf('pvp_ranked_balanced'))
	})

	it('lobbyMatchInit leaves a casual lobby and another mod unpinned', () => {
		for (const params of [
			{ modId: 'MultiplayerPvP', rankedMode: '' },
			{ modId: 'MultiplayerSPDRN', rankedMode: 'duel' },
		]) {
			const init = lobbyMatchInit(
				playerCtx('') as never,
				fakeLogger,
				fakeNk() as never,
				{
					code: 'ABC123',
					maxPlayers: 2,
					creatorId: 'a',
					...params,
				},
			)
			expect(init.state.lobby.metadata).toEqual({})
		}
	})

	it('lobbyMatchInit refuses an unknown ranked PvP mode', () => {
		expect(() =>
			lobbyMatchInit(playerCtx('') as never, fakeLogger, fakeNk() as never, {
				code: 'ABC123',
				modId: 'MultiplayerPvP',
				maxPlayers: 2,
				creatorId: 'a',
				rankedMode: 'pvp_ranked_chaos',
			}),
		).toThrow(/unknown_ranked_mode/)
	})

	it('the dev lobby_create rpc refuses an unknown ranked PvP mode', () => {
		const nk = fakeNk({ matchCreate: () => 'm1.node' }) as never
		const ctx = { ...playerCtx('u1'), env: {} } as never
		expect(() =>
			rpcLobbyCreate(
				ctx,
				fakeLogger,
				nk,
				JSON.stringify({
					modId: 'MultiplayerPvP',
					rankedMode: 'pvp_ranked_chaos',
				}),
			),
		).toThrow(/unknown_ranked_mode/)
	})

	it('a host write that differs from the pin is refused per key and the rest is kept', () => {
		const lobby = rankedLobby(
			'pvp_ranked_balanced',
			pinOf('pvp_ranked_balanced'),
		)
		const step = setMetadata(lobby, 'a', {
			starting_lives: 99,
			queue_mode: 'pvp_royale',
			ruleset: 'ruleset_mp_balanced',
			deck: 'Red Deck',
		})
		expect(step.lobby.metadata).toEqual({
			...pinOf('pvp_ranked_balanced'),
			deck: 'Red Deck',
		})
		const refused = step.out
			.filter((o) => o.kind === 'send' && o.op === ServerOp.ERROR)
			.map((o) =>
				o.kind === 'send' ? (o.payload as { key?: unknown }).key : null,
			)
		expect(refused).toEqual(['starting_lives', 'queue_mode'])
	})

	it('a write that only differs is refused whole and changes nothing', () => {
		const lobby = rankedLobby('pvp_ranked_vanilla', pinOf('pvp_ranked_vanilla'))
		const step = setMetadata(lobby, 'a', { ruleset: 'ruleset_mp_chaos' })
		expect(step.lobby.metadata).toEqual(pinOf('pvp_ranked_vanilla'))
	})

	it('an honest lobby_ready patch is accepted', () => {
		const lobby = rankedLobby(
			'pvp_ranked_expanded',
			pinOf('pvp_ranked_expanded'),
		)
		const patch = {
			...pinOf('pvp_ranked_expanded'),
			deck: 'Blue Deck',
			stake: 3,
			kind: 'ranked',
		}
		expect(setMetadata(lobby, 'a', patch).lobby.metadata).toEqual(patch)
	})

	it('a casual lobby is free to set any rule', () => {
		const lobby = rankedLobby('', {})
		expect(
			setMetadata(lobby, 'a', { starting_lives: 9 }).lobby.metadata,
		).toEqual({
			starting_lives: 9,
		})
	})

	it('a live lobby on an unknown ranked mode is not enforced', () => {
		const lobby = rankedLobby('pvp_ranked_standard', {})
		expect(
			setMetadata(lobby, 'a', { starting_lives: 9 }).lobby.metadata,
		).toEqual({
			starting_lives: 9,
		})
	})
})
