import { describe, expect, it } from 'vitest'
import { checkpointOf, resumeFrom } from './checkpoint'
import { ServerOp } from './protocol'
import { action } from './relay'
import { RULE_ANTES, sharedRulesTick } from './shared_rules'
import { type Lobby, type Step, join, newLobby, snapshotFor } from './state'

function fixture(): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerPvP',
		maxPlayers: 2,
		creatorId: 'a',
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ['a', 'b']) {
		lobby = join(lobby, id, `${id}-session`, {
			displayName: id,
			preferredJoker: null,
			mods: null,
		}).lobby
	}
	return {
		...lobby,
		metadata: { shared_pvp_rules: true, kind: 'private' },
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
function send(
	lobby: Lobby,
	from: string,
	key: string,
	params: unknown = {},
	now = 100,
): Step {
	return action(
		lobby,
		from,
		{ cid: 'test', action: key, to: '*', params },
		{
			now,
			newSeed: () => 'SEED',
			newId: () => 'RUN',
			random: () => {
				throw Error('No global RNG')
			},
		},
	)
}
function open(lobby = fixture(), ante = 3): Step {
	return send(lobby, 'a', 'pvp_rules_open', { ante, first_player: 'b' })
}
function present<T>(value: T | undefined | null): T {
	if (value === undefined || value === null)
		throw Error('Expected fixture value')
	return value
}
function state(lobby: Lobby) {
	return present(lobby.sharedRules)
}
function params(
	step: Step,
	index = 0,
): {
	ms_left?: number
	locked?: boolean
	first_player?: string
	shared_rules?: { rules: string[] }
} {
	const messages = step.out.filter(
		(out) => out.kind === 'send' && out.op === ServerOp.ACTION,
	)
	return (messages[index] as { payload: { params: ReturnType<typeof params> } })
		.payload.params
}
function pick(lobby: Lobby, player: string, key?: string, now = 200): Step {
	return send(
		lobby,
		player,
		'pvp_rules_pick',
		{
			id: state(lobby).id,
			rule: key || state(lobby).offers[player][0],
		},
		now,
	)
}
describe('shared PvP rules through the real relay', () => {
	it('retains the release round envelope across timeout, checkpoint and rejoin', () => {
		const opened = send(fixture(), 'a', 'pvp_rules_open', {
			ante: 3,
			first_player: 'b',
			round_id: 'RUN:round:2',
			starting_hands: { a: 5, b: 3 },
		}).lobby
		const restored = resumeFrom(present(checkpointOf(opened, 1_000)), 5_000)
		const done = sharedRulesTick(restored, 15_000)
		expect(params(done)).toMatchObject({
			round_id: 'RUN:round:2',
			starting_hands: { a: 5, b: 3 },
		})
		expect(params(done)).toEqual(params(done, 1))
		const sync = send(done.lobby, 'b', 'pvp_rules_sync', {}, 16_000)
		expect(params(sync)).toEqual(params(done))
	})
	it('offers four distinct ante-eligible rules to each player privately', () => {
		const step = open()
		expect(step.out).toHaveLength(2)
		expect(step.out.map((out) => out.kind === 'send' && out.to)).toEqual([
			['a'],
			['b'],
		])
		for (const offer of Object.values(state(step.lobby).offers)) {
			expect(new Set(offer).size).toBe(4)
			expect(offer.every((key) => RULE_ANTES[key] === 3)).toBe(true)
		}
		expect(params(step).ms_left).toBe(10_000)
		expect(JSON.stringify(snapshotFor(step.lobby, 'a'))).not.toContain(
			'sharedRules',
		)
	})
	it('drafts twice in one ante using round identity and rejects retired rounds', () => {
		const request = (lobby: Lobby, round: string) =>
			send(lobby, 'a', 'pvp_rules_open', {
				ante: 3,
				first_player: 'a',
				round_id: round,
			})
		let lobby = request(fixture(), 'round-one').lobby
		const first = state(lobby).id
		lobby = sharedRulesTick(lobby, 11_000).lobby
		const second = request(lobby, 'round-two').lobby
		expect(state(second).id).not.toBe(first)
		expect(state(second).rules).toBeUndefined()
		expect(request(second, 'round-two').lobby.sharedRules).toEqual(
			second.sharedRules,
		)
		const stale = request(second, 'round-one')
		expect(stale.out[0]).toMatchObject({ op: ServerOp.ACTION_REJECTED })
		expect(stale.lobby.sharedRules).toEqual(second.sharedRules)
	})
	it('does not leak a locked pick or start either blind early', () => {
		const step = pick(open().lobby, 'a')
		expect(step.out).toHaveLength(1)
		expect(params(step).locked).toBe(true)
		expect(params(step)).not.toHaveProperty('rule')
		expect(state(step.lobby).rules).toBeUndefined()
	})
	it('locks choices once and rejects stale or unoffered selections', () => {
		const lobby = open().lobby
		expect(state(pick(lobby, 'a', 'needle').lobby).picks).toEqual({})
		const locked = pick(lobby, 'a').lobby
		expect(pick(locked, 'a').lobby.sharedRules).toEqual(locked.sharedRules)
		const stale = send(lobby, 'b', 'pvp_rules_pick', {
			id: 'OLD',
			rule: 'manacle',
		})
		expect(state(stale.lobby).picks).toEqual({})
	})
	it('resolves distinct choices identically for both players', () => {
		let lobby = open().lobby
		const a = state(lobby).offers.a[0]
		const b = present(state(lobby).offers.b.find((key) => key !== a))
		lobby = pick(lobby, 'a', a).lobby
		const step = pick(lobby, 'b', b)
		expect(state(step.lobby).rules).toEqual([a, b])
		expect(params(step)).toEqual(params(step, 1))
		expect(params(step).first_player).toBe('b')
	})
	it('matching choices keep that rule and roll a distinct eligible wildcard', () => {
		const initial = open().lobby
		const initialState = state(initial)
		// Force a shared offered rule to test duplicate resolution independently of offer luck.
		const lobby = {
			...initial,
			sharedRules: {
				...initialState,
				offers: {
					a: ['manacle', 'psychic', 'house'],
					b: ['manacle', 'club', 'arm'],
				},
			},
		}
		const step = pick(pick(lobby, 'a', 'manacle').lobby, 'b', 'manacle')
		const rules = present(state(step.lobby).rules)
		expect(rules[0]).toBe('manacle')
		expect(rules[1]).not.toBe('manacle')
		expect(RULE_ANTES[rules[1]]).toBe(3)
	})
	it('times out at exactly ten seconds, preserving existing picks and never rerolling', () => {
		const lobby = pick(open().lobby, 'a').lobby
		expect(sharedRulesTick(lobby, 10_099).out).toHaveLength(0)
		const step = sharedRulesTick(lobby, 10_100)
		expect(state(step.lobby).picks.a).toBe(state(lobby).picks.a)
		expect(state(step.lobby).offers.b).toContain(state(step.lobby).picks.b)
		expect(sharedRulesTick(step.lobby, 20_000).out).toHaveLength(0)
		expect(sharedRulesTick(lobby, 10_100)).toEqual(step)
		expect(pick(lobby, 'b', undefined, 10_100)).toMatchObject(step)
	})
	it('supports ante gates without compatibility exclusions', () => {
		expect(
			Object.keys(RULE_ANTES).filter((key) => RULE_ANTES[key] <= 3),
		).toHaveLength(10)
		expect(
			Object.keys(RULE_ANTES).filter((key) => RULE_ANTES[key] <= 4),
		).toHaveLength(11)
		expect(
			Object.keys(RULE_ANTES).filter((key) => RULE_ANTES[key] <= 5),
		).toHaveLength(14)
		expect(Object.keys(RULE_ANTES)).not.toContain('needle')
		const initial = open(fixture(), 5).lobby
		const lobby = {
			...initial,
			sharedRules: {
				...state(initial),
				offers: { a: ['plant', 'club', 'water'], b: ['club', 'plant', 'hook'] },
			},
		}
		expect(
			state(pick(pick(lobby, 'a', 'plant').lobby, 'b', 'club').lobby).rules,
		).toEqual(['plant', 'club'])
	})
	it('persists private offers/locks through server checkpoints and shifts the deadline by downtime', () => {
		const lobby = pick(open().lobby, 'a').lobby
		const checkpoint = present(checkpointOf(lobby, 1_000))
		const restored = resumeFrom(checkpoint, 5_000)
		expect(state(restored).offers).toEqual(state(lobby).offers)
		expect(state(restored).picks).toEqual(state(lobby).picks)
		expect(state(restored).deadline).toBe(14_100)
		const sync = send(restored, 'a', 'pvp_rules_sync', {}, 5_100)
		expect(params(sync).locked).toBe(true)
		expect(params(sync).ms_left).toBe(9_000)
	})
	it('resends the same resolution on rejoin, stamped with the current host', () => {
		const done = sharedRulesTick(open().lobby, 11_000).lobby
		const migrated = { ...done, hostId: 'b' }
		const sync = send(migrated, 'a', 'pvp_rules_sync', {}, 12_000)
		expect(present(params(sync).shared_rules).rules).toEqual(state(done).rules)
		expect(sync.out[0]).toMatchObject({ to: ['a'], payload: { from: 'b' } })
	})
	it('rejects guests opening drafts, forged offers, early antes and disabled/public games', () => {
		const lobby = fixture()
		const attempts = [
			send(lobby, 'b', 'pvp_rules_open', { ante: 3, first_player: 'a' }),
			send(lobby, 'a', 'pvp_rules_offer', {}),
			open(lobby, 2),
			open({ ...lobby, metadata: {} }),
			open({ ...lobby, rankedMode: 'ranked:pvp_nemesis' }),
			open({ ...lobby, gameMode: 'pvp_nemesis' }),
		]
		for (const step of attempts) {
			expect(step.lobby.sharedRules).toBeUndefined()
			expect(step.out[0]).toMatchObject({ op: ServerOp.ACTION_REJECTED })
		}
	})
	it('idempotently reopens the same encounter without extending its deadline', () => {
		const lobby = open().lobby
		const step = send(
			lobby,
			'a',
			'pvp_rules_open',
			{ ante: 3, first_player: 'a' },
			500,
		)
		expect(step.lobby.sharedRules).toEqual(lobby.sharedRules)
		expect(params(step).ms_left).toBe(9_600)
	})
	it('does not start a blind after a participant leaves or the run ends', () => {
		const lobby = open().lobby
		expect(
			sharedRulesTick({ ...lobby, players: lobby.players.slice(0, 1) }, 11_000)
				.out,
		).toEqual([])
		expect(sharedRulesTick({ ...lobby, closed: true }, 11_000).out).toEqual([])
		expect(
			sharedRulesTick(
				{ ...lobby, game: { ...lobby.game, started: null } },
				11_000,
			).out,
		).toEqual([])
	})
})
