import { describe, expect, it } from 'vitest'
import { ServerOp } from './protocol'
import { action } from './relay'
import { SENDER_RULES, senderRefusal, senderRuleOf } from './sender_guard'
import {
	type Lobby,
	type Outbound,
	disconnect,
	join,
	leave,
	newLobby,
} from './state'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

// 'a' creates the lobby, so 'a' is its host.
function lobbyWith(...ids: string[]): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerPvP',
		maxPlayers: 4,
		creatorId: ids[0],
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	return lobby
}

const ctx = { now: 1000, newSeed: () => 'SEED1234', newId: () => 'RUN1', random: () => 0 }

function send(
	lobby: Lobby,
	from: string,
	key: string,
	params: unknown,
	to = '*',
) {
	return action(lobby, from, { cid: 'c1', action: key, to, params }, ctx)
}

type Send = Extract<Outbound, { kind: 'send' }>
function relayed(out: Outbound[]): Send[] {
	return out.filter(
		(o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION,
	)
}
function rejected(out: Outbound[]): Send[] {
	return out.filter(
		(o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION_REJECTED,
	)
}

const HOST_KEYS = Object.keys(SENDER_RULES).filter(
	(k) => SENDER_RULES[k as keyof typeof SENDER_RULES] === 'host',
)

describe('SENDER_RULES', () => {
	it('covers the outcome actions the research named', () => {
		for (const key of [
			'pvp_win',
			'pvp_player_won',
			'pvp_end_pvp',
			'pvp_ready_check',
			'pvp_round_state',
			'pvp_death_pending',
			'pvp_player_lives',
			'spdrn_match_timeout',
			'spdrn_seed_change_apply',
			'spdrn_match_draw',
		])
			expect(senderRuleOf(key)).toBe('host')
		expect(senderRuleOf('spdrn_player_result')).toBe('self')
		expect(senderRuleOf('spdrn_player_won')).toBe('self_or_host')
	})

	it('leaves claims about the sender itself unruled', () => {
		// pvp_player_result is keyed on the sender by its handler, and every
		// player sends its own; the rest are each player's own state.
		for (const key of [
			'pvp_player_result',
			'pvp_play_hand',
			'pvp_ready_blind',
			'pvp_fail_round',
			'pvp_forfeit',
			'pvp_draw_vote',
			'spdrn_forfeit',
			'spdrn_draw_vote',
			'spdrn_seed_vote',
			'spdrn_location',
		])
			expect(senderRuleOf(key)).toBeNull()
	})

	it('does not read rules off the object prototype', () => {
		expect(senderRuleOf('toString')).toBeNull()
		expect(senderRuleOf('constructor')).toBeNull()
	})
})

describe('host-only actions', () => {
	it.each(HOST_KEYS)('%s passes from the host', (key) => {
		const step = send(lobbyWith('a', 'b', 'c'), 'a', key, { winner_id: 'a' })
		expect(step.dropped).toBeUndefined()
		const [msg] = relayed(step.out)
		expect(msg.to).toEqual(['a', 'b', 'c'])
		expect((msg.payload as { from: string }).from).toBe('a')
	})

	it.each(HOST_KEYS)('%s from a guest is dropped, not relayed', (key) => {
		const step = send(lobbyWith('a', 'b', 'c'), 'b', key, { winner_id: 'b' })
		expect(relayed(step.out)).toEqual([])
		expect(step.dropped).toEqual({
			kind: 'not_host',
			key,
			from: 'b',
			hostId: 'a',
		})
		const [r] = rejected(step.out)
		expect(r.to).toEqual(['b'])
		expect(r.payload).toEqual({ cid: 'c1', action: key, reason: 'not_host' })
	})

	it.each(['pvp_win', 'pvp_round_state'])('drops a forged %s aimed at one player too', (key) => {
		const step = send(
			lobbyWith('a', 'b', 'c'),
			'b',
			key,
			{ winner_id: 'b' },
			'c',
		)
		expect(relayed(step.out)).toEqual([])
		expect(step.dropped?.kind).toBe('not_host')
	})

	it('drops forged lives for anyone, the forger included', () => {
		const lobby = lobbyWith('a', 'b')
		for (const target of ['a', 'b', '*all*']) {
			const step = send(lobby, 'b', 'pvp_player_lives', {
				player_id: target,
				lives: 99,
			})
			expect(relayed(step.out)).toEqual([])
		}
	})

	it('still spends the forger budget, so forging is rate limited', () => {
		const lobby = lobbyWith('a', 'b')
		const step = send(lobby, 'b', 'pvp_win', { winner_id: 'b' })
		expect(step.lobby.actionBudget.b.tokens).toBeLessThan(
			lobby.actionBudget.b?.tokens ?? 100,
		)
	})

	it('keeps the lobby otherwise unchanged when dropping', () => {
		const lobby = lobbyWith('a', 'b')
		const step = send(lobby, 'b', 'pvp_win', { winner_id: 'b' })
		expect({ ...step.lobby, actionBudget: {} }).toEqual({
			...lobby,
			actionBudget: {},
		})
	})
})

describe('host transfer', () => {
	it('accepts the new host after the old one disconnects, and refuses the old one', () => {
		let lobby = lobbyWith('a', 'b', 'c')
		lobby = disconnect(lobby, 'a', 'a-s1', 500).lobby
		expect(lobby.hostId).toBe('b')

		const fromNew = send(lobby, 'b', 'pvp_win', { winner_id: 'c' })
		expect(fromNew.dropped).toBeUndefined()
		expect(relayed(fromNew.out)).toHaveLength(1)

		// The old host comes back: it is a guest now.
		lobby = join(lobby, 'a', 'a-s2', info('a')).lobby
		expect(lobby.hostId).toBe('b')
		const fromOld = send(lobby, 'a', 'pvp_win', { winner_id: 'a' })
		expect(fromOld.dropped).toEqual({
			kind: 'not_host',
			key: 'pvp_win',
			from: 'a',
			hostId: 'b',
		})
		expect(relayed(fromOld.out)).toEqual([])
	})

	it('accepts the new host after the old one leaves', () => {
		let lobby = lobbyWith('a', 'b', 'c')
		lobby = leave(lobby, 'a').lobby
		expect(lobby.hostId).toBe('b')
		const step = send(lobby, 'b', 'pvp_player_won', { player_id: 'c' })
		expect(step.dropped).toBeUndefined()
		expect(relayed(step.out)[0].to).toEqual(['b', 'c'])
		expect(
			send(lobby, 'c', 'pvp_player_won', { player_id: 'c' }).dropped?.kind,
		).toBe('not_host')
	})

	it('a matchmade lobby: whoever arrived first is the host of record', () => {
		let lobby = newLobby({
			code: 'MM0001',
			modId: 'MultiplayerSPDRN',
			maxPlayers: 2,
			creatorId: '',
			allowedIds: ['x', 'y'],
			now: 0,
			graceMs: 10_000,
		})
		lobby = join(lobby, 'y', 'y-s1', info('y')).lobby
		lobby = join(lobby, 'x', 'x-s1', info('x')).lobby
		expect(lobby.hostId).toBe('y')
		expect(send(lobby, 'y', 'spdrn_match_timeout', {}).dropped).toBeUndefined()
		expect(send(lobby, 'x', 'spdrn_match_timeout', {}).dropped?.kind).toBe(
			'not_host',
		)
	})
})

describe('self-keyed results', () => {
	it('spdrn_player_result passes when it names the sender', () => {
		const step = send(lobbyWith('a', 'b'), 'b', 'spdrn_player_result', {
			player_id: 'b',
			furthest_ante: 3,
		})
		expect(step.dropped).toBeUndefined()
		expect(relayed(step.out)).toHaveLength(1)
	})

	it('spdrn_player_result naming someone else is dropped, even from the host', () => {
		for (const from of ['a', 'b']) {
			const other = from === 'a' ? 'b' : 'a'
			const step = send(lobbyWith('a', 'b'), from, 'spdrn_player_result', {
				player_id: other,
				furthest_ante: 9,
			})
			expect(relayed(step.out)).toEqual([])
			expect(step.dropped).toEqual({
				kind: 'not_self',
				key: 'spdrn_player_result',
				from,
				hostId: 'a',
				claimed: other,
			})
			expect((rejected(step.out)[0].payload as { reason: string }).reason).toBe(
				'not_self',
			)
		}
	})

	it('spdrn_player_result naming nobody is dropped', () => {
		for (const params of [{}, null, [], 'b', { player_id: 7 }]) {
			const step = send(lobbyWith('a', 'b'), 'b', 'spdrn_player_result', params)
			expect(step.dropped).toMatchObject({ kind: 'not_self', claimed: null })
		}
	})

	it('spdrn_player_won: a guest may only declare itself', () => {
		const lobby = lobbyWith('a', 'b', 'c')
		expect(
			send(lobby, 'b', 'spdrn_player_won', { player_id: 'b' }).dropped,
		).toBeUndefined()
		const forged = send(lobby, 'b', 'spdrn_player_won', { player_id: 'c' })
		expect(relayed(forged.out)).toEqual([])
		expect(forged.dropped).toEqual({
			kind: 'not_self',
			key: 'spdrn_player_won',
			from: 'b',
			hostId: 'a',
			claimed: 'c',
		})
	})

	it('spdrn_player_won: the host may declare a forfeit survivor', () => {
		// on_player_forfeit -> check_single_survivor runs on the host only and
		// names the one player left, who need not be the host.
		const step = send(lobbyWith('a', 'b'), 'a', 'spdrn_player_won', {
			player_id: 'b',
		})
		expect(step.dropped).toBeUndefined()
		expect(relayed(step.out)[0].to).toEqual(['a', 'b'])
	})

	it('spdrn_player_won: after a transfer the new host may declare a survivor', () => {
		let lobby = lobbyWith('a', 'b', 'c')
		lobby = leave(lobby, 'a').lobby
		expect(
			send(lobby, 'b', 'spdrn_player_won', { player_id: 'c' }).dropped,
		).toBeUndefined()
		expect(
			send(lobby, 'c', 'spdrn_player_won', { player_id: 'b' }).dropped?.kind,
		).toBe('not_self')
	})
})

describe('unruled actions', () => {
	it('relay exactly as before', () => {
		const step = send(lobbyWith('a', 'b'), 'b', 'pvp_player_result', {
			jokers: [],
		})
		expect(step.dropped).toBeUndefined()
		expect(relayed(step.out)[0].to).toEqual(['a', 'b'])
	})

	it('senderRefusal is null for them whoever sends', () => {
		const lobby = lobbyWith('a', 'b')
		expect(
			senderRefusal(lobby, 'b', 'pvp_play_hand', { score: '1e999' }),
		).toBeNull()
	})
})

describe('a forged win does not reach the rated result', () => {
	const at = (now: number) => ({
		now,
		newSeed: () => 'SEED1234',
		newId: () => 'RUN1',
		random: () => 0,
	})
	const server = (
		lobby: Lobby,
		from: string,
		key: string,
		params: unknown,
		now = 1000,
	) =>
		action(
			lobby,
			from,
			{ cid: `${key}-${from}`, action: key, to: 'server', params },
			at(now),
		)
	const places = (...order: string[]) =>
		order.map((playerId, i) => ({ playerId, place: i + 1 }))

	function startedPvp(): Lobby {
		let lobby = newLobby({
			code: 'ABC123',
			modId: 'MultiplayerPvP',
			maxPlayers: 2,
			creatorId: 'a',
			now: 0,
			graceMs: 10_000,
			resultTimeoutMs: 60_000,
		})
		for (const id of ['a', 'b'])
			lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
		lobby = server(lobby, 'b', 'mpapi_ready', { ready: true }).lobby
		return server(lobby, 'a', 'mpapi_start_game', { stake: 1 }).lobby
	}

	it('the host never sees the forgery, so the forger cannot make the report agree', () => {
		let lobby = startedPvp()
		// The guest declares itself the winner: nobody receives it.
		const forged = send(lobby, 'b', 'pvp_win', { winner_id: 'b' })
		expect(relayed(forged.out)).toEqual([])
		lobby = forged.lobby
		// The host's referee declares the real winner; both clients receive it.
		const legit = send(lobby, 'a', 'pvp_win', { winner_id: 'a' })
		expect(relayed(legit.out)[0].to).toEqual(['a', 'b'])
		lobby = legit.lobby
		// The host reports what it saw; the forger still lies in its own report.
		lobby = server(
			lobby,
			'a',
			'mpapi_report_result',
			{ placements: places('a', 'b') },
			2000,
		).lobby
		const last = server(
			lobby,
			'b',
			'mpapi_report_result',
			{ placements: places('b', 'a') },
			2500,
		)
		const save = last.out.find(
			(o): o is Extract<Outbound, { kind: 'saveRun' }> => o.kind === 'saveRun',
		)
		// Disputed (never rated: rating/apply.ts rates only agreed/partial),
		// and the recorded placements are the host's.
		expect(save?.run.status).toBe('disputed')
		expect(save?.run.placements.map((p) => [p.playerId, p.place])).toEqual([
			['a', 1],
			['b', 2],
		])
	})
})
