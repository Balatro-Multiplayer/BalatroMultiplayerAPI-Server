import { describe, expect, it } from 'vitest'
import { checkpointOf, resumeFrom } from '../lobby/checkpoint'
import {
	type OpenDraftView,
	type OpenVoteView,
	ServerOp,
	type SetupView,
} from '../lobby/protocol'
import { action } from '../lobby/relay'
import {
	type Lobby,
	type Outbound,
	type Step,
	disconnect,
	join,
	newLobby,
	snapshotFor,
} from '../lobby/state'
import { SETUP_STATE_KEY, rollVote, setupOf, setupTick } from './setup'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

// A random source that plays back `values`, then 0.
function randoms(...values: number[]): () => number {
	let i = 0
	return () => (i < values.length ? values[i++] : 0)
}

let random = randoms()
let ids = 0
function send(
	lobby: Lobby,
	from: string,
	key: string,
	params: unknown = {},
	now = 1000,
): Step {
	return action(
		lobby,
		from,
		{ cid: `${key}-${from}`, action: key, to: 'server', params },
		{ now, newSeed: () => 'SEED1234', newId: () => `RUN${++ids}`, random },
	)
}

type Send = Extract<Outbound, { kind: 'send' }>
function rejection(step: Step): string | undefined {
	const r = step.out.filter(
		(o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION_REJECTED,
	)[0]
	return r && (r.payload as { reason: string }).reason
}
function broadcastSetup(step: Step): SetupView | undefined {
	const r = step.out.filter(
		(o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION,
	)[0]
	return r && (r.payload as { params: { setup: SetupView } }).params.setup
}

// A lobby of `players` (the first is host) with a game started on stake 2.
function started(...players: string[]): Lobby {
	random = randoms()
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'm',
		maxPlayers: 8,
		creatorId: players[0],
		now: 0,
		graceMs: 10_000,
	})
	for (const id of players) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	for (const id of players.slice(1))
		lobby = send(lobby, id, 'mpapi_ready', { ready: true }).lobby
	const step = send(lobby, players[0], 'mpapi_start_game', { stake: 2 })
	expect(rejection(step)).toBeUndefined()
	return step.lobby
}

const decks = (...keys: string[]) => keys.map((key) => ({ key }))

function openDraft(lobby: Lobby) {
	const open = setupOf(lobby.game).open
	if (!open || open.kind !== 'draft') throw new Error('no open draft')
	return open
}

describe('starting a Setup step', () => {
	it('lets only the host start one, in a started game, one at a time', () => {
		const lobby = started('a', 'b')
		const params = { id: 'draft', candidates: decks('x', 'y', 'z') }
		expect(rejection(send(lobby, 'b', 'mpapi_setup_draft', params))).toBe(
			'not_host',
		)
		const open = send(lobby, 'a', 'mpapi_setup_draft', params).lobby
		expect(
			rejection(
				send(open, 'a', 'mpapi_setup_vote', { id: 'v', options: ['p', 'q'] }),
			),
		).toBe('step_open')

		let idle = newLobby({
			code: 'X',
			modId: 'm',
			maxPlayers: 2,
			creatorId: 'a',
			now: 0,
			graceMs: 1,
		})
		idle = join(idle, 'a', 's', info('a')).lobby
		expect(rejection(send(idle, 'a', 'mpapi_setup_draft', params))).toBe(
			'not_in_game',
		)
	})

	it('refuses a step id that already has a result', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_setup_draft', {
			id: 'draft',
			candidates: decks('x'),
			keep: 1,
		}).lobby
		expect(setupOf(lobby.game).results.draft).toBeDefined()
		expect(
			rejection(
				send(lobby, 'a', 'mpapi_setup_draft', {
					id: 'draft',
					candidates: decks('x'),
				}),
			),
		).toBe('step_done')
	})

	it('refuses bad Draft params', () => {
		const lobby = started('a', 'b')
		const bad = [
			{ id: 'Bad Id', candidates: decks('x') },
			{ id: 'd', candidates: [] },
			{ id: 'd', candidates: decks('x', 'x') },
			{ id: 'd', candidates: decks('x'), poolSize: 2 },
			{ id: 'd', candidates: decks('x', 'y'), keep: 3 },
			{
				id: 'd',
				candidates: decks('x'),
				schedule: [{ actor: 1, action: 'steal', count: 1 }],
			},
			{ id: 'd', candidates: decks('x'), maxStake: 0 },
			{ id: 'd', candidates: decks('x'), turnSeconds: 1 },
		]
		for (const params of bad)
			expect(rejection(send(lobby, 'a', 'mpapi_setup_draft', params))).toBe(
				'bad_params',
			)
	})
})

describe('the Draft', () => {
	it('keeps Almanac’s five explicit stakes through recovery, three bans, a pick and reseed', () => {
		for (const white of [1, 12]) {
			for (const gold of [8, 11]) {
				let lobby = started('a', 'b')
				const candidates = [white, 3, 4, 6, gold].map((stake) => ({
					key: `b_mp_almanac@${stake}`,
					art: 'b_mp_almanac',
					stake,
				}))
				lobby = send(lobby, 'a', 'mpapi_setup_draft', {
					id: 'draft',
					candidates,
					poolSize: 5,
					maxStake: 8, // Explicit variant indices must not be capped or rerolled.
					schedule: [
						{ actor: 1, action: 'ban', count: 1 },
						{ actor: 2, action: 'ban', count: 1 },
						{ actor: 1, action: 'ban', count: 1 },
						{ actor: 2, action: 'pick', count: 1 },
					],
				}).lobby
				expect(openDraft(lobby).pool).toHaveLength(5)
				expect(
					new Set(openDraft(lobby).pool.map((tile) => tile.stake)),
				).toEqual(new Set([white, 3, 4, 6, gold]))
				const checkpoint = checkpointOf(lobby, 1_000)
				if (!checkpoint) throw Error('Expected draft checkpoint')
				lobby = { ...resumeFrom(checkpoint, 5_000), hostId: 'b' }
				expect(openDraft(lobby).pool).toEqual(openDraft(checkpoint.lobby).pool)
				for (let turn = 0; turn < 4; turn++) {
					const draft = openDraft(lobby)
					const actor =
						draft.order[
							(draft.first + draft.schedule[draft.turn].actor - 1) %
								draft.order.length
						]
					// Leave the White / White- tile available until the final pick.
					const tile = draft.pool.find((tile) =>
						turn === 3
							? tile.stake === white
							: tile.stake !== white && !draft.banned.includes(tile.key),
					)
					if (!tile) throw Error('Expected available stake tile')
					const step = send(
						lobby,
						actor,
						'mpapi_setup_choose',
						{
							key: tile.key,
						},
						6_000 + turn * 100,
					)
					expect(rejection(step)).toBeUndefined()
					lobby = step.lobby
				}
				const result = setupOf(lobby.game).results.draft
				expect(result).toMatchObject({
					survivors: [
						{ key: `b_mp_almanac@${white}`, art: 'b_mp_almanac', stake: white },
					],
				})
				expect(lobby.game.started?.stake).toBe(white)
				const restart = send(lobby, 'b', 'mpapi_restart_game', {}, 7_000).lobby
				expect(restart.game.started?.stake).toBe(white)
				expect(setupOf(restart.game).results.draft).toEqual(result)
			}
		}
	})

	it('samples the pool, rolls missing stakes and the first actor', () => {
		const lobby = started('a', 'b')
		// Shuffle of 3 (two draws), then two stakes, then the first actor.
		random = randoms(0, 0, 0.99, 0.6)
		const step = send(lobby, 'a', 'mpapi_setup_draft', {
			id: 'draft',
			candidates: [{ key: 'x' }, { key: 'y', stake: 5 }, { key: 'z' }],
			poolSize: 2,
			maxStake: 8,
		})
		const draft = openDraft(step.lobby)
		expect(draft.pool).toEqual([
			{ key: 'y', stake: 5 },
			{ key: 'z', stake: 8 },
		])
		expect(draft.order).toEqual(['a', 'b'])
		expect(draft.first).toBe(1)
		expect((broadcastSetup(step)?.open as OpenDraftView).actor).toBe('b')
	})

	it('rotates single bans until `keep` tiles are left', () => {
		let lobby = started('a', 'b', 'c')
		lobby = send(lobby, 'a', 'mpapi_setup_draft', {
			id: 'draft',
			candidates: decks('p', 'q', 'r', 's'),
			keep: 1,
		}).lobby
		const order = openDraft(lobby).order
		expect(
			rejection(send(lobby, order[1], 'mpapi_setup_choose', { key: 'p' })),
		).toBe('not_your_turn')
		lobby = send(lobby, order[0], 'mpapi_setup_choose', { key: 'p' }).lobby
		expect(
			rejection(send(lobby, order[1], 'mpapi_setup_choose', { key: 'p' })),
		).toBe('bad_tile')
		expect(
			rejection(send(lobby, order[1], 'mpapi_setup_choose', { key: 'nope' })),
		).toBe('bad_tile')
		lobby = send(lobby, order[1], 'mpapi_setup_choose', { key: 'q' }).lobby
		const step = send(lobby, order[2], 'mpapi_setup_choose', { key: 'r' })
		const result = broadcastSetup(step)?.results.draft
		expect(broadcastSetup(step)?.open).toBeNull()
		expect(result).toEqual({
			kind: 'draft',
			survivors: [{ key: 's' }],
			banned: ['p', 'q', 'r'],
		})
	})

	it('runs an explicit schedule, ending on a pick', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_setup_draft', {
			id: 'draft',
			candidates: [
				{ key: 'p', stake: 3 },
				{ key: 'q', stake: 4 },
				{ key: 'r', stake: 6 },
				{ key: 's', stake: 7 },
			],
			schedule: [
				{ actor: 1, action: 'ban', count: 2 },
				{ actor: 2, action: 'pick', count: 1 },
			],
		}).lobby
		const [first, second] = openDraft(lobby).order
		lobby = send(lobby, first, 'mpapi_setup_choose', { key: 'p' }).lobby
		expect(openDraft(lobby).remaining).toBe(1)
		lobby = send(lobby, first, 'mpapi_setup_choose', { key: 'q' }).lobby
		lobby = send(lobby, second, 'mpapi_setup_choose', { key: 'r' }).lobby
		expect(setupOf(lobby.game).results.draft).toEqual({
			kind: 'draft',
			survivors: [{ key: 'r', stake: 6 }],
			banned: ['p', 'q'],
		})
		expect(lobby.game.started?.stake).toBe(6)
	})

	it('bans everything with keep 0, the ban order being the result', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_setup_draft', {
			id: 'draft',
			candidates: decks('p', 'q'),
			keep: 0,
		}).lobby
		const order = openDraft(lobby).order
		lobby = send(lobby, order[0], 'mpapi_setup_choose', { key: 'q' }).lobby
		lobby = send(lobby, order[1], 'mpapi_setup_choose', { key: 'p' }).lobby
		expect(setupOf(lobby.game).results.draft).toEqual({
			kind: 'draft',
			survivors: [],
			banned: ['q', 'p'],
		})
	})

	it('makes random bans for a turn that ran out, then starts the next clock', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_setup_draft', {
			id: 'draft',
			candidates: decks('p', 'q', 'r', 's'),
			schedule: [
				{ actor: 1, action: 'ban', count: 2 },
				{ actor: 2, action: 'pick', count: 1 },
			],
			turnSeconds: 30,
		}).lobby
		expect(setupTick(lobby, 30_999, randoms()).out).toEqual([])
		const step = setupTick(lobby, 31_000, randoms(0, 0))
		const draft = openDraft(step.lobby)
		expect(draft.banned).toHaveLength(2)
		expect(draft.turn).toBe(1)
		expect(draft.deadline).toBe(61_000)
		const sent = step.out[0] as Send
		expect((sent.payload as { action: string }).action).toBe(SETUP_STATE_KEY)
		expect(sent.to).toEqual(['a', 'b'])

		const picked = setupTick(step.lobby, 61_000, randoms(0))
		expect(setupOf(picked.lobby.game).results.draft).toMatchObject({
			survivors: [{}],
		})
	})

	it('keeps going when the host leaves: the new host starts the next step', () => {
		let lobby = started('a', 'b', 'c')
		lobby = send(lobby, 'a', 'mpapi_setup_draft', {
			id: 'draft',
			candidates: decks('p', 'q', 'r'),
			keep: 1,
		}).lobby
		const before = openDraft(lobby)
		lobby = disconnect(lobby, 'a', 'a-s1', 2000).lobby
		expect(lobby.hostId).toBe('b')
		expect(openDraft(lobby)).toEqual(before)
		for (let turn = 0; turn < 2; turn++) {
			const draft = openDraft(lobby)
			const who =
				draft.order[
					(draft.first + draft.schedule[draft.turn].actor - 1) %
						draft.order.length
				]
			const key = draft.pool.filter(
				(i) => draft.banned.indexOf(i.key) === -1,
			)[0].key
			// The away host's turn runs out; the others ban on time.
			if (who === 'a') lobby = setupTick(lobby, draft.deadline, randoms()).lobby
			else lobby = send(lobby, who, 'mpapi_setup_choose', { key }).lobby
		}
		expect(setupOf(lobby.game).results.draft).toBeDefined()
		expect(
			rejection(
				send(lobby, 'b', 'mpapi_setup_vote', {
					id: 'next',
					options: ['x', 'y'],
				}),
			),
		).toBeUndefined()
	})
})

describe('a vote', () => {
	it('rolls with each vote as one chance', () => {
		const vote = {
			kind: 'vote' as const,
			id: 'v',
			options: ['yes', 'no'],
			voters: ['a', 'b', 'c', 'd', 'e'],
			votes: { a: 'no', b: 'no', c: 'yes', d: 'yes', e: 'yes' },
			deadline: 0,
		}
		// 5 tickets: yes holds 0-2, no holds 3-4.
		expect(rollVote(vote, () => 0).option).toBe('yes')
		expect(rollVote(vote, () => 0.59).option).toBe('yes')
		expect(rollVote(vote, () => 0.6).option).toBe('no')
		expect(rollVote(vote, () => 0.99).option).toBe('no')
		expect(rollVote(vote, () => 0).counts).toEqual({ yes: 3, no: 2 })
	})

	it('gives every option the same chance with no votes', () => {
		const vote = {
			kind: 'vote' as const,
			id: 'v',
			options: ['p', 'q', 'r', 's'],
			voters: [],
			votes: {},
			deadline: 0,
		}
		expect(rollVote(vote, () => 0).option).toBe('p')
		expect(rollVote(vote, () => 0.5).option).toBe('r')
		expect(rollVote(vote, () => 0.99).option).toBe('s')
	})

	it('hides choices until it closes, then shows counts and the result', () => {
		let lobby = started('a', 'b', 'c')
		lobby = send(lobby, 'a', 'mpapi_setup_vote', {
			id: 'ruleset',
			options: ['vanilla', 'balanced'],
		}).lobby
		const step = send(lobby, 'b', 'mpapi_setup_cast', { option: 'vanilla' })
		const view = broadcastSetup(step)?.open as OpenVoteView
		expect(view.voted).toEqual(['b'])
		expect(view).not.toHaveProperty('votes')
		lobby = step.lobby
		expect(
			rejection(send(lobby, 'b', 'mpapi_setup_cast', { option: 'balanced' })),
		).toBe('already_voted')
		expect(
			rejection(send(lobby, 'c', 'mpapi_setup_cast', { option: 'expanded' })),
		).toBe('bad_params')
		lobby = send(lobby, 'c', 'mpapi_setup_cast', { option: 'vanilla' }).lobby
		random = randoms(0.99)
		const closed = send(lobby, 'a', 'mpapi_setup_cast', { option: 'balanced' })
		expect(broadcastSetup(closed)?.results.ruleset).toEqual({
			kind: 'vote',
			option: 'balanced',
			counts: { vanilla: 2, balanced: 1 },
		})
	})

	it('closes at its deadline, or once every connected voter has voted', () => {
		let lobby = started('a', 'b', 'c')
		lobby = send(lobby, 'a', 'mpapi_setup_vote', {
			id: 'v',
			options: ['p', 'q'],
			seconds: 15,
		}).lobby
		expect(setupTick(lobby, 15_999, randoms()).out).toEqual([])
		expect(
			setupOf(setupTick(lobby, 16_000, randoms()).lobby.game).results.v,
		).toBeDefined()

		lobby = send(lobby, 'b', 'mpapi_setup_cast', { option: 'p' }).lobby
		lobby = send(lobby, 'c', 'mpapi_setup_cast', { option: 'p' }).lobby
		lobby = disconnect(lobby, 'a', 'a-s1', 2000).lobby
		expect(
			setupOf(setupTick(lobby, 2000, randoms()).lobby.game).results.v,
		).toMatchObject({ option: 'p' })
	})

	it('lets only participants vote, once open', () => {
		let lobby = started('a', 'b')
		expect(
			rejection(send(lobby, 'b', 'mpapi_setup_cast', { option: 'p' })),
		).toBe('no_vote')
		lobby = send(lobby, 'a', 'mpapi_setup_vote', {
			id: 'v',
			options: ['p', 'q'],
		}).lobby
		lobby = join(lobby, 'late', 'late-s1', info('late')).lobby
		expect(
			rejection(send(lobby, 'late', 'mpapi_setup_cast', { option: 'p' })),
		).toBe('not_voter')
	})
})

describe('Setup across the game', () => {
	it('is in the snapshot, with votes hidden', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_setup_vote', {
			id: 'v',
			options: ['p', 'q'],
		}).lobby
		lobby = send(lobby, 'b', 'mpapi_setup_cast', { option: 'q' }).lobby
		const snapshot = snapshotFor(lobby, 'b')
		expect((snapshot.game.setup.open as OpenVoteView).voted).toEqual(['b'])
		expect(snapshot.game.setup.open).not.toHaveProperty('votes')
	})

	it('survives a restart: the drafted stake and every result, nothing open', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_setup_draft', {
			id: 'draft',
			candidates: [{ key: 'p', stake: 6 }],
		}).lobby
		lobby = send(lobby, 'a', 'mpapi_setup_vote', {
			id: 'v',
			options: ['p', 'q'],
		}).lobby
		const step = send(lobby, 'a', 'mpapi_restart_game')
		expect(step.lobby.game.started?.stake).toBe(6)
		expect(Object.keys(setupOf(step.lobby.game).results)).toEqual(['draft'])
		expect(setupOf(step.lobby.game).open).toBeNull()
	})

	it('starts empty on a new game', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_setup_draft', {
			id: 'draft',
			candidates: decks('p'),
		}).lobby
		lobby = send(lobby, 'a', 'mpapi_abandon_game').lobby
		lobby = send(lobby, 'b', 'mpapi_ready', { ready: true }).lobby
		lobby = send(lobby, 'a', 'mpapi_start_game', {}).lobby
		expect(setupOf(lobby.game)).toEqual({ open: null, results: {} })
	})

	it('moves an open deadline on by the downtime when a match resumes', () => {
		let lobby = started('a', 'b')
		lobby = send(lobby, 'a', 'mpapi_setup_vote', {
			id: 'v',
			options: ['p', 'q'],
			seconds: 15,
		}).lobby
		const checkpoint = checkpointOf(lobby, 5000)
		if (!checkpoint) throw new Error('no checkpoint')
		const resumed = resumeFrom(checkpoint, 9000)
		expect(setupOf(resumed.game).open?.deadline).toBe(20_000)
	})

	it('refuses a client sending the server-only state action', () => {
		const lobby = started('a', 'b')
		expect(rejection(send(lobby, 'a', SETUP_STATE_KEY, {}))).toBe('server_only')
		const relayed = action(
			lobby,
			'a',
			{ cid: 'c', action: SETUP_STATE_KEY, to: '*', params: {} },
			{ now: 1000, newSeed: () => 'S', newId: () => 'R', random },
		)
		expect(rejection(relayed)).toBe('authoritative_only')
	})
})
