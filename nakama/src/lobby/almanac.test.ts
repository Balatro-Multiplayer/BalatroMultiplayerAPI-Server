import { describe, expect, it } from 'vitest'
import { DECK_ANTES, almanacAction } from './almanac'
import { checkpointOf, resumeFrom } from './checkpoint'
import { ServerOp } from './protocol'
import { action } from './relay'
import { type Lobby, join, newLobby, snapshotFor } from './state'

function present<T>(value: T | undefined | null): T {
	if (value === undefined || value === null)
		throw Error('Expected fixture value')
	return value
}
function state(lobby: Lobby) {
	return present(lobby.almanac)
}

function fixture(): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerPvP',
		maxPlayers: 2,
		creatorId: 'a',
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ['a', 'b'])
		lobby = join(lobby, id, id, {
			displayName: id,
			preferredJoker: null,
			mods: null,
		}).lobby
	return {
		...lobby,
		metadata: { ruleset: 'ruleset_mp_almanac', kind: 'private' },
		game: {
			...lobby.game,
			started: {
				runId: 'RUN',
				seed: 'SEED',
				stake: 1,
				options: null,
				startedAt: 0,
				hostId: 'a',
				players: [
					{ id: 'a', displayName: 'a' },
					{ id: 'b', displayName: 'b' },
				],
			},
		},
	}
}
function send(lobby: Lobby, player: string, key: string, params: unknown) {
	return action(
		lobby,
		player,
		{ cid: '', action: key, to: '*', params },
		{
			now: 100,
			newSeed: () => 'SEED',
			newId: () => 'RUN',
			random: () => {
				throw Error('no global RNG')
			},
		},
	)
}
function open(lobby: Lobby, player: string, ante: number) {
	return send(lobby, player, 'pvp_almanac_open', { ante })
}
function pick(lobby: Lobby, player: string, ante: number, deck: string) {
	return send(lobby, player, 'pvp_almanac_pick', {
		id: state(lobby).offers[ante].id,
		ante,
		deck,
	})
}

describe('Almanac deck ledger through the real relay', () => {
	it('shares three offers at every milestone, excluding both divergent acquisition histories', () => {
		let lobby = fixture()
		for (const ante of [2, 3, 5, 7]) {
			lobby = open(lobby, 'b', ante).lobby
			const offer = state(lobby).offers[ante]
			expect(offer.choices).toHaveLength(3)
			expect(new Set(offer.choices).size).toBe(3)
			for (const deck of offer.choices) {
				expect(DECK_ANTES[deck]).toBeLessThanOrEqual(ante)
				for (const owned of Object.values(state(lobby).acquired))
					expect(owned).not.toContain(deck)
			}
			const again = open(lobby, 'a', ante)
			expect(again.lobby.almanac).toEqual(lobby.almanac)
			lobby = pick(lobby, 'a', ante, offer.choices[0]).lobby
			lobby = pick(lobby, 'b', ante, offer.choices[1]).lobby
		}
		expect(state(lobby).acquired.a).toHaveLength(4)
		expect(state(lobby).acquired.b).toHaveLength(4)
	})
	it('preserves identical picks and refuses advancement until both players lock', () => {
		let lobby = open(fixture(), 'a', 2).lobby
		const deck = state(lobby).offers[2].choices[0]
		lobby = pick(lobby, 'a', 2, deck).lobby
		expect(open(lobby, 'a', 3).out[0]).toMatchObject({
			op: ServerOp.ACTION_REJECTED,
		})
		lobby = pick(lobby, 'b', 2, deck).lobby
		expect(state(lobby).acquired).toEqual({ a: [deck], b: [deck] })
		expect(state(open(lobby, 'a', 3).lobby).offers[3].choices).not.toContain(
			deck,
		)
	})
	it('returns the locked choice on retries without granting twice or disclosing the opponent pick', () => {
		let lobby = open(fixture(), 'a', 2).lobby
		const choices = state(lobby).offers[2].choices
		lobby = pick(lobby, 'a', 2, choices[0]).lobby
		const again = pick(lobby, 'a', 2, choices[1])
		expect(again.lobby.almanac).toEqual(lobby.almanac)
		const guest = open(lobby, 'b', 2)
		expect(guest.out[0]).toMatchObject({
			payload: { params: { picked: undefined } },
		})
		expect(JSON.stringify(snapshotFor(lobby, 'b'))).not.toContain('"almanac"')
		expect(again.out[0]).toMatchObject({
			to: ['a'],
			payload: { params: { picked: choices[0] } },
		})
	})
	it('keeps offers and commitments through a serialized checkpoint and host migration', () => {
		let lobby = open(fixture(), 'a', 2).lobby
		const deck = state(lobby).offers[2].choices[0]
		lobby = pick(lobby, 'a', 2, deck).lobby
		const checkpoint = present(checkpointOf(lobby, 100))
		lobby = resumeFrom(JSON.parse(JSON.stringify(checkpoint)), 5_000)
		lobby = { ...lobby, hostId: 'b' }
		const sync = open(lobby, 'a', 2)
		expect(sync.lobby.almanac).toEqual(checkpoint.lobby.almanac)
		expect(
			sync.out.find((out) => out.kind === 'send' && out.op === ServerOp.ACTION),
		).toMatchObject({ payload: { from: 'b', params: { picked: deck } } })
	})
	it('rejects forged offers, stale IDs, unoffered decks, skipped milestones and non-Almanac games', () => {
		const lobby = open(fixture(), 'a', 2).lobby
		const attempts = [
			send(lobby, 'a', 'pvp_almanac_offer', {}),
			send(lobby, 'a', 'pvp_almanac_pick', {
				ante: 2,
				id: 'wrong',
				deck: 'b_red',
			}),
			pick(lobby, 'a', 2, 'b_plasma'),
			open(lobby, 'a', 4),
			open(fixture(), 'a', 7),
			open({ ...fixture(), metadata: {} }, 'a', 2),
			open({ ...fixture(), rankedMode: 'pvp_ranked_expanded' }, 'a', 2),
		]
		for (const attempt of attempts)
			expect(attempt.out[0]).toMatchObject({ op: ServerOp.ACTION_REJECTED })
		expect(almanacAction(lobby, 'a', 'ordinary_action', {})).toBeNull()
	})
	it('starts a new ledger after rematch without changing the previous game', () => {
		const lobby = open(fixture(), 'a', 2).lobby
		const next = {
			...lobby,
			game: {
				...lobby.game,
				started: { ...present(lobby.game.started), runId: 'NEXT' },
			},
		}
		const restarted = open(next, 'a', 2).lobby
		expect(state(restarted).run).toBe('NEXT')
		expect(state(restarted).acquired).toEqual({ a: [], b: [] })
		expect(state(lobby).run).toBe('RUN')
	})
})
