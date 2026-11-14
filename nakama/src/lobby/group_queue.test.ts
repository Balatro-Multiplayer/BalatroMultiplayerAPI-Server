import { describe, expect, it } from 'vitest'
import { authoritativeAction } from '../actions/registry'
import { type Checkpoint, CHECKPOINT_SCHEMA, checkpointOf, isExpired, resumeFrom, seatHoldersOf } from './checkpoint'
import {
	GROUP_AWAY_CAP_MS,
	awayOver,
	cancelGroup,
	groupMatched,
	groupQueued,
	groupUnqueued,
	hasPlayerAnswer,
	openGroupQueue,
	refuseOpen,
	releaseGroups,
} from './group_queue'
import { CHECKPOINT_TTL_MS, ServerOp, type GroupQueueMessage } from './protocol'
import {
	type Lobby,
	type Step,
	close,
	disconnect,
	join,
	joinRejection,
	kick,
	leave,
	newLobby,
	snapshotFor,
	tick,
} from './state'

const GRACE = 10_000
const PARTY = '0b0c4a9e-7f43-4f43-9f6e-1d2c3b4a5f60.bmp-local'
const ON = { groupQueueEnabled: true }
const info = (name: string) => ({ displayName: name, preferredJoker: null, mods: null })

function home(...ids: string[]): Lobby {
	let lobby = newLobby({ code: 'HOME12', modId: 'M', maxPlayers: 4, creatorId: ids[0], now: 0, graceMs: GRACE })
	for (const id of ids) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	return lobby
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
	if (!r.ok) throw new Error('refused: ' + JSON.stringify(r.error))
	return r.value
}

const open = (lobby: Lobby, by = 'a') =>
	openGroupQueue(lobby, by, { partyId: PARTY, mode: 'std', teams: false }, ON, 100)
const forming = (lobby: Lobby) => unwrap(open(lobby)).lobby
const queued = (lobby: Lobby) => unwrap(groupQueued(forming(lobby), PARTY, 'T1')).lobby
const away = (lobby: Lobby, now = 1000) => unwrap(groupMatched(queued(lobby), PARTY, 'pub.m', 'PUB12', now)).lobby

function groupOps(step: Step): GroupQueueMessage[] {
	return step.out
		.filter((o) => o.kind === 'send' && o.op === ServerOp.GROUP_QUEUE)
		.map((o) => (o as { payload: GroupQueueMessage }).payload)
}
const kinds = (step: Step) => step.out.map((o) => o.kind)
const startGameReduction = (lobby: Lobby, from: string) =>
	authoritativeAction('mpapi_start_game')!.reduce(lobby, { from, now: 0, newSeed: () => 'S', newId: () => 'R', random: () => 0, disabledPvpModes: [] }, {})

describe('openGroupQueue', () => {
	it('forms the whole lobby as the group, binds the party and tells everyone', () => {
		const step = unwrap(open(home('a', 'b')))
		expect(step.lobby.groupQueue).toMatchObject({ phase: 'forming', partyId: PARTY, memberIds: ['a', 'b'] })
		expect(step.out[0]).toEqual({ kind: 'groupBind', partyId: PARTY, memberIds: ['a', 'b'] })
		const [op] = groupOps(step)
		expect(op).toMatchObject({ phase: 'forming', homeCode: 'HOME12', mode: 'std', hostId: 'a', reason: null })
		expect(step.out[1]).toMatchObject({ to: ['a', 'b'] })
	})

	it('refuses with the first reason that holds', () => {
		const code = (r: ReturnType<typeof open>) => (r.ok ? null : r.error.code)
		expect(code(openGroupQueue(home('a', 'b'), 'a', { partyId: PARTY, mode: 'std', teams: false }, { groupQueueEnabled: false }, 0))).toBe('disabled')
		expect(code(open(home('a', 'b'), 'b'))).toBe('not_host')
		expect(code(open(home('a', 'b'), 'z'))).toBe('not_in_lobby')
		expect(code(open(home('a')))).toBe('too_few')
		expect(code(open({ ...home('a', 'b'), allowedIds: ['a', 'b'] }))).toBe('not_private')
		expect(code(open({ ...home('a', 'b'), rankedMode: 'std' }))).toBe('ranked')
		expect(code(open(forming(home('a', 'b'))))).toBe('already_queued')
		expect(code(open(disconnect(home('a', 'b'), 'b', 'b-s1', 5).lobby))).toBe('member_away')
		const started = { ...home('a', 'b'), game: { ...home('a', 'b').game, started: {} as any } }
		expect(code(open(started))).toBe('in_game')
	})
})

describe('the queue phases', () => {
	it('goes forming -> queued -> away, and back to forming when the ticket goes', () => {
		const q = queued(home('a', 'b'))
		expect(q.groupQueue).toMatchObject({ phase: 'queued', ticket: 'T1' })
		const back = groupUnqueued(q, PARTY, false)
		expect(back.lobby.groupQueue).toMatchObject({ phase: 'forming' })
		expect((back.lobby.groupQueue as any).ticket).toBeUndefined()
		expect(groupOps(back)[0]).toMatchObject({ phase: 'forming', reason: 'ticket_removed', requeue: false })
		const requeue = groupUnqueued(q, PARTY, true)
		expect(groupOps(requeue)[0]).toMatchObject({ phase: 'forming', reason: 'match_refused', requeue: true })
	})

	it('refuses a ticket for another party, or twice', () => {
		const f = forming(home('a', 'b'))
		expect(groupQueued(f, 'other', 'T').ok).toBe(false)
		expect(groupQueued(queued(home('a', 'b')), PARTY, 'T2').ok).toBe(false)
		expect(groupMatched(f, PARTY, 'm', 'C', 0).ok).toBe(false)
	})

	it('goes away when matched: the party is broken up, the members told where', () => {
		const step = unwrap(groupMatched(queued(home('a', 'b')), PARTY, 'pub.m', 'PUB12', 1000))
		expect(step.lobby.groupQueue).toMatchObject({ phase: 'away', matchId: 'pub.m', code: 'PUB12', until: 1000 + GROUP_AWAY_CAP_MS })
		expect(kinds(step)[0]).toBe('groupDissolve')
		expect(groupOps(step)[0]).toMatchObject({ phase: 'away', matchId: 'pub.m', code: 'PUB12' })
	})

	it('comes back with nobody ready: matched clears the home ready flags', () => {
		const lobby = queued(home('a', 'b', 'c'))
		const readied = { ...lobby, game: { ...lobby.game, ready: { b: true, c: true } } }
		const step = unwrap(groupMatched(readied, PARTY, 'pub.m', 'PUB12', 1000))
		expect(step.lobby.game.ready).toEqual({})
		expect(snapshotFor(step.lobby, 'b').game.ready).toEqual({})
	})

	it('a member may cancel while forming or queued, not away; nobody else may', () => {
		const cancelled = unwrap(cancelGroup(queued(home('a', 'b')), PARTY, 'cancelled', 'b'))
		expect(cancelled.lobby.groupQueue).toBeNull()
		expect(cancelled.out[0]).toEqual({ kind: 'groupUnbind', partyId: PARTY, memberIds: ['a', 'b'], gameMode: 'std' })
		expect(groupOps(cancelled)[0]).toEqual({ phase: 'idle', partyId: PARTY, homeCode: 'HOME12', reason: 'cancelled', requeue: false })
		const refused = (r: ReturnType<typeof cancelGroup>) => (r.ok ? null : r.error.code)
		expect(refused(cancelGroup(queued(home('a', 'b')), PARTY, 'cancelled', 'z'))).toBe('not_member')
		expect(refused(cancelGroup(away(home('a', 'b')), PARTY, 'member_left_party', null))).toBe('group_away')
		expect(refused(cancelGroup(home('a', 'b'), PARTY, 'cancelled', 'a'))).toBe('not_bound')
	})
})

describe('a refused group queue open', () => {
	const refusedMember = { userId: 'b', reason: 'version_mismatch' as const, mods: [] }

	it('tells every player but the host who is in the way, and changes nothing', () => {
		const lobby = home('a', 'b', 'c')
		const step = refuseOpen(lobby, 'a', PARTY, refusedMember)
		expect(step.lobby).toBe(lobby)
		expect(step.out).toEqual([
			{
				kind: 'send',
				op: ServerOp.GROUP_QUEUE,
				payload: {
					phase: 'idle',
					partyId: PARTY,
					homeCode: 'HOME12',
					reason: 'member_refused',
					requeue: false,
					refused: refusedMember,
				},
				to: ['b', 'c'],
			},
		])
	})

	it('says nothing while the lobby already has a group queue', () => {
		expect(refuseOpen(forming(home('a', 'b')), 'a', PARTY, refusedMember).out).toEqual([])
	})
})

describe('the lobby while its group queues', () => {
	it('cancels when a member disconnects, leaves or is kicked', () => {
		for (const step of [
			disconnect(queued(home('a', 'b', 'c')), 'b', 'b-s1', 5),
			leave(forming(home('a', 'b', 'c')), 'b'),
			kick(queued(home('a', 'b', 'c')), 'a', 'b'),
		]) {
			expect(step.lobby.groupQueue).toBeNull()
			expect(kinds(step)).toContain('groupUnbind')
			expect(groupOps(step)[0].phase).toBe('idle')
		}
		expect(groupOps(disconnect(queued(home('a', 'b')), 'b', 'b-s1', 5))[0].reason).toBe('member_disconnected')
	})

	it('takes nobody new and starts no private game', () => {
		const f = forming(home('a', 'b'))
		expect(joinRejection(f, 'c', 'M')).toMatch(/group/)
		expect(joinRejection(f, 'b', 'M')).toBeNull()
		expect(startGameReduction(f, 'a')).toEqual({ reject: 'group_queue' })
	})

	it('closing ends the group queue', () => {
		const step = close(queued(home('a', 'b')))
		expect(kinds(step)[0]).toBe('groupUnbind')
		expect(groupOps(step)[0].reason).toBe('lobby_closed')
	})

	it('shows the group queue in the snapshot', () => {
		expect(snapshotFor(queued(home('a', 'b')), 'b').groupQueue).toMatchObject({ phase: 'queued', ticket: 'T1' })
		expect(snapshotFor(home('a', 'b'), 'b').groupQueue).toBeNull()
	})
})

describe('the lobby while its group is away', () => {
	const gone = () => {
		let l = away(home('a', 'b'))
		l = disconnect(l, 'a', 'a-s1', 2000).lobby
		return disconnect(l, 'b', 'b-s1', 2000)
	}

	it('keeps its host and stays open with everyone gone', () => {
		const step = gone()
		expect(step.lobby.closed).toBe(false)
		expect(step.lobby.hostId).toBe('a')
		expect(kinds(step)).not.toContain('groupUnbind')
	})

	it('runs out no grace period until the cap', () => {
		const l = gone().lobby
		expect(tick(l, 2000 + GRACE * 10).lobby.players).toHaveLength(2)
		const capped = tick(l, 1000 + GROUP_AWAY_CAP_MS)
		expect(groupOps(capped)[0].reason).toBe('away_cap')
		expect(capped.lobby.groupQueue).toBeNull()
		// A fresh grace period from the cap on.
		expect(capped.lobby.players.map((p) => p.awaySince)).toEqual([1000 + GROUP_AWAY_CAP_MS, 1000 + GROUP_AWAY_CAP_MS])
		expect(tick(capped.lobby, 1000 + GROUP_AWAY_CAP_MS + GRACE).lobby.closed).toBe(true)
	})

	it("ends at the public game's away_over, the still-away members' grace starting then", () => {
		const l = gone().lobby
		expect(awayOver(l, PARTY, 'OTHER', 9000).out).toEqual([])
		const over = awayOver(l, PARTY, 'PUB12', 9000)
		expect(over.lobby.groupQueue).toBeNull()
		expect(groupOps(over)[0].reason).toBe('away_over')
		expect(over.lobby.players.map((p) => p.awaySince)).toEqual([9000, 9000])
		expect(tick(over.lobby, 9000 + GRACE - 1).lobby.players).toHaveLength(2)
	})

	it('ends once every member is back, each return writing their seat record again', () => {
		const l = gone().lobby
		const a = join(l, 'a', 'a-s2', info('a'))
		expect(a.out[0]).toEqual({ kind: 'setCurrent', userId: 'a' })
		expect(a.lobby.groupQueue).toMatchObject({ phase: 'away' })
		const b = join(a.lobby, 'b', 'b-s2', info('b'))
		expect(b.lobby.groupQueue).toBeNull()
		expect(groupOps(b)[0].reason).toBe('all_returned')
	})

	it('a member leaving for good is dropped from the group; the host moves to whoever is left', () => {
		const step = leave(gone().lobby, 'a')
		expect(step.lobby.closed).toBe(false)
		expect(step.lobby.hostId).toBe('b')
		expect(step.lobby.groupQueue).toMatchObject({ phase: 'away', memberIds: ['b'] })
	})

	it("answers 'away' to the public lobby it is away at, 'yes' to anyone else", () => {
		const l = gone().lobby
		expect(hasPlayerAnswer(l, 'a', 'pub.m')).toBe('away')
		expect(hasPlayerAnswer(l, 'a', 'other.m')).toBe('yes')
		expect(hasPlayerAnswer(l, 'a', undefined)).toBe('yes')
		expect(hasPlayerAnswer(l, 'z', 'pub.m')).toBe('no')
		expect(hasPlayerAnswer(queued(home('a', 'b')), 'a', 'pub.m')).toBe('yes')
	})
})

describe('restart checkpoints', () => {
	it('an away lobby waits as long as its seats are parked', () => {
		const l = away(home('a', 'b'), 1000)
		const cp = checkpointOf(l, 2000)!
		expect(cp.expiresAt).toBe(1000 + GROUP_AWAY_CAP_MS)
		expect(isExpired(cp, 2000 + CHECKPOINT_TTL_MS)).toBe(false)
		expect(isExpired(cp, 1000 + GROUP_AWAY_CAP_MS)).toBe(true)
		// One with no expiresAt is not one this build wrote: expired at once.
		const unstamped = { schema: CHECKPOINT_SCHEMA, lobby: l, at: 0, claimedAt: null } as unknown as Checkpoint
		expect(isExpired(unstamped, 0)).toBe(true)
	})

	it('a resumed lobby keeps an away group and its records; forming or queued is gone with the party', () => {
		const l = away(home('a', 'b', 'c'))
		const withoutC = { ...l, groupQueue: { ...l.groupQueue!, memberIds: ['a', 'b'] } } as Lobby
		const stored = (lobby: Lobby): Checkpoint => {
			const checkpoint = checkpointOf(lobby, 0)
			if (!checkpoint) throw new Error('the lobby has players, so it checkpoints')
			return checkpoint
		}
		expect(resumeFrom(stored(withoutC), 5).groupQueue).toMatchObject({ phase: 'away' })
		expect(seatHoldersOf(withoutC)).toEqual(['c'])
		const q = queued(home('a', 'b'))
		expect(resumeFrom(stored(q), 5).groupQueue).toBeNull()
		expect(seatHoldersOf(q)).toEqual(['a', 'b'])
	})
})

describe('releaseGroups', () => {
	const groups = [{ partyId: PARTY, homeCode: 'HOME12', memberIds: ['a', 'b'] }]
	const pub = (): Lobby => ({
		...newLobby({ code: 'PUB12', modId: 'M', maxPlayers: 3, creatorId: 'a', allowedIds: ['a', 'b', 'c'], groups, now: 0, graceMs: GRACE }),
	})

	it('tells each home once, at the first game end', () => {
		const l = pub()
		expect(releaseGroups(false, l).out).toEqual([])
		const ended = releaseGroups(true, l)
		expect(ended.out).toEqual([{ kind: 'awayOver', homeCode: 'HOME12', partyId: PARTY }])
		expect(releaseGroups(true, ended.lobby).out).toEqual([])
	})

	it('or when the lobby closes first', () => {
		expect(releaseGroups(false, { ...pub(), closed: true }).out).toHaveLength(1)
		expect(releaseGroups(true, newLobby({ code: 'X', modId: 'M', maxPlayers: 2, creatorId: 'a', now: 0, graceMs: 1 })).out).toEqual([])
	})
})
