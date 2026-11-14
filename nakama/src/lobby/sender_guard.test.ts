import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { withRules } from '../testing/pvp_rules'
import { ServerOp } from './protocol'
import { action } from './relay'
import {
	PVP_RELAY_KEYS,
	SENDER_RULES,
	senderRefusal,
	senderRuleOf,
} from './sender_guard'
import { addSpectator } from './spectate'
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

// The first id creates the lobby, so it is the host.
function lobbyOf(modId: string, ...ids: string[]): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId,
		maxPlayers: 4,
		creatorId: ids[0],
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	return lobby
}
const lobbyWith = (...ids: string[]): Lobby => lobbyOf('MultiplayerPvP', ...ids)

const ctx = {
	now: 1000,
	newSeed: () => 'SEED1234',
	newId: () => 'RUN1',
	random: () => 0,
}

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

// The 9 keys the server-refereed client still needs (docs/pvp-match.md section 9),
// written out here so the list in sender_guard.ts is checked against the spec.
const KEPT = [
	'pvp_location',
	'pvp_player_result',
	'pvp_log_event',
	'pvp_get_end_game_jokers',
	'pvp_receive_end_game_jokers',
	'pvp_get_nemesis_deck',
	'pvp_receive_nemesis_deck',
	'pvp_end_game_stats_requested',
	'pvp_nemesis_end_game_stats',
]

// What the host's client used to broadcast as the referee.
const DROPPED_OUTPUTS = [
	'pvp_start_game',
	'pvp_start_blind',
	'pvp_ready_check',
	'pvp_end_pvp',
	'pvp_win',
	'pvp_player_won',
	'pvp_round_state',
	'pvp_player_lives',
	'pvp_team_lives',
	'pvp_eliminated',
	'pvp_death_pending',
	'pvp_timer_hand_lost',
	'pvp_nemesis_pairing',
	'pvp_team_card_target',
	'pvp_team_roster',
	'pvp_royale_target',
	'pvp_manhunt_target',
	'pvp_team_score_board',
	'pvp_reseed',
	'pvp_stop_game',
]

// What a guest's client used to send the host referee.
const DROPPED_INPUTS = [
	'pvp_ready',
	'pvp_unready',
	'pvp_ready_ack',
	'pvp_player_ready',
	'pvp_play_hand',
	'pvp_skip',
	'pvp_set_ante',
	'pvp_set_furthest_blind',
	'pvp_new_round',
	'pvp_fail_round',
	'pvp_fail_timer',
	'pvp_fail_pvp_timer',
	'pvp_blind_result',
	'pvp_redeem_ante_voucher',
	'pvp_result_request',
	'pvp_forfeit',
	'pvp_draw_vote',
	'pvp_seed_vote',
	'pvp_set_team',
]

// The three timer relays replaced by the match's `pvp.round.deadline`:
// a forged one from any seat reaches nobody.
const DROPPED_TIMERS = [
	'pvp_ante_timer',
	'pvp_restart_ante_timer',
	'pvp_pause_ante_timer',
]

// The trap relays the server now records itself (pvp.trap_plant, pvp.trap_fire,
// pvp.trap_lost are requests, answered by the referee).
const DROPPED_TRAPS = ['pvp_trap_held', 'pvp_trap_plant']

const DROPPED = [
	...DROPPED_OUTPUTS,
	...DROPPED_INPUTS,
	...DROPPED_TIMERS,
	...DROPPED_TRAPS,
]

// In the lobby 'a' is the host, 'b' and 'c' are guests.
const SENDERS: [string, string][] = [
	['the host', 'a'],
	['a guest', 'b'],
]
const eachSender = (keys: string[]): [string, string, string][] =>
	keys.flatMap((key) =>
		SENDERS.map(([who, id]): [string, string, string] => [key, who, id]),
	)

const HOST_KEYS = Object.keys(SENDER_RULES).filter(
	(k) => SENDER_RULES[k as keyof typeof SENDER_RULES] === 'host',
)

describe('PVP_RELAY_KEYS', () => {
	it('is exactly the 9 keys of the spec', () => {
		expect([...PVP_RELAY_KEYS]).toEqual([...KEPT].sort())
		expect(KEPT).toHaveLength(9)
	})

	it('is sorted, has no duplicates, and every entry starts with pvp_', () => {
		expect([...PVP_RELAY_KEYS]).toEqual([...PVP_RELAY_KEYS].sort())
		expect(new Set(PVP_RELAY_KEYS).size).toBe(PVP_RELAY_KEYS.length)
		for (const key of PVP_RELAY_KEYS) expect(key.startsWith('pvp_')).toBe(true)
	})

	it('shares no key with the two dropped lists', () => {
		expect(DROPPED.filter((k) => PVP_RELAY_KEYS.includes(k))).toEqual([])
		expect(new Set(DROPPED).size).toBe(44)
	})
})

describe('SENDER_RULES', () => {
	it('covers the Speedrunning host decisions and results', () => {
		for (const key of [
			'spdrn_match_timeout',
			'spdrn_seed_change_apply',
			'spdrn_match_draw',
		])
			expect(senderRuleOf(key)).toBe('host')
		expect(senderRuleOf('spdrn_player_result')).toBe('self')
		expect(senderRuleOf('spdrn_player_won')).toBe('self_or_host')
	})

	it('has no pvp_ row: the allowlist rules every pvp_ key', () => {
		expect(
			Object.keys(SENDER_RULES).filter((k) => k.startsWith('pvp_')),
		).toEqual([])
		expect(Object.keys(SENDER_RULES)).toHaveLength(5)
	})

	it('leaves claims about the sender itself unruled', () => {
		for (const key of [
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

describe('pvp_ keys the server referee does not need', () => {
	it.each(eachSender(DROPPED))(
		'%s from %s reaches nobody and the sender is told why',
		(key, _who, from) => {
			const step = send(lobbyWith('a', 'b', 'c'), from, key, {
				winner_id: from,
			})
			expect(relayed(step.out)).toEqual([])
			expect(step.dropped).toEqual({
				kind: 'not_relayed',
				key,
				from,
				hostId: 'a',
			})
			const [r] = rejected(step.out)
			expect(step.out).toHaveLength(1)
			expect(r.to).toEqual([from])
			expect(r.payload).toEqual({
				cid: 'c1',
				action: key,
				reason: 'not_relayed',
			})
		},
	)

	it.each(eachSender(['pvp_new_thing', 'pvp_', 'pvp_x']))(
		'a made-up %s from %s is dropped too',
		(key, _who, from) => {
			const step = send(lobbyWith('a', 'b', 'c'), from, key, {})
			expect(relayed(step.out)).toEqual([])
			expect(step.dropped?.kind).toBe('not_relayed')
		},
	)

	it.each(DROPPED)('%s aimed at one player is dropped too', (key) => {
		const step = send(lobbyWith('a', 'b', 'c'), 'b', key, {}, 'c')
		expect(relayed(step.out)).toEqual([])
		expect(step.dropped?.kind).toBe('not_relayed')
	})

	it.each(['MultiplayerSPDRN', 'SomeOtherMod'])(
		'is dropped in a %s lobby as well',
		(modId) => {
			const lobby = lobbyOf(modId, 'a', 'b')
			for (const from of ['a', 'b']) {
				const step = send(lobby, from, 'pvp_win', { winner_id: from })
				expect(relayed(step.out)).toEqual([])
				expect(step.dropped?.kind).toBe('not_relayed')
				expect(relayed(send(lobby, from, 'pvp_location', {}).out)).toHaveLength(
					1,
				)
			}
		},
	)

	it('a spectator is stopped before the guard: no seat, so nothing is relayed', () => {
		const lobby = addSpectator(lobbyWith('a', 'b'), 'z').lobby
		for (const key of [...DROPPED, ...KEPT]) {
			const step = send(lobby, 'z', key, {})
			expect(step.out).toEqual([])
			expect(step.refused).toEqual({ key, reason: 'no_seat' })
			expect(step.dropped).toBeUndefined()
		}
	})

	it('still spends the sender budget, so sending them is rate limited', () => {
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

describe('pvp_ keys the server referee keeps relaying', () => {
	// pvp_log_event is split into a whole copy and a slim one (relay.test.ts).
	it.each(eachSender(KEPT.filter((k) => k !== 'pvp_log_event')))(
		'%s from %s is delivered to every seat with the sender stamped',
		(key, _who, from) => {
			const step = send(lobbyWith('a', 'b', 'c'), from, key, { n: 1 })
			expect(step.dropped).toBeUndefined()
			const [msg] = relayed(step.out)
			expect(relayed(step.out)).toHaveLength(1)
			expect(msg.to).toEqual(['a', 'b', 'c'])
			expect(msg.payload).toEqual({
				cid: 'c1',
				action: key,
				from,
				to: '*',
				params: { n: 1 },
			})
		},
	)

	it('a directed one goes to its target only', () => {
		const step = send(lobbyWith('a', 'b', 'c'), 'a', 'pvp_get_nemesis_deck', {}, 'c')
		expect(relayed(step.out)[0].to).toEqual(['c'])
	})
})

describe('other unruled actions', () => {
	it.each(['spdrn_something_new', 'mpapi_chat', 'pvpx_thing', 'pvp'])(
		'%s relays exactly as before',
		(key) => {
			const step = send(lobbyWith('a', 'b'), 'b', key, { text: 'hi' })
			expect(step.dropped).toBeUndefined()
			expect(relayed(step.out)[0].to).toEqual(['a', 'b'])
		},
	)

	it('senderRefusal is null for them whoever sends', () => {
		const lobby = lobbyWith('a', 'b')
		expect(
			senderRefusal(lobby, 'b', 'spdrn_play_hand', { score: '1e999' }),
		).toBeNull()
	})
})

describe('properties of the allowlist', () => {
	const lobby = lobbyWith('a', 'b')
	// A made-up key that is never on the list.
	const offList = fc
		.stringMatching(/^pvp_[a-z0-9_]{1,40}$/)
		.map((key) => (PVP_RELAY_KEYS.includes(key) ? `${key}x` : key))

	it('refuses every pvp_ key that is not on the list, for any sender', () => {
		fc.assert(
			fc.property(offList, fc.string(), fc.anything(), (key, from, params) => {
				expect(senderRefusal(lobby, from, key, params)).toMatchObject({
					kind: 'not_relayed',
					key,
					from,
				})
			}),
			{ numRuns: 300 },
		)
	})

	it('accepts every key on the list, for any sender', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...PVP_RELAY_KEYS),
				fc.string(),
				fc.anything(),
				(key, from, params) => {
					expect(senderRefusal(lobby, from, key, params)).toBeNull()
				},
			),
			{ numRuns: 300 },
		)
	})

	it('has no opinion on a key that does not start with pvp_ and has no rule', () => {
		fc.assert(
			fc.property(
				// Prefixed so it can start with neither pvp_ nor a ruled spdrn_ key.
				fc
					.stringMatching(/^[a-z0-9_]{1,56}$/)
					.map((key) => `other_${key}`),
				fc.string(),
				(key, from) => {
					expect(senderRefusal(lobby, from, key, {})).toBeNull()
				},
			),
			{ numRuns: 300 },
		)
	})
})

describe('Speedrunning host-only actions', () => {
	it.each(HOST_KEYS)('%s passes from the host', (key) => {
		const step = send(lobbyOf('MultiplayerSPDRN', 'a', 'b', 'c'), 'a', key, {})
		expect(step.dropped).toBeUndefined()
		const [msg] = relayed(step.out)
		expect(msg.to).toEqual(['a', 'b', 'c'])
		expect((msg.payload as { from: string }).from).toBe('a')
	})

	it.each(HOST_KEYS)('%s from a guest is dropped, not relayed', (key) => {
		const step = send(lobbyOf('MultiplayerSPDRN', 'a', 'b', 'c'), 'b', key, {})
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

	it('a guest aiming one at a single player is dropped too', () => {
		const step = send(
			lobbyOf('MultiplayerSPDRN', 'a', 'b', 'c'),
			'b',
			'spdrn_match_draw',
			{},
			'c',
		)
		expect(relayed(step.out)).toEqual([])
		expect(step.dropped?.kind).toBe('not_host')
	})
})

describe('host transfer', () => {
	it('accepts the new host after the old one disconnects, and refuses the old one', () => {
		let lobby = lobbyOf('MultiplayerSPDRN', 'a', 'b', 'c')
		lobby = disconnect(lobby, 'a', 'a-s1', 500).lobby
		expect(lobby.hostId).toBe('b')

		const fromNew = send(lobby, 'b', 'spdrn_match_timeout', {})
		expect(fromNew.dropped).toBeUndefined()
		expect(relayed(fromNew.out)).toHaveLength(1)

		// The old host comes back: it is a guest now.
		lobby = join(lobby, 'a', 'a-s2', info('a')).lobby
		expect(lobby.hostId).toBe('b')
		const fromOld = send(lobby, 'a', 'spdrn_match_timeout', {})
		expect(fromOld.dropped).toEqual({
			kind: 'not_host',
			key: 'spdrn_match_timeout',
			from: 'a',
			hostId: 'b',
		})
		expect(relayed(fromOld.out)).toEqual([])
	})

	it('accepts the new host after the old one leaves', () => {
		let lobby = lobbyOf('MultiplayerSPDRN', 'a', 'b', 'c')
		lobby = leave(lobby, 'a').lobby
		expect(lobby.hostId).toBe('b')
		const step = send(lobby, 'b', 'spdrn_match_draw', {})
		expect(step.dropped).toBeUndefined()
		expect(relayed(step.out)[0].to).toEqual(['b', 'c'])
		expect(send(lobby, 'c', 'spdrn_match_draw', {}).dropped?.kind).toBe(
			'not_host',
		)
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
		lobby = { ...lobby, metadata: withRules() }
		for (const id of ['a', 'b'])
			lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
		lobby = server(lobby, 'b', 'mpapi_ready', { ready: true }).lobby
		return server(lobby, 'a', 'mpapi_start_game', { stake: 1 }).lobby
	}

	it('a pvp_win from the host or a guest reaches nobody, and no report makes a rated result', () => {
		let lobby = startedPvp()
		// Whoever declares themselves the winner: nobody receives it.
		for (const [from, winner] of [
			['b', 'b'],
			['a', 'a'],
		]) {
			const forged = send(lobby, from, 'pvp_win', { winner_id: winner })
			expect(relayed(forged.out)).toEqual([])
			expect(forged.dropped?.kind).toBe('not_relayed')
			lobby = forged.lobby
		}
		// A PvP game is refereed by the server: no client report is accepted, the
		// forger's or the host's, so there is nothing for a lie to agree with.
		for (const [id, order] of [
			['a', places('a', 'b')],
			['b', places('b', 'a')],
		] as const) {
			const step = server(
				lobby,
				id,
				'mpapi_report_result',
				{ placements: order },
				2000,
			)
			expect((rejected(step.out)[0].payload as { reason: string }).reason).toBe(
				'server_referee',
			)
			expect(step.out.some((o) => o.kind === 'saveRun')).toBe(false)
		}
	})
})
