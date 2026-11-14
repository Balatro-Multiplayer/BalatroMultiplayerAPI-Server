// pvpTick: the referee's decisions, with the real duel rules (docs/pvp-match.md
// sections 6 and 10). Facts go in through the same reducers the requests use.
import fc from 'fast-check'
import { describe, expect, it, test } from 'vitest'
import { restartedGame } from '../../actions/registry'
import { settle } from '../../actions/results'
import { testContext } from '../../testing/request_context'
import { startOf, reportAll } from '../../testing/pvp_fixtures'
import { fromRuntime } from '../../testing/runtime_state'
import { changedKeys as changedMatchKeys } from '../match_state'
import { type PvpLastStart, type RunRecord, ServerOp } from '../protocol'
import { action } from '../relay'
import {
	type Lobby,
	type Outbound,
	type Step,
	join,
	leave,
	newLobby,
	setMetadata,
} from '../state'
import { FACT_REDUCERS } from './facts'
import { anteRunOut, anteRunOuts } from './deadline'
import { placementsOf } from './pvp_tick'
import { rankedPinOf } from './ranked_pin'
import { pickMode } from './modes'
import { aliveIds } from './modes/common'
import { duelMode } from './modes/duel'
import { nemesisMode } from './modes/nemesis'
import { royaleMode } from './modes/royale'
import { inertMode } from './modes/testing'
import type { VoucherGainers } from './modes/types'
import { pvpOf, readyReducer } from './ready'
import { PVP_REQUESTS } from './register'
import { pvpTick } from './referee'
import { checkpointOf, resumeFrom } from '../checkpoint'
import {
	type PvpFact,
	type RefereeState,
	emptyFacts,
	emptyPvp,
	refereeOf,
	withFact,
	withReferee,
} from './state'
import { type ModeFor, type TickEnv, decide, preFreezeEnd } from './tick'
import { withRules } from '../../testing/pvp_rules'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})
const ctx = testContext(1000)
const RULED = { ruleset: 'ruleset_mp_balanced' }

let ids = 0
const actionCtx = (now: number) => ({
	now,
	newSeed: () => `SEED${++ids}`,
	newId: () => `RUN${++ids}`,
	random: () => 0,
})

function send(
	lobby: Lobby,
	from: string,
	key: string,
	params: unknown = {},
	now = 1000,
) {
	return action(
		lobby,
		from,
		{ cid: `${key}-${from}`, action: key, to: 'server', params },
		actionCtx(now),
	)
}

type Send = Extract<Outbound, { kind: 'send' }>
const sends = (step: Step): Send[] =>
	step.out.filter((o): o is Send => o.kind === 'send')
const rejection = (step: Step): string | undefined => {
	const r = sends(step).find((o) => o.op === ServerOp.ACTION_REJECTED)
	return r && (r.payload as { reason: string }).reason
}
const rejectedKey = (step: Step): string | undefined => {
	const r = sends(step).find((o) => o.op === ServerOp.ACTION_REJECTED)
	return r && (r.payload as { key?: string }).key
}
const saved = (step: Step): RunRecord | undefined => {
	const o = step.out.find((x) => x.kind === 'saveRun')
	return o && o.kind === 'saveRun' ? o.run : undefined
}

// A PvP lobby of `players` (the first hosts) with a game started and the first
// tick run: rules frozen, lives seated, no round open yet (nobody is ready).
function started(...players: string[]): Lobby {
	return pvpTick(raced(startedLobby(...players)), ctx).lobby
}

// The same lobby right after mpapi_start_game, before any tick.
function startedLobby(...players: string[]): Lobby {
	return startedLobbyWith({}, ...players)
}

// The same, with `metadata` on the lobby before the start (the ruleset is frozen from it).
function startedLobbyWith(
	metadata: { [key: string]: unknown },
	...players: string[]
): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerPvP',
		maxPlayers: 8,
		creatorId: players[0],
		now: 0,
		graceMs: 10_000,
		resultTimeoutMs: 60_000,
	})
	lobby = {
		...lobby,
		metadata: withRules({ ruleset: 'ruleset_mp_traditional', ...lobby.metadata, ...metadata }),
	}
	for (const id of players) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	for (const id of players.slice(1))
		lobby = send(lobby, id, 'mpapi_ready', { ready: true }).lobby
	const step = send(lobby, players[0], 'mpapi_start_game', { stake: 2 })
	expect(rejection(step)).toBeUndefined()
	return step.lobby
}

// `id` sends pvp.ready for the next round with `hands` starting hands.
function ready(
	lobby: Lobby,
	id: string,
	hands = 4,
	blindKey?: string,
): Lobby {
	const pvp = pvpOf(lobby)
	if (!pvp) throw new Error('no pvp state')
	const r = readyReducer.reduce(
		lobby,
		id,
		{
			runId: pvp.runId,
			roundId: pvp.round + 1,
			startingHands: hands,
			// Each round is its own blind: a Ready on the one just started is refused.
			blindKey: blindKey ?? `${pvp.round + 2}:Boss`,
		},
		ctx,
	)
	if (!r.ok) throw new Error(`refused: ${r.reason}`)
	return r.lobby
}

// Everyone ready for the next round, then the tick that opens it.
function game(...players: string[]): Lobby {
	return gameOn('2:Boss', ...players)
}

// The same, under a ruleset with the PvP hand timer (60 s, 10 s a hand).
function gameRuled(...players: string[]): Lobby {
	return gameOn('2:Boss', ...players, RULED)
}

// The same, with every player Readying `blindKey` (an ante-1 key for tests that model ante 1).
function gameOn(blindKey: string, ...rest: (string | typeof RULED)[]): Lobby {
	const metadata = rest.find((r) => typeof r !== 'string') ?? {}
	const players = rest.filter((r): r is string => typeof r === 'string')
	let lobby = pvpTick(raced(startedLobbyWith(metadata, ...players)), ctx).lobby
	for (const id of players) lobby = ready(lobby, id, 4, blindKey)
	return begun(pvpTick(lobby, ctx).lobby)
}

// Every player of the open round reports its blind's start (score 0, `hands`
// hands), as the clients' pvp.blind_start does.
function begun(lobby: Lobby, hands = 4): Lobby {
	const roundId = stateOf(lobby).round.roundId
	let next = lobby
	for (const id of Object.keys(stateOf(lobby).round.players))
		next = fact(next, 'pvp.blind_start', id, {
			roundId,
			handsLeft: hands,
			score: '0',
			timerLossesApplied: 0,
		})
	return next
}

const stateOf = (lobby: Lobby): RefereeState => {
	const s = refereeOf(lobby)
	if (!s) throw new Error('no referee state')
	return s
}
const runIdOf = (lobby: Lobby): string => stateOf(lobby).runId
const livesOf = (lobby: Lobby, id: string): number =>
	stateOf(lobby).lives.players[id].lives

// A fact through its request reducer (a refusal throws).
function fact(lobby: Lobby, type: string, from: string, args: object): Lobby {
	// a deadline the client reports a run-out of was opened by the server
	const before = stateOf(lobby)
	const opened = { ...before, facts: { ...before.facts, timerN: 9 } }
	const result = FACT_REDUCERS[type](opened, from, {
		runId: runIdOf(lobby),
		...args,
	})
	if (!result.ok) throw new Error(`refused: ${result.reason}`)
	return withReferee(lobby, result.state)
}
const tickOf = (lobby: Lobby): Lobby => pvpTick(lobby, ctx).lobby

const blind = (
	l: Lobby,
	id: string,
	key: string,
	beaten: boolean,
	roundLost: boolean,
) => fact(l, 'pvp.blind', id, { blindKey: key, beaten, roundLost })
// One Ante expiry running out every id of `ids` at once (deadline.ts anteRunOuts).
function ranOutTogether(
	s: RefereeState,
	ids: string[],
): RefereeState {
	if (s.result.kind !== null) return s
	const mode = pickMode(s.rules.mode ?? 'royale', s.rules.startedCount)
	return anteRunOuts(s, mode, ids)
}

// The server's own Ante run-out of `id` as the tick makes it (deadline.ts anteRunOut).
// Nothing once the game is decided (the deadline is gone by then).
function ranOut(s: RefereeState, id: string): RefereeState {
	if (s.result.kind !== null) return s
	const mode = pickMode(s.rules.mode ?? 'royale', s.rules.startedCount)
	return anteRunOut(s, mode, id)
}

const timer = (l: Lobby, id: string): Lobby =>
	withReferee(l, ranOut(stateOf(l), id))

// The round's scores and hands, as the hand facts would leave them.
function round(lobby: Lobby, a: [string, number], b: [string, number]): Lobby {
	const s = stateOf(lobby)
	const players = { ...s.round.players }
	players.a = { ...players.a, score: a[0], handsLeft: a[1] }
	players.b = { ...players.b, score: b[0], handsLeft: b[1] }
	return withReferee(lobby, { ...s, round: { ...s.round, players } })
}

// A PvP hand timer started by `by` against `against`, as the tick would hold it
// (the server counts it: it ends at t = 2000 and the tick at that time runs it out).
function pvpTimed(lobby: Lobby, by: string, against: string): Lobby {
	const s = stateOf(lobby)
	return withReferee(lobby, {
		...s,
		facts: {
			...s.facts,
			deadline: {
				kind: 'pvp',
				by,
				against: [against],
				endsAt: 2000,
				shownMs: 1000,
				n: 1,
			},
		},
	})
}

// An Ante deadline of `by` against `against` that is already past at the test tick:
// the tick itself makes the run-out (the life lost the server's way).
function anteExpired(lobby: Lobby, by: string, against: string): Lobby {
	const s = stateOf(lobby)
	return withReferee(lobby, {
		...s,
		facts: {
			...s.facts,
			deadline: {
				kind: 'ante',
				by,
				against: [against],
				endsAt: 500,
				shownMs: 0,
				n: 1,
			},
		},
	})
}

const tickAt = (lobby: Lobby, now: number): Lobby =>
	pvpTick(lobby, testContext(now)).lobby

function withLives(lobby: Lobby, id: string, lives: number): Lobby {
	const s = stateOf(lobby)
	const seat = s.lives.players[id]
	return withReferee(lobby, {
		...s,
		lives: {
			...s.lives,
			players: { ...s.lives.players, [id]: { ...seat, lives } },
		},
	})
}

describe('lives (docs/pvp-match.md section 10, case 9; R2-R4)', () => {
	it('two ante-timer run-outs in one blind cost two lives (R3)', () => {
		let l = game('a', 'b')
		l = timer(l, 'a')
		l = timer(l, 'a')
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(2)
		expect(livesOf(l, 'b')).toBe(4)
	})

	it('one run-out with deathOnRoundLoss costs exactly one life', () => {
		let l = game('a', 'b')
		l = timer(l, 'a')
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(3)
		expect(tickOf(l)).toEqual(l)
	})

	it('a run-out then pvp.blind roundLost in the same blind costs two lives (R3 + R4)', () => {
		let l = game('a', 'b')
		l = timer(l, 'a')
		l = blind(l, 'a', '1:Small', false, true)
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(2)
	})

	it('beaten:false without roundLost costs no life (R12)', () => {
		let l = game('a', 'b')
		l = blind(l, 'a', '1:Small', false, false)
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(4)
	})

	it('a failed Small then a failed Big in one ante cost two lives: the guard is per blind (R2 991-1000, 1603)', () => {
		let l = game('a', 'b')
		l = blind(l, 'a', '1:Small', false, true)
		l = blind(l, 'a', '1:Big', false, true)
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(2)
	})

	it('the same blindKey twice costs one life, even when both facts reach the log', () => {
		let l = game('a', 'b')
		l = blind(l, 'a', '1:Small', false, true)
		l = blind(l, 'a', '1:Small', false, true)
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(3)
		// a duplicate fact that got past the reducer is still one loss
		const s = stateOf(l)
		const dup: PvpFact = {
			type: 'blind',
			playerId: 'a',
			blindKey: '1:Small',
			beaten: false,
			roundLost: true,
		}
		const forced = withReferee(l, {
			...s,
			facts: { ...s.facts, log: [...s.facts.log, dup] },
		})
		expect(livesOf(tickOf(forced), 'a')).toBe(3)
	})

	it('a roundLost on the blind a PvP round was lost on costs nothing more (R2)', () => {
		let l = gameOn('1:Boss', 'a', 'b')
		l = round(l, ['5', 0], ['9', 0])
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(3)
		l = blind(l, 'a', '1:Boss', false, true)
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(3)
		// another blind is another guard
		l = blind(l, 'a', '2:Small', false, true)
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(2)
	})

	it('a run-out is unguarded: it leaves the guard of a later roundLost alone (R3)', () => {
		let l = game('a', 'b')
		l = timer(l, 'a')
		l = tickOf(l)
		l = round(l, ['5', 0], ['9', 0])
		l = tickOf(l)
		// the run-out (1) did not spend the guard, so the PvP loss (1) is not blocked
		expect(livesOf(l, 'a')).toBe(2)
	})

	it('without deathOnRoundLoss a roundLost fail costs nothing (R4)', () => {
		let l = game('a', 'b')
		const s = stateOf(l)
		l = withReferee(l, {
			...s,
			rules: {
				...(s.rules as Extract<typeof s.rules, { runId: string }>),
				deathOnRoundLoss: false,
			},
		})
		l = blind(l, 'a', '1:Small', false, true)
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(4)
	})
})

describe('round resolution (R16-R18)', () => {
	it('resolves once: the loser pays one life and the round is not resolved again', () => {
		let l = game('a', 'b')
		l = round(l, ['5', 0], ['9', 0])
		l = tickOf(l)
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(3)
		expect(livesOf(l, 'b')).toBe(4)
		// the round is the start's id (1): a resolve leaves it
		expect(stateOf(l).round.roundId).toBe(1)
		expect(
			stateOf(l).lives.players.a.events.filter((e) => e.key === 'pvp:1'),
		).toHaveLength(1)
	})

	it('a resolved round stays resolved, scores kept, until the next pvp.ready start', () => {
		let l = game('a', 'b')
		l = round(l, ['5', 0], ['9', 0])
		l = tickOf(l)
		for (let i = 0; i < 3; i++) {
			l = tickOf(l)
			const s = stateOf(l)
			expect(s.round.phase).toBe('resolved')
			expect(s.round.players.a.score).toBe('5')
			expect(s.round.players.b.score).toBe('9')
		}
		// one ready is not a start; both are
		l = ready(l, 'a', 6)
		expect(stateOf(tickOf(l)).round.phase).toBe('resolved')
		l = tickOf(ready(l, 'b', 3))
		const s = stateOf(l)
		expect(s.round.phase).toBe('playing')
		expect(s.round.roundId).toBe(2)
		expect(s.round.players.a).toMatchObject({ score: null, handsLeft: null })
		expect(s.round.players.b).toMatchObject({ score: null, handsLeft: null })
		// the open round is not opened twice
		expect(tickOf(l)).toEqual(l)
	})

	it('the first round does not open until both players are ready (R9)', () => {
		let l = started('a', 'b')
		expect(stateOf(l).round.phase).toBe('shop')
		l = tickOf(ready(l, 'a'))
		expect(stateOf(l).round.phase).toBe('shop')
		l = tickOf(ready(l, 'b'))
		expect(stateOf(l).round.phase).toBe('playing')
		expect(stateOf(l).round.roundId).toBe(1)
	})

	it('the opened round knows nothing of the hands: a Ready does not set them, only pvp.blind_start does', () => {
		let l = started('a', 'b')
		l = tickOf(ready(ready(l, 'a', 6), 'b', 3))
		const s = stateOf(l)
		expect(s.round.players.a.handsLeft).toBeNull()
		expect(s.round.players.b.handsLeft).toBeNull()
		l = begun(l, 6)
		expect(stateOf(l).round.players.a.handsLeft).toBe(6)
		expect(stateOf(l).round.players.b.handsLeft).toBe(6)
	})

	it('every player Readying while round N plays resolves it on the server scores, charges the loser and opens N+1 in one tick', () => {
		let l = game('a', 'b')
		l = round(l, ['5', 2], ['9', 3])
		expect(stateOf(l).round.roundId).toBe(1)
		// both ready for round 2 while round 1 is still being played
		l = tickOf(ready(ready(l, 'a', 5), 'b', 5))
		const s = stateOf(l)
		expect(s.lastStart?.roundId).toBe(2)
		expect(s.round.roundId).toBe(2)
		expect(s.round.phase).toBe('playing')
		expect(s.round.lastResult).toEqual({ roundId: 1, losers: ['a'] })
		// round 1 had a leader and a trailer: the trailer paid one life
		expect(livesOf(l, 'a')).toBe(3)
		expect(livesOf(l, 'b')).toBe(4)
		expect(
			stateOf(l).lives.players.a.events.filter((e) => e.key === 'pvp:1'),
		).toHaveLength(1)
		expect(
			stateOf(l).lives.players.b.events.filter((e) => e.key === 'pvp:1'),
		).toHaveLength(0)
		expect(s.round.players.a).toMatchObject({ score: null, handsLeft: null })
		expect(s.round.players.b).toMatchObject({ score: null, handsLeft: null })
		expect(tickOf(l)).toEqual(l)
	})

	// Found live: the server reads match state through runtime wrappers, where two
	// reads of one nested object are never ===. The tick told a new result from
	// the last round's by ===, so every tick of round 2 charged round 1's loser
	// again, down to 0 lives, and the game was awarded as the round started.
	it('the next round costs the last round loser nothing more, on state read back from the runtime', () => {
		let l = game('a', 'b')
		l = tickOf(round(l, ['5', 0], ['9', 0]))
		expect(livesOf(l, 'a')).toBe(3)
		l = tickOf(ready(ready(l, 'a'), 'b'))
		expect(stateOf(l).round).toMatchObject({ roundId: 2, phase: 'playing' })
		for (let i = 0; i < 3; i++) l = tickOf(fromRuntime(l))
		expect(l.game.started).not.toBeNull()
		expect(livesOf(l, 'a')).toBe(3)
		expect(
			stateOf(l).lives.players.a.events.filter((e) => e.key === 'pvp:1'),
		).toHaveLength(1)
		expect(stateOf(l).result.kind).toBeNull()
	})

	it('a PvP run-out lowers the count, a hand that has not seen it still shows the loss, one above the report is stale_hand', () => {
		let l = gameRuled('a', 'b')
		l = fact(l, 'pvp.hand', 'b', {
			roundId: 1,
			score: '50',
			handsLeft: 3,
			timerLossesApplied: 0,
		})
		l = tickAt(pvpTimed(l, 'b', 'a'), 2000)
		expect(stateOf(l).round.players.a.handsLeft).toBe(3)
		l = fact(l, 'pvp.hand', 'a', {
			roundId: 1,
			score: '10',
			handsLeft: 3,
			timerLossesApplied: 0,
		})
		expect(stateOf(l).round.players.a).toMatchObject({
			score: '10',
			handsLeft: 2,
		})
		const above = FACT_REDUCERS['pvp.hand'](stateOf(l), 'a', {
			runId: runIdOf(l),
			roundId: 1,
			score: '11',
			handsLeft: 5,
			timerLossesApplied: 1,
		})
		expect(above).toEqual({ ok: false, reason: 'stale_hand' })
	})

	it('B5: a PvP deadline held with no client report runs out at its end and costs a hand', () => {
		let l = gameRuled('a', 'b')
		// b is ahead, so the deadline against a holds
		l = fact(l, 'pvp.hand', 'b', {
			roundId: 1,
			score: '50',
			handsLeft: 3,
			timerLossesApplied: 0,
		})
		l = pvpTimed(l, 'b', 'a')
		l = tickAt(l, 1500)
		expect(stateOf(l).round.players.a.timerLosses).toBe(0)
		l = tickAt(l, 2000)
		expect(stateOf(l).round.players.a.timerLosses).toBe(1)
		expect(stateOf(l).round.players.a.handsLeft).toBe(3)
	})

	it('a hand leaving 1, then a PvP run-out to 0, resolves the round and a loses', () => {
		let l = gameRuled('a', 'b')
		l = fact(l, 'pvp.hand', 'a', {
			roundId: 1,
			score: '10',
			handsLeft: 1,
			timerLossesApplied: 0,
		})
		l = fact(l, 'pvp.hand', 'b', {
			roundId: 1,
			score: '50',
			handsLeft: 1,
			timerLossesApplied: 0,
		})
		// the hands' credits are in the allowances before the timer is held
		l = pvpTimed(tickOf(l), 'b', 'a')
		l = tickAt(l, 2000)
		expect(stateOf(l).round.lastResult?.losers).toEqual(['a'])
		expect(stateOf(l).facts.deadline).toBeNull()
		expect(livesOf(l, 'a')).toBe(3)
	})

	it('a start naming a player with no blind key is an invariant break, not a guess', () => {
		const l = started('a', 'b')
		const pvp = pvpOf(l)
		if (!pvp) throw new Error('no pvp state')
		const broken: Lobby = {
			...l,
			game: {
				...l.game,
				pvp: {
					...pvp,
					round: 1,
					lastStart: {
						roundId: 1,
						firstPlayer: null,
						players: ['a', 'b'],
						blindKeys: { a: '2:Boss' },
					},
				},
			},
		}
		expect(() => pvpTick(broken, ctx)).toThrow('without a blind key')
	})

	it('a hand with roundId = lastStart.roundId is accepted in the first round', () => {
		const l = game('a', 'b')
		expect(stateOf(l).lastStart?.roundId).toBe(1)
		const r = FACT_REDUCERS['pvp.hand'](stateOf(l), 'a', {
			runId: runIdOf(l),
			roundId: stateOf(l).lastStart?.roundId,
			score: '3',
			handsLeft: 3,
			timerLossesApplied: 0,
		})
		expect(r.ok).toBe(true)
		// the old 0-based number is now the wrong round
		const old = FACT_REDUCERS['pvp.hand'](stateOf(l), 'a', {
			runId: runIdOf(l),
			roundId: 0,
			score: '3',
			handsLeft: 3,
			timerLossesApplied: 0,
		})
		expect(old).toMatchObject({ ok: false, reason: 'round_over' })
	})

	it('two early starts end at the newest with the same rule', () => {
		let l = game('a', 'b')
		l = ready(ready(l, 'a', 5), 'b', 5)
		l = tickOf(ready(ready(l, 'a', 6), 'b', 6))
		const s = stateOf(l)
		expect(s.lastStart?.roundId).toBe(3)
		expect(s.round.roundId).toBe(3)
		expect(s.round.phase).toBe('playing')
		expect(s.round.lastResult).toEqual({ roundId: 1, losers: [] })
		expect(s.round.players.a.handsLeft).toBeNull()
		expect(livesOf(l, 'a')).toBe(4)
		expect(tickOf(l)).toEqual(l)
	})

	it('the normal resolve then start path is unchanged', () => {
		let l = tickOf(round(game('a', 'b'), ['5', 0], ['9', 0]))
		expect(stateOf(l).round).toMatchObject({
			phase: 'resolved',
			roundId: 1,
			lastResult: { roundId: 1, losers: ['a'] },
		})
		l = tickOf(ready(ready(l, 'a', 5), 'b', 5))
		expect(stateOf(l).round).toMatchObject({ phase: 'playing', roundId: 2 })
		expect(livesOf(l, 'a')).toBe(3)
	})

	it('two PvP losses with no pvp.progress between cost two lives (R18, finding 13)', () => {
		let l = gameOn('1:Boss', 'a', 'b')
		l = tickOf(round(l, ['5', 0], ['9', 0]))
		l = tickOf(ready(ready(l, 'a', 4, '1:Boss'), 'b', 4, '1:Boss'))
		expect(stateOf(l).round.phase).toBe('playing')
		l = tickOf(round(l, ['5', 0], ['9', 0]))
		expect(livesOf(l, 'a')).toBe(2)
		expect(
			stateOf(l)
				.lives.players.a.events.map((e) => e.key)
				.filter((k) => k?.startsWith('pvp:')),
		).toEqual(['pvp:1', 'pvp:2'])
		// the blind both were lost on is still spent: a roundLost on it costs nothing
		l = tickOf(blind(l, 'a', '1:Boss', false, true))
		expect(livesOf(l, 'a')).toBe(2)
	})

	it('a PvP loss on a blind a roundLost already charged costs nothing more', () => {
		let l = gameOn('1:Boss', 'a', 'b')
		l = tickOf(blind(l, 'a', '1:Boss', false, true))
		expect(livesOf(l, 'a')).toBe(3)
		l = tickOf(round(l, ['5', 0], ['9', 0]))
		expect(livesOf(l, 'a')).toBe(3)
	})

	it('a roundLost recorded but free on a spent guard does not swallow the next PvP loss', () => {
		let l = gameOn('1:Boss', 'a', 'b')
		l = tickOf(round(l, ['5', 0], ['9', 0]))
		expect(livesOf(l, 'a')).toBe(3)
		// a roundLost on the PvP blind: free (the guard is spent), but recorded
		l = tickOf(blind(l, 'a', '1:Boss', false, true))
		expect(livesOf(l, 'a')).toBe(3)
		l = tickOf(ready(ready(l, 'a', 4, '1:Boss'), 'b', 4, '1:Boss'))
		l = tickOf(round(l, ['5', 0], ['9', 0]))
		expect(livesOf(l, 'a')).toBe(2)
	})

	it('an exact tie costs nobody a life', () => {
		let l = game('a', 'b')
		l = round(l, ['7', 0], ['7', 0])
		l = tickOf(l)
		expect(livesOf(l, 'a')).toBe(4)
		expect(livesOf(l, 'b')).toBe(4)
	})
})

// A PvP loss is guarded on the loser's OWN Ready blindKey of the round. A
// Manhunt voucher lowers one player's ante, so it is not `<highest ante>:Boss`.
describe('PvP guard key per player', () => {
	const progress = (l: Lobby, id: string, ante: number) =>
		fact(l, 'pvp.progress', id, { ante, furthestBlind: 0 })
	// Both Ready (on their own keys), the round opens; `a` 5, `b` 9, no hands left.
	const played = (l: Lobby, keyA: string, keyB: string): Lobby =>
		tickOf(
			round(
				tickOf(ready(ready(l, 'a', 4, keyA), 'b', 4, keyB)),
				['5', 0],
				['9', 0],
			),
		)

	it.each([
		['2:Boss', '2:Boss'],
		['2:Boss', '3:Boss'],
		['3:Boss', '2:Boss'],
	])(
		'a (ante 3) Readied on %s, b on %s: a loses the PvP round and the roundLost on a own key costs nothing more',
		(keyA, keyB) => {
			let l = progress(started('a', 'b'), 'a', 3)
			l = played(l, keyA, keyB)
			expect(livesOf(l, 'a')).toBe(3)
			l = tickOf(blind(l, 'a', keyA, false, true))
			expect(livesOf(l, 'a')).toBe(3)
			// another blind is another guard
			l = tickOf(blind(l, 'a', '1:Small', false, true))
			expect(livesOf(l, 'a')).toBe(2)
		},
	)

	it('a player reports ante 3, Readies on 2:Boss, loses the PvP round and the roundLost for 2:Boss follows: one life lost', () => {
		let l = progress(started('a', 'b'), 'a', 3)
		l = played(l, '2:Boss', '2:Boss')
		l = tickOf(blind(l, 'a', '2:Boss', false, true))
		expect(livesOf(l, 'a')).toBe(3)
	})

	it("the loser's own key counts, not the winner's", () => {
		let l = played(started('a', 'b'), '2:Boss', '3:Boss')
		l = tickOf(blind(l, 'b', '3:Boss', false, true))
		// b won: its blind is not spent, so its roundLost costs
		expect(livesOf(l, 'b')).toBe(3)
		l = tickOf(blind(l, 'a', '3:Boss', false, true))
		// a lost on 2:Boss, so a roundLost on another key costs
		expect(livesOf(l, 'a')).toBe(2)
	})

	it('the memo holds one key per player per round, once', () => {
		let l = played(started('a', 'b'), '2:Boss', '3:Boss')
		expect(stateOf(l).facts.pvpBlinds).toEqual({ a: ['2:Boss'], b: ['3:Boss'] })
		l = tickOf(l)
		expect(stateOf(l).facts.pvpBlinds).toEqual({ a: ['2:Boss'], b: ['3:Boss'] })
		l = tickOf(ready(ready(l, 'a', 4, '4:Boss'), 'b', 4, '4:Boss'))
		expect(stateOf(l).facts.pvpBlinds).toEqual({
			a: ['2:Boss', '4:Boss'],
			b: ['3:Boss', '4:Boss'],
		})
	})

	it('a player who did not start the round gets no key and no life lost: nothing is invented for them', () => {
		let l = progress(started('a', 'b'), 'a', 3)
		l = played(l, '2:Boss', '2:Boss')
		expect(livesOf(l, 'a')).toBe(3)
		l = ready(ready(l, 'a', 4, '3:Boss'), 'b', 4, '3:Boss')
		const pvp = pvpOf(l)
		if (!pvp?.lastStart) throw new Error('no start')
		const lastStart = {
			...pvp.lastStart,
			players: ['b'],
			blindKeys: { b: '3:Boss' },
		}
		l = { ...l, game: { ...l.game, pvp: { ...pvp, lastStart } } }
		l = tickOf(round(tickOf(l), ['5', 0], ['9', 0]))
		expect(stateOf(l).facts.pvpBlinds.a).toEqual(['2:Boss'])
		expect(stateOf(l).facts.pvpBlinds.b).toEqual(['2:Boss', '3:Boss'])
		expect(livesOf(l, 'a')).toBe(3)
	})
})

// A guard spent on a blind is armed again when a round on that blind opens
// (R2): the same `<ante>:Boss` PvP blind can be lost on once
// per round.
describe('the life guard is re-armed when a round opens', () => {
	const open2 = (l: Lobby): Lobby =>
		tickOf(ready(ready(l, 'a', 4, '2:Boss'), 'b', 4, '2:Boss'))
	const lose = (l: Lobby): Lobby => tickOf(round(l, ['5', 0], ['9', 0]))
	const readyOn = (l: Lobby, key: string) => {
		const pvp = pvpOf(l)
		if (!pvp) throw new Error('no pvp state')
		return readyReducer.reduce(
			l,
			'a',
			{ runId: pvp.runId, roundId: pvp.round + 1, startingHands: 4, blindKey: key },
			ctx,
		)
	}

	it('refuses a Ready on the Boss the open round plays, accepts it once the round resolved', () => {
		const open = open2(started('a', 'b'))
		const during = readyOn(open, '2:Boss')
		expect(during.ok).toBe(false)
		if (!during.ok) expect(during.reason).toBe('round_over')
		// A Manhunt voucher can bring the same Boss back after the round.
		expect(readyOn(lose(open), '2:Boss').ok).toBe(true)
	})

	it('a roundLost on the Boss, then the same Boss Readied in two more rounds: one life per round lost', () => {
		let l = open2(started('a', 'b'))
		l = tickOf(blind(l, 'a', '2:Boss', false, true))
		expect(livesOf(l, 'a')).toBe(3)
		l = lose(l)
		// the PvP loss of round 1 is the roundLost already charged on the blind
		expect(livesOf(l, 'a')).toBe(3)
		l = lose(open2(l))
		expect(livesOf(l, 'a')).toBe(2)
		l = lose(open2(l))
		expect(livesOf(l, 'a')).toBe(1)
	})

	it('a roundLost on the Boss, then the PvP loss on it in the same round, costs one life', () => {
		let l = open2(started('a', 'b'))
		l = tickOf(blind(l, 'a', '2:Boss', false, true))
		l = lose(l)
		expect(livesOf(l, 'a')).toBe(3)
	})

	it('the PvP loss, then a roundLost on the same Boss in the same round, costs one life', () => {
		let l = lose(open2(started('a', 'b')))
		l = tickOf(blind(l, 'a', '2:Boss', false, true))
		expect(livesOf(l, 'a')).toBe(3)
	})

	it('the guard is not re-armed for a blind the round was not Readied on', () => {
		let l = lose(open2(started('a', 'b')))
		l = tickOf(ready(ready(l, 'a', 4, '3:Boss'), 'b', 4, '3:Boss'))
		// 2:Boss stays spent: a roundLost on it still costs nothing
		l = tickOf(blind(l, 'a', '2:Boss', false, true))
		expect(livesOf(l, 'a')).toBe(3)
	})
})

// The lobby's picks and plan reach the mode's init, once per run.
describe('the run start reaches the mode', () => {
	type Start = Parameters<ReturnType<ModeFor>['init']>[2]
	const spy =
		(seen: Start[]): ModeFor =>
		() => ({
			...inertMode('teams'),
			init: (s, _c, start) => {
				seen.push(start)
				return s
			},
		})

	it('init receives the started ids in start order, the picks and the plan', () => {
		const seen: Start[] = []
		const lobby = {
			...raced(startedLobby('a', 'b', 'c')),
			teamPicks: { c: 'B', a: 'A' } as const,
			teamPlan: [['a', 'b'], ['c']] as [string[], string[]],
		}
		const after = pvpTick(lobby, ctx, spy(seen)).lobby
		pvpTick(after, ctx, spy(seen))
		expect(seen).toEqual([
			{
				startedIds: ['a', 'b', 'c'],
				picks: { c: 'B', a: 'A' },
				teamPlan: [['a', 'b'], ['c']],
			},
		])
	})

	it('a lobby with no picks and no plan starts with {} and null', () => {
		const seen: Start[] = []
		pvpTick(raced(startedLobby('a', 'b')), ctx, spy(seen))
		expect(seen).toEqual([
			{ startedIds: ['a', 'b'], picks: {}, teamPlan: null },
		])
	})

	it('a seed restart keeps the picks for the next game', () => {
		let l = game('a', 'b')
		l = { ...l, teamPicks: { a: 'A', b: 'B' } }
		l = fact(l, 'pvp.vote', 'a', { kind: 'seed', yes: true })
		l = fact(l, 'pvp.vote', 'b', { kind: 'seed', yes: true })
		const step = pvpTick(l, ctx)
		expect(saved(step)?.status).toBe('restarted')
		expect(step.lobby.teamPicks).toEqual({ a: 'A', b: 'B' })
	})
})

describe('pending death (R11, R21; PD.decide)', () => {
	it('holds the result until the opponent beats the same blind, then the opponent wins', () => {
		let l = withLives(game('a', 'b'), 'a', 1)
		l = blind(l, 'a', '1:Small', false, true)
		l = tickOf(l)
		expect(stateOf(l).lives.pending).toHaveLength(1)
		expect(l.game.started).not.toBeNull()
		l = blind(l, 'b', '1:Small', true, false)
		const step = pvpTick(l, ctx)
		expect(saved(step)?.status).toBe('agreed')
		expect(saved(step)?.placements).toEqual([
			{ playerId: 'a', place: 2, performance: 0 },
			{ playerId: 'b', place: 1, performance: 1 },
		])
	})

	it('the opponent failing the same blind (lives left) also gives them the win', () => {
		let l = withLives(game('a', 'b'), 'a', 1)
		l = blind(l, 'a', '1:Small', false, true)
		l = blind(l, 'b', '1:Small', false, false)
		const step = pvpTick(l, ctx)
		expect(saved(step)?.placements.find((p) => p.place === 1)?.playerId).toBe(
			'b',
		)
	})

	// The settled death is dropped by its place in the list: on state read back
	// from the runtime a filter by === drops nothing and the death stays pending.
	it('a settled death leaves the pending list, on state read back from the runtime', () => {
		let l = withLives(game('a', 'b'), 'a', 1)
		l = tickOf(blind(l, 'a', '1:Small', false, true))
		expect(stateOf(l).lives.pending).toHaveLength(1)
		l = blind(l, 'b', '1:Small', true, false)
		const step = pvpTick(fromRuntime(l), ctx)
		const state = sends(step).find((o) => o.op === ServerOp.STATE)
		const changed = (state?.payload as { changed: { [k: string]: unknown } })
			.changed
		// A death that stays pending changes no lives, so the key is absent.
		expect(changed).toHaveProperty(['pvp.lives'])
		expect(changed['pvp.lives']).toMatchObject({ pending: [] })
		expect(changed['pvp.result']).toMatchObject({ kind: 'win', winnerId: 'b' })
	})

	it('a pvp.blind before the death needs no ordering (section 10, case 3)', () => {
		let l = withLives(game('a', 'b'), 'a', 1)
		l = blind(l, 'b', '1:Small', true, false)
		l = blind(l, 'a', '1:Small', false, true)
		expect(saved(pvpTick(l, ctx))?.status).toBe('agreed')
	})
})

describe('finishing', () => {
	it('sends STATE (with pvp.result) before GAME_ENDED and records the placements', () => {
		let l = withLives(game('a', 'b'), 'a', 1)
		l = round(l, ['5', 0], ['9', 0])
		const step = pvpTick(l, ctx)
		const ops = step.out.map((o) =>
			o.kind === 'send' && o.op === ServerOp.EVENT
				? 'event'
				: o.kind === 'send' && o.op === ServerOp.STATE
					? 'state'
					: o.kind,
		)
		expect(ops.indexOf('state')).toBeGreaterThanOrEqual(0)
		expect(ops.indexOf('state')).toBeLessThan(ops.indexOf('event'))
		const state = sends(step).find((o) => o.op === ServerOp.STATE)
		expect(
			(state?.payload as { changed: { [k: string]: unknown } }).changed[
				'pvp.result'
			],
		).toMatchObject({
			kind: 'win',
			winnerId: 'b',
		})
		expect(step.lobby.game.started).toBeNull()
	})

	it('placements: a sole winner performs 1, a draw puts everyone at place 1 with performance 0', () => {
		const base = stateOf(game('a', 'b'))
		const win = {
			...base,
			result: {
				runId: 'r',
				kind: 'win' as const,
				winnerId: 'a',
				winnerTeam: null,
				places: [
					{ playerId: 'a', place: 1 },
					{ playerId: 'b', place: 2 },
				],
			},
		}
		expect(
			placementsOf(win, ['a', 'b']).map((p) => [p.place, p.performance]),
		).toEqual([
			[1, 1],
			[2, 0],
		])
		const draw = {
			...base,
			result: {
				runId: 'r',
				kind: 'draw' as const,
				winnerId: null,
				winnerTeam: null,
				places: [
					{ playerId: 'a', place: 1 },
					{ playerId: 'b', place: 1 },
				],
			},
		}
		expect(
			placementsOf(draw, ['a', 'b']).map((p) => [p.place, p.performance]),
		).toEqual([
			[1, 0],
			[1, 0],
		])
	})

	it('placements carry the highest score as metric and text (a comma score caps at 1e15)', () => {
		const base = stateOf(game('a', 'b'))
		const players = {
			a: { ...base.round.players.a, highestScore: '1234' },
			b: { ...base.round.players.b, highestScore: '100,1' },
		}
		const s = {
			...base,
			round: { ...base.round, players },
			result: {
				runId: 'r',
				kind: 'win' as const,
				winnerId: 'a',
				winnerTeam: null,
				places: [
					{ playerId: 'a', place: 1 },
					{ playerId: 'b', place: 2 },
				],
			},
		}
		const out = placementsOf(s, ['a', 'b'])
		expect(out[0]).toMatchObject({ metric: 1234, metricText: '1234' })
		expect(out[1].metric).toBe(1e15)
		expect(out[1].metricText).toContain(',')
	})

	it('a draw vote from everyone draws the game', () => {
		let l = game('a', 'b')
		l = fact(l, 'pvp.vote', 'a', { kind: 'draw', yes: true })
		expect(saved(pvpTick(l, ctx))).toBeUndefined()
		l = fact(l, 'pvp.vote', 'b', { kind: 'draw', yes: true })
		const run = saved(pvpTick(l, ctx))
		expect(run?.placements.map((p) => p.place)).toEqual([1, 1])
	})

	it('a unanimous seed vote restarts the game on a new run', () => {
		let l = game('a', 'b')
		const before = runIdOf(l)
		l = fact(l, 'pvp.vote', 'a', { kind: 'seed', yes: true })
		l = fact(l, 'pvp.vote', 'b', { kind: 'seed', yes: true })
		const step = pvpTick(l, ctx)
		expect(saved(step)?.status).toBe('restarted')
		expect(step.lobby.game.started?.runId).not.toBe(before)
		expect(step.lobby.game.started).not.toBeNull()
	})

	it('pvp.result is frozen once set: later facts change nothing', () => {
		const l = game('a', 'b')
		const s = stateOf(l)
		const env: TickEnv = {
			runId: s.runId,
			startedIds: ['a', 'b'],
			seatedIds: ['a', 'b'],
			readyIds: [],
			readiedIds: [],
			raceStarted: true,
			ranked: false,
			requiredIds: ['a', 'b'],
			awayIds: [],
			metadata: withRules({ ruleset: 'ruleset_mp_traditional' }),
			picks: {},
			teamPlan: null,
		}
		let lost = withLives(l, 'a', 1)
		lost = blind(lost, 'a', '1:Small', false, true)
		lost = blind(lost, 'b', '1:Small', true, false)
		const decided = decide(stateOf(lost), env, ctx)
		expect(decided.end).toEqual({ kind: 'finish' })
		// A fail after the result gets round_over (section 10, case 3)...
		const late = FACT_REDUCERS['pvp.blind'](decided.state, 'b', {
			runId: s.runId,
			blindKey: '1:Big',
			beaten: false,
			roundLost: true,
		})
		expect(late).toEqual({ ok: false, reason: 'round_over' })
		// ...and even a fact that reached the log is not decided on.
		const forced: RefereeState = {
			...decided.state,
			facts: {
				...decided.state.facts,
				log: [
					...decided.state.facts.log,
					{ type: 'forfeit', playerId: 'b' },
				],
			},
		}
		const again = decide(forced, env, ctx)
		expect(again.state.result).toEqual(decided.state.result)
		expect(again.state.lives).toEqual(decided.state.lives)
	})
})

describe('forfeit and leaving (R20)', () => {
	it('abandon by the host is a forfeit: the other player wins', () => {
		const l = game('a', 'b')
		const abandoned = send(l, 'a', 'mpapi_abandon_game')
		expect(rejection(abandoned)).toBeUndefined()
		expect(abandoned.lobby.game.started).not.toBeNull()
		const step = pvpTick(abandoned.lobby, ctx)
		const run = saved(step)
		expect(run?.placements.find((p) => p.place === 1)?.playerId).toBe('b')
	})

	it('abandon by a guest is theirs to forfeit, not the host game ending', () => {
		const step = pvpTick(
			send(game('a', 'b'), 'b', 'mpapi_abandon_game').lobby,
			ctx,
		)
		expect(saved(step)?.placements.find((p) => p.place === 1)?.playerId).toBe(
			'a',
		)
	})

	it('abandon by a player with a pending death is accepted and records no fact (finding 15)', () => {
		let l = withLives(game('a', 'b'), 'a', 1)
		l = tickOf(blind(l, 'a', '1:Small', false, true))
		expect(stateOf(l).lives.players.a.eliminated).toBe(true)
		const before = stateOf(l).facts.log.length
		const step = send(l, 'a', 'mpapi_abandon_game')
		expect(rejection(step)).toBeUndefined()
		expect(stateOf(step.lobby).facts.log).toHaveLength(before)
	})

	it('a late pvp.blind after a forfeit is refused as eliminated (section 10, case 8)', () => {
		let l = game('a', 'b')
		l = fact(l, 'pvp.forfeit', 'a', {})
		l = tickOf(l)
		// the game is over and reset: the same fact against the finished state
		const forfeited = withReferee(
			game('a', 'b'),
			stateOf(fact(game('a', 'b'), 'pvp.forfeit', 'a', {})),
		)
		const late = FACT_REDUCERS['pvp.blind'](stateOf(forfeited), 'a', {
			runId: runIdOf(forfeited),
			blindKey: '1:Small',
			beaten: false,
			roundLost: false,
		})
		expect(late).toEqual({ ok: false, reason: 'eliminated' })
	})

	it('a player who left the lobby is out and the other wins', () => {
		const l = leave(game('a', 'b'), 'b', 1000).lobby
		const step = pvpTick(l, ctx)
		expect(saved(step)?.placements.find((p) => p.place === 1)?.playerId).toBe(
			'a',
		)
	})

	// section 10, case 4: the host leaving mid-round changes nothing but the
	// leaver being out; a host and a guest leave give mirrored outcomes.
	it.each([
		['the host leaves', 'a', 'b'],
		['a guest leaves', 'b', 'a'],
	])('case 4: %s, the other player wins', (_name, leaver, winner) => {
		const step = pvpTick(leave(game('a', 'b'), leaver, 1000).lobby, ctx)
		const run = saved(step)
		expect(run?.placements.find((p) => p.place === 1)?.playerId).toBe(winner)
		expect(run?.placements.find((p) => p.place === 2)?.playerId).toBe(leaver)
	})

	it('case 4: a host change alone changes no referee state', () => {
		const l = game('a', 'b')
		const step = pvpTick({ ...l, hostId: 'b' }, ctx)
		expect(step.lobby.game.started).not.toBeNull()
		expect(refereeOf(step.lobby)).toEqual(refereeOf(l))
		expect(step.out).toEqual([])
	})
})

describe('registry and settle for a refereed game (section 10, case 10)', () => {
	it('an early mpapi_report_result is refused and leaves no settleFrom', () => {
		const l = game('a', 'b')
		const step = send(l, 'a', 'mpapi_report_result', {
			placements: [
				{ playerId: 'a', place: 1 },
				{ playerId: 'b', place: 2 },
			],
		})
		expect(rejection(step)).toBe('server_referee')
		expect(step.lobby.game.settleFrom).toBeNull()
		expect(settle(step.lobby, 2000).lobby.game.settleFrom).toBeNull()
	})

	it('mpapi_set_result_pending and mpapi_restart_game are refused', () => {
		const l = game('a', 'b')
		expect(
			rejection(send(l, 'a', 'mpapi_set_result_pending', { pending: true })),
		).toBe('server_referee')
		expect(rejection(send(l, 'a', 'mpapi_restart_game'))).toBe('server_referee')
	})

	it('the hard cap stores the run abandoned (reports are empty)', () => {
		// The loop is pvpTick, then settle. Inert rules leave the referee unable
		// to decide a leave, so the game is still open when settle looks at it.
		const undecided = () => inertMode('duel')
		const ticked = pvpTick(
			leave(game('a', 'b'), 'b', 1000).lobby,
			ctx,
			undecided,
		)
		expect(ticked.lobby.game.started).not.toBeNull()
		const first = settle(ticked.lobby, 2000)
		expect(first.lobby.game.settleFrom).toBe(2000)
		const capped = settle(first.lobby, 2000 + 60_000)
		const run = saved(capped)
		expect(run?.status).toBe('abandoned')
		expect(run?.placements).toEqual([])
	})
})

describe('a contested game (section 7)', () => {
	const gameEnded = (steps: Step[]): Send[] =>
		steps
			.flatMap(sends)
			.filter(
				(o) =>
					o.op === ServerOp.EVENT &&
					(o.payload as { type: string }).type === 'game_ended',
			)
	const matchmade = (lobby: Lobby): Lobby => ({
		...lobby,
		gameMode: 'ranked:duel',
	})
	// `a` Ready for round 2 and holding a 30 s Ante timer opened at t = 1000, so
	// it runs out at t = 31000 and costs `b` a life.
	function anteRunning(): Lobby {
		const l = ready(game('a', 'b'), 'a')
		const s = stateOf(l)
		return matchmade(
			withReferee(l, {
				...s,
				facts: {
					...s.facts,
					deadline: {
						kind: 'ante',
						by: 'a',
						against: ['b'],
						endsAt: 31_000,
						shownMs: 30_000,
						n: 1,
					},
				},
			}),
		)
	}
	const contested = (lobby: Lobby): Lobby => {
		const step = send(lobby, 'a', 'mpapi_contest', {}, 5000)
		expect(rejection(step)).toBeUndefined()
		return step.lobby
	}

	it('control: the same game with no contest loses a life when the timer runs out', () => {
		const ran = pvpTick(anteRunning(), testContext(40_000)).lobby
		expect(livesOf(ran, 'b')).toBe(3)
	})

	it('a contest stores the run contested, even in the step the Ante deadline runs out', () => {
		const lobby = contested(anteRunning())
		const step = pvpTick(lobby, testContext(40_000))
		const run = saved(step)
		expect(run?.status).toBe('contested')
		expect(run?.placements).toEqual([])
		expect(run?.contest).toEqual({ by: 'a', against: 'b', at: 5000 })
		// The ended game is not refereed: a later tick changes nothing.
		expect(step.lobby.game.started).toBeNull()
		const later = pvpTick(step.lobby, testContext(50_000))
		expect(later).toEqual({ lobby: step.lobby, out: [] })
		expect(gameEnded([step, later])).toHaveLength(1)
		// No life was lost and no result announced: the tick sent no STATE at all.
		expect(sends(step).filter((o) => o.op === ServerOp.STATE)).toEqual([])
	})

	it('a contest with no deadline running ends the game the same way', () => {
		const lobby = contested(matchmade(game('a', 'b')))
		const step = pvpTick(lobby, testContext(5000))
		expect(saved(step)?.status).toBe('contested')
		expect(saved(step)?.placements).toEqual([])
		expect(step.lobby.game.started).toBeNull()
		expect(gameEnded([step])).toHaveLength(1)
	})

	it('a contest in a larger game ends nothing: only the contester leaves, the others play on', () => {
		const lobby = matchmade(game('a', 'b', 'c'))
		const asked = send(lobby, 'a', 'mpapi_contest', { opponentId: 'b' }, 5000)
		expect(rejection(asked)).toBeUndefined()
		const step = pvpTick(asked.lobby, testContext(5000))
		expect(saved(step)).toBeUndefined()
		expect(step.lobby.game.started).not.toBeNull()
		expect(gameEnded([asked, step])).toEqual([])
	})

	it('a game nobody refereed is left to the contest rules of results.ts', () => {
		const l = matchmade(raced(startedLobby('a', 'b')))
		const unrefereed: Lobby = { ...l, modId: 'other' }
		const step = pvpTick(
			{
				...unrefereed,
				game: { ...unrefereed.game, contest: { by: 'a', against: 'b', at: 1 } },
			},
			ctx,
		)
		expect(step.out).toEqual([])
	})
})

describe('the tick is idempotent and inert outside a refereed game', () => {
	it('a lobby with no PvP game is returned as is', () => {
		const l = newLobby({
			code: 'X',
			modId: 'Other',
			maxPlayers: 2,
			creatorId: 'a',
			now: 0,
			graceMs: 1,
		})
		const step = pvpTick(l, ctx)
		expect(step.lobby).toBe(l)
		expect(step.out).toEqual([])
	})

	it('a second tick with no new facts changes nothing and sends nothing', () => {
		const l = timer(game('a', 'b'), 'a')
		const once = pvpTick(l, ctx)
		const twice = pvpTick(once.lobby, ctx)
		expect(twice.lobby).toEqual(once.lobby)
		expect(twice.out).toEqual([])
	})
})

describe('manhunt voucher (R42)', () => {
	it('every hunter gains one life', () => {
		const idle = emptyPvp()
		const state: RefereeState = {
			...idle,
			facts: {
				...emptyFacts(),
				log: [
					{ type: 'voucher', playerId: 'r', voucherKey: 'v_mp_hieroglyph' },
				],
			},
			runId: 'r1',
			lastStart: null,
			teams: { runId: 'r1', teams: { r: 'RUNNER', h: 'HUNTER' } },
		}
		const env: TickEnv = {
			runId: 'r1',
			startedIds: ['r', 'h'],
			seatedIds: ['r', 'h'],
			readyIds: [],
			readiedIds: [],
			raceStarted: true,
			ranked: false,
			requiredIds: ['r', 'h'],
			awayIds: [],
			metadata: withRules({ ruleset: 'ruleset_mp_traditional', queue_mode: 'pvp_manhunt' }),
			picks: {},
			teamPlan: null,
		}
		// the mode names the gainers (R42): every hunter; the tick gives the life
		const voucherGainers: VoucherGainers = (s) =>
			Object.keys(s.lives.players).filter(
				(id) => s.teams.teams[id] === 'HUNTER',
			)
		const modeFor = () => ({ ...inertMode('manhunt'), voucherGainers })
		const out = decide(state, env, ctx, modeFor).state
		expect(out.lives.players.h.lives).toBe(5)
		expect(out.lives.players.r.lives).toBe(4)
	})
})

describe('invariants', () => {
	const env: TickEnv = {
		runId: 'r1',
		startedIds: ['a', 'b'],
		seatedIds: ['a', 'b'],
		readyIds: [],
		readiedIds: [],
		raceStarted: true,
		ranked: false,
		requiredIds: ['a', 'b'],
		awayIds: [],
		metadata: withRules({ ruleset: 'ruleset_mp_traditional' }),
		picks: {},
		teamPlan: null,
	}
	const fresh = (): RefereeState => ({
		...emptyPvp(),
		// deadlines 1..9 were opened, so a client may report their run-outs
		facts: { ...emptyFacts(), timerN: 9 },
		runId: 'r1',
		lastStart: null,
	})

	type Op =
		| { t: 'timer'; id: 'a' | 'b'; n: number; key: string }
		| {
				t: 'blind'
				id: 'a' | 'b'
				key: string
				beaten: boolean
				roundLost: boolean
		  }
		| { t: 'round'; a: number; b: number }
	const keys = fc.constantFrom('1:Small', '1:Big', '1:Boss', '2:Small')
	const who = fc.constantFrom<'a' | 'b'>('a', 'b')
	const op: fc.Arbitrary<Op> = fc.oneof(
		fc.record({
			t: fc.constant('timer' as const),
			id: who,
			n: fc.integer({ min: 1, max: 3 }),
			key: keys,
		}),
		fc
			.record({
				t: fc.constant('blind' as const),
				id: who,
				key: keys,
				beaten: fc.boolean(),
				lost: fc.boolean(),
			})
			.map((o) => ({
				t: o.t,
				id: o.id,
				key: o.key,
				beaten: o.beaten && !o.lost,
				roundLost: o.lost,
			})),
		fc.record({
			t: fc.constant('round' as const),
			a: fc.nat(20),
			b: fc.nat(20),
		}),
	)

	function applyOp(state: RefereeState, o: Op): RefereeState {
		if (o.t === 'round') {
			const players = { ...state.round.players }
			if (!players.a || !players.b) return state
			players.a = { ...players.a, score: String(o.a), handsLeft: 0 }
			players.b = { ...players.b, score: String(o.b), handsLeft: 0 }
			return { ...state, round: { ...state.round, players } }
		}
		if (o.t === 'timer') return ranOut(state, o.id)
		const r = FACT_REDUCERS['pvp.blind'](state, o.id, {
			runId: 'r1',
			blindKey: o.key,
			beaten: o.beaten,
			roundLost: o.roundLost,
		})
		return r.ok ? r.state : state
	}

	it('lives never go below 0, a decided result is frozen, and a tick is idempotent', () => {
		fc.assert(
			fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
				let state = decide(fresh(), env, ctx).state
				let frozen: RefereeState['result'] | null = null
				for (const o of ops) {
					state = decide(applyOp(state, o), env, ctx).state
					for (const seat of Object.values(state.lives.players)) {
						expect(seat.lives).toBeGreaterThanOrEqual(0)
					}
					// a server run-out has no blind: it is never a pending death the clients see
					for (const p of state.lives.pending) expect(p.blindKey).not.toBeNull()
					if (frozen) expect(state.result).toEqual(frozen)
					else if (state.result.kind !== null) frozen = state.result
					const again = decide(state, env, ctx).state
					expect(again.lives).toEqual(state.lives)
					expect(again.result).toEqual(state.result)
				}
			}),
			{ numRuns: 200 },
		)
	})

	// One guarded loss per (player, blindKey): a roundLost fail is guarded on its
	// own blind, and the PvP loss on the PvP blind (`1:Boss`, the ante never moves
	// here), so no blindKey is ever charged twice to a player; a PvP loss is its
	// own event, charged once per round.
	it('a player pays at most one guarded loss per blindKey', () => {
		const start = startOf(['a', 'b'], 1, 'a')
		fc.assert(
			fc.property(
				fc.array(fc.record({ id: who, key: keys, resolve: fc.boolean() }), {
					maxLength: 20,
				}),
				(steps) => {
					let state = decide({ ...fresh(), lastStart: start }, env, ctx).state
					for (const s of steps) {
						const r = FACT_REDUCERS['pvp.blind'](state, s.id, {
							runId: 'r1',
							blindKey: s.key,
							beaten: false,
							roundLost: true,
						})
						if (r.ok) state = r.state
						if (s.resolve) {
							const players = { ...state.round.players }
							players.a = { ...players.a, score: '1', handsLeft: 0 }
							players.b = { ...players.b, score: '2', handsLeft: 0 }
							state = { ...state, round: { ...state.round, players } }
						}
						state = decide(state, env, ctx).state
						for (const [id, seat] of Object.entries(state.lives.players)) {
							const charged: { [key: string]: number } = {}
							for (const e of seat.events) {
								if (e.key === null) continue
								// each PvP loss is its own event (`pvp:<roundId>`), never a repeat
								const key = e.key
								charged[key] = (charged[key] ?? 0) + 1
								expect(charged[key], `${id} ${key}`).toBeLessThanOrEqual(1)
							}
							// the ante never moves here: a roundLost charge on the PvP blind and a PvP
							// loss never both cost (whichever came first spent the guard)
							const keys = seat.events.map((e) => e.key)
							expect(
								keys.includes('1:Boss') &&
									keys.some((k) => k?.startsWith('pvp:')),
								id,
							).toBe(false)
						}
						if (state.result.kind !== null) break
					}
				},
			),
			{ numRuns: 200 },
		)
	})

	// One round number: the start's id, whatever order any number of Readies and
	// resolves come in. After every tick round.roundId === lastStart.roundId (0
	// with no start); a round still playing when a newer start arrives is closed.
	it('after any interleaving of Ready starts and resolves, round.roundId is the newest start id', () => {
		fc.assert(
			fc.property(fc.array(fc.boolean(), { maxLength: 14 }), (steps) => {
				let l = started('a', 'b')
				for (const resolve of steps) {
					if (refereeOf(l) === null) break
					if (resolve) l = round(l, ['1', 0], ['2', 0])
					else l = ready(ready(l, 'a'), 'b')
					l = tickOf(l)
					const s = refereeOf(l)
					if (s === null || s.result.kind !== null) break
					expect(s.round.roundId).toBe(s.lastStart?.roundId ?? 0)
					// ticking again changes nothing
					expect(tickOf(l)).toEqual(l)
				}
			}),
			{ numRuns: 100 },
		)
	})

	// The runtime keeps no object identity inside match state
	// (testing/runtime_state.ts): a tick decides the same from wrapped state as
	// from plain objects, and a second tick on the result changes nothing.
	it('a tick decides the same on state read back from the runtime as on plain objects', () => {
		const step = fc.constantFrom('resolve', 'tie', 'start', 'fail', 'timer')
		fc.assert(
			fc.property(fc.array(step, { maxLength: 14 }), (steps) => {
				let l = withLives(started('a', 'b'), 'a', 2)
				for (const s of steps) {
					const state = refereeOf(l)
					if (state === null || state.result.kind !== null) break
					const open = state.round.phase === 'playing'
					const alive = (id: string) => state.lives.players[id].lives > 0
					if (s === 'resolve' && open) l = round(l, ['1', 0], ['2', 0])
					else if (s === 'tie' && open) l = round(l, ['2', 0], ['2', 0])
					// a player the referee holds out cannot Ready (R31)
					else if (s === 'start' && alive('a') && alive('b'))
						l = ready(ready(l, 'a'), 'b')
					else if (s === 'fail' && alive('a'))
						l = blind(l, 'a', '1:Small', false, true)
					else if (s === 'timer' && alive('b'))
						l = timer(l, 'b')
					const plain = pvpTick(l, ctx)
					const wrapped = pvpTick(fromRuntime(l), ctx)
					expect(wrapped.lobby).toEqual(plain.lobby)
					expect(wrapped.out).toEqual(plain.out)
					l = plain.lobby
					if (refereeOf(l)?.result.kind === null)
						expect(pvpTick(fromRuntime(l), ctx).lobby).toEqual(l)
				}
			}),
			{ numRuns: 200 },
		)
	})

	// Only the tick writes round.roundId: the same start / resolve / start
	// sequence under every Mode pickMode can return keeps the invariant.
	it.each([
		['royale', 2],
		['nemesis', 2],
		['nemesis', 3],
		['royale', 3],
	] as const)(
		'every mode keeps round.roundId = lastStart.roundId (%s, %i players)',
		(mode, count) => {
			const modeFor = () => pickMode(mode, count)
			const start = (roundId: number) =>
				startOf(['a', 'b', 'c'].slice(0, count), roundId, 'a')
			let state = decide(
				{ ...fresh(), lastStart: start(1) },
				env,
				ctx,
				modeFor,
			).state
			expect(state.round.roundId).toBe(1)
			const players = { ...state.round.players }
			for (const id of Object.keys(players))
				players[id] = {
					...players[id],
					score: id === 'a' ? '1' : '2',
					handsLeft: 0,
				}
			state = decide(
				{ ...state, round: { ...state.round, players } },
				env,
				ctx,
				modeFor,
			).state
			expect(state.round.roundId).toBe(1)
			for (const n of [2, 3]) {
				state = decide(
					{ ...state, lastStart: start(n) },
					env,
					ctx,
					modeFor,
				).state
				if (state.result.kind !== null) break
				expect(state.round.roundId).toBe(n)
			}
		},
	)

	it('timer run-outs of different players commute', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 4 }),
				fc.integer({ min: 1, max: 4 }),
				(na, nb) => {
					const base = decide(fresh(), env, ctx).state
					const run = (order: Array<['a' | 'b', number]>) => {
						let s = base
						for (const [id] of order) {
							s = ranOut(s, id)
						}
						return decide(s, env, ctx).state.lives.players
					}
					expect(
						run([
							['a', na],
							['b', nb],
						]),
					).toEqual(
						run([
							['b', nb],
							['a', na],
						]),
					)
				},
			),
		)
	})

})

// Games that start with 3+ players (R31-R34). The rules here are the duel hooks
// under the royale / nemesis name with their death and hands policies: that is all
// the shared tick needs to be exercised.
describe('games of 3+ players', () => {
	type ManyName = 'royale' | 'nemesis'
	const manyModes =
		(name: ManyName): ModeFor =>
		() => ({
			...duelMode,
			name,
			deathPolicy: (name === 'royale' ? royaleMode : nemesisMode).deathPolicy,
			outOfHandsOnFail: (name === 'royale' ? royaleMode : nemesisMode)
				.outOfHandsOnFail,
		})
	const envOf = (players: string[], gone: string[] = []): TickEnv => ({
		runId: 'r1',
		startedIds: players,
		seatedIds: players.filter((p) => !gone.includes(p)),
		readyIds: [],
		readiedIds: [],
		raceStarted: true,
		ranked: false,
		requiredIds: players.filter((p) => !gone.includes(p)),
		awayIds: [],
		metadata: withRules({ ruleset: 'ruleset_mp_traditional' }),
		picks: {},
		teamPlan: null,
	})
	// Every player Readied on a Boss at the PvP start ante, as a real start has it.
	const firstFor = (players: string[]) => startOf(players, 1, 'a', 2)

	// A frozen game with round 1 open.
	function playing(
		players: string[],
		modeFor: ModeFor,
		start: PvpLastStart = firstFor(players),
	): RefereeState {
		const idle: RefereeState = {
			...emptyPvp(),
			facts: { ...emptyFacts(), timerN: 9 },
			runId: 'r1',
			lastStart: start,
		}
		return reportAll(decide(idle, envOf(players), ctx, modeFor).state)
	}

	function post(
		state: RefereeState,
		type: string,
		id: string,
		args: object = {},
	): RefereeState {
		const r = FACT_REDUCERS[type](state, id, { runId: 'r1', ...args })
		if (!r.ok) throw new Error(`refused: ${r.reason}`)
		return r.state
	}
	const step = (
		state: RefereeState,
		players: string[],
		modeFor: ModeFor,
		gone: string[] = [],
	): RefereeState =>
		reportAll(
			fromRuntime(
				decide(fromRuntime(state), envOf(players, gone), ctx, modeFor).state,
			),
		)
	const lost = (id: string, blindKey: string) =>
		['pvp.blind', id, { blindKey, beaten: false, roundLost: true }] as const
	const beat = (id: string, blindKey: string) =>
		['pvp.blind', id, { blindKey, beaten: true, roundLost: false }] as const
	const withSeat = (
		state: RefereeState,
		id: string,
		seat: Partial<RefereeState['lives']['players'][string]>,
	): RefereeState => ({
		...state,
		lives: {
			...state.lives,
			players: {
				...state.lives.players,
				[id]: { ...state.lives.players[id], ...seat },
			},
		},
	})

	describe('R34: a lost blind or an ante-timer run-out leaves no hands', () => {
		const HAND = { roundId: 1, score: '0', handsLeft: 3, timerLossesApplied: 0 }
		it.each<
			[string, string, string[], (s: RefereeState) => RefereeState, boolean]
		>([
			[
				'royale',
				'a run-out',
				['a', 'b', 'c'],
				(s) => ranOut(s, 'a'),
				true,
			],
			[
				'nemesis',
				'a run-out',
				['a', 'b', 'c', 'd'],
				(s) => ranOut(s, 'a'),
				true,
			],
			[
				'royale',
				'a roundLost blind',
				['a', 'b', 'c'],
				(s) => post(s, ...lost('a', '1:Small')),
				true,
			],
			[
				'nemesis',
				'a roundLost blind',
				['a', 'b', 'c', 'd'],
				(s) => post(s, ...lost('a', '1:Small')),
				true,
			],
			[
				'royale',
				'a failed blind that is not roundLost',
				['a', 'b', 'c'],
				(s) =>
					post(s, 'pvp.blind', 'a', {
						blindKey: '1:Small',
						beaten: false,
						roundLost: false,
					}),
				false,
			],
			[
				'duel',
				'a run-out',
				['a', 'b'],
				(s) => ranOut(s, 'a'),
				false,
			],
			[
				'duel',
				'a roundLost blind',
				['a', 'b'],
				(s) => post(s, ...lost('a', '1:Small')),
				false,
			],
		])('%s, %s', (name, _what, players, apply, forced) => {
			const modeFor: ModeFor =
				name === 'duel' ? pickMode : manyModes(name as ManyName)
			const s = step(apply(playing(players, modeFor)), players, modeFor)
			// the count stays as reported: the cut is handsSpent, not a made-up 0
			expect(s.round.players.a.handsLeft).toBe(4)
			expect(s.round.players.a.handsSpent).toBe(forced)
			// the cut is the server's, not a hand the player played: no stamp
			expect(s.facts.handRound.a).toBeUndefined()
			// nobody else is touched
			expect(s.round.players.b.handsLeft).toBe(4)
			// a hand after the server ended the hands is refused
			const hand = FACT_REDUCERS['pvp.hand'](s, 'a', {
				runId: 'r1',
				...HAND,
			})
			if (forced) expect(hand).toEqual({ ok: false, reason: 'hands_spent' })
			else expect(hand.ok).toBe(true)
		})

		it('a hand after the run-out is refused hands_spent, even one that agrees with the cut', () => {
			const modeFor = manyModes('royale')
			const players = ['a', 'b', 'c']
			const s = step(
				ranOut(playing(players, modeFor), 'a'),
				players,
				modeFor,
			)
			const hand = FACT_REDUCERS['pvp.hand'](s, 'a', {
				runId: 'r1',
				roundId: 1,
				score: '0',
				handsLeft: 0,
				timerLossesApplied: 0,
			})
			expect(hand).toEqual({ ok: false, reason: 'hands_spent' })
		})

		it('outside the playing phase nothing is forced', () => {
			const modeFor = manyModes('royale')
			const players = ['a', 'b', 'c']
			let s = playing(players, modeFor)
			s = { ...s, round: { ...s.round, phase: 'resolved' } }
			s = step(
				ranOut(s, 'a'),
				players,
				modeFor,
			)
			expect(s.round.players.a.handsLeft).toBe(4)
			expect(s.facts.handRound.a).toBeUndefined()
		})
	})

	describe('R32: a last life lost on a non-PvP blind waits on the others', () => {
		const P = ['a', 'b', 'c']

		it.each<ManyName>(['royale', 'nemesis'])(
			'%s: the death waits on everyone still in the run and keeps a record',
			(name) => {
				const rf = manyModes(name)
				let s = withSeat(playing(P, rf), 'a', { lives: 1 })
				s = step(post(s, ...lost('a', '2:Big')), P, rf)
				expect(s.lives.players.a).toMatchObject({ lives: 0, eliminated: true })
				expect(s.lives.pending).toEqual([
					{ playerId: 'a', blindKey: '2:Big', waitsOn: ['b', 'c'] },
				])
				expect(s.facts.deaths).toEqual([
					{ playerId: 'a', blindKey: '2:Big', outBefore: {} },
				])
				expect(s.result.kind).toBeNull()
			},
		)

		it('a death while another player is already out records who was out before', () => {
			const rf = manyModes('royale')
			let s = withSeat(withSeat(playing(P, rf), 'a', { lives: 1 }), 'c', {
				lives: 1,
			})
			s = step(post(s, ...lost('a', '2:Big')), P, rf)
			s = step(post(s, ...lost('c', '3:Small')), P, rf)
			expect(s.facts.deaths).toEqual([
				{ playerId: 'a', blindKey: '2:Big', outBefore: {} },
				{ playerId: 'c', blindKey: '3:Small', outBefore: { a: true } },
			])
			// c's death waits on b alone: a is out
			expect(s.lives.pending[1]).toEqual({
				playerId: 'c',
				blindKey: '3:Small',
				waitsOn: ['b'],
			})
		})

		it('a failed blind with lives left opens no record', () => {
			const rf = manyModes('royale')
			const s = step(post(playing(P, rf), ...lost('a', '2:Big')), P, rf)
			expect(s.lives.players.a.lives).toBe(3)
			expect(s.facts.deaths ?? []).toEqual([])
			expect(s.lives.pending).toEqual([])
		})

		// a dies on 2:Big, c dies on `cKey`; b then beats both blinds
		it.each([
			['the same blind', '2:Big', { a: 2, b: 1, c: 2 }],
			['another blind', '3:Small', { a: 3, b: 1, c: 2 }],
		])(
			'the last survivor wins once they have heard both blinds, %s: places from pending.places',
			(_what, cKey, expected) => {
				const rf = manyModes('royale')
				let s = withSeat(withSeat(playing(P, rf), 'a', { lives: 1 }), 'c', {
					lives: 1,
				})
				s = step(post(s, ...lost('a', '2:Big')), P, rf)
				s = step(post(s, ...lost('c', cKey)), P, rf)
				// b is the only one left, but has not reported on the blinds yet: the
				// duel's checkWinner would name b now, and a record is open
				expect(s.result.kind).toBeNull()
				expect(s.lives.pending.map((p) => p.playerId)).toEqual(['a', 'c'])
				s = step(post(s, ...beat('b', '2:Big')), P, rf)
				if (cKey !== '2:Big') {
					expect(s.result.kind).toBeNull()
					s = step(post(s, ...beat('b', cKey)), P, rf)
				}
				expect(s.result.kind).toBe('win')
				expect(s.result.winnerId).toBe('b')
				expect(
					Object.fromEntries(s.result.places.map((p) => [p.playerId, p.place])),
				).toEqual(expected)
				expect(s.lives.pending).toEqual([])
			},
		)

		it('a survivor who fails the same blinds ranks with the dead: every place 1 is a draw', () => {
			const rf = manyModes('nemesis')
			let s = withSeat(withSeat(playing(P, rf), 'a', { lives: 1 }), 'c', {
				lives: 1,
			})
			s = step(post(s, ...lost('a', '2:Big')), P, rf)
			s = step(post(s, ...lost('c', '2:Big')), P, rf)
			s = step(
				post(s, 'pvp.blind', 'b', {
					blindKey: '2:Big',
					beaten: false,
					roundLost: false,
				}),
				P,
				rf,
			)
			expect(s.result).toMatchObject({ kind: 'draw', winnerId: null })
		})

		it('a waiter who leaves the lobby resolves the wait', () => {
			const rf = manyModes('royale')
			let s = withSeat(playing(P, rf), 'a', { lives: 1 })
			s = step(post(s, ...lost('a', '2:Big')), P, rf)
			s = step(post(s, ...beat('b', '2:Big')), P, rf)
			// c is still there and has not reported: the death still waits
			expect(s.result.kind).toBeNull()
			s = step(s, P, rf, ['c'])
			expect(s.result.kind).toBe('win')
			expect(s.result.winnerId).toBe('b')
			expect(
				Object.fromEntries(s.result.places.map((p) => [p.playerId, p.place])),
			).toEqual({ a: 2, b: 1, c: 3 })
		})

		// Two players out at the same moment and the third gone: they tie for
		// place 1 and the game is a draw. The deaths are stored state, so the
		// state is built the way the tick leaves it.
		it('two players with one place 1 between them draw', () => {
			const rf = manyModes('royale')
			let s = playing(P, rf)
			s = withSeat(withSeat(s, 'a', { lives: 0, eliminated: true }), 'b', {
				lives: 0,
				eliminated: true,
			})
			const failed = { '2:Big': { beaten: false, roundLost: true } }
			s = {
				...s,
				lives: {
					...s.lives,
					pending: [
						{ playerId: 'a', blindKey: '2:Big', waitsOn: ['c'] },
						{ playerId: 'b', blindKey: '2:Big', waitsOn: ['c'] },
					],
				},
				facts: {
					...s.facts,
					blinds: { ...s.facts.blinds, a: failed, b: failed },
					deaths: [
						{ playerId: 'a', blindKey: '2:Big', outBefore: {} },
						{ playerId: 'b', blindKey: '2:Big', outBefore: {} },
					],
				},
			}
			s = step(s, P, rf, ['c'])
			expect(s.result.kind).toBe('draw')
			expect(s.result.winnerId).toBeNull()
			expect(
				Object.fromEntries(s.result.places.map((p) => [p.playerId, p.place])),
			).toEqual({ a: 1, b: 1, c: 3 })
		})

		it('two alive players keep the game going while a death is open', () => {
			const rf = manyModes('royale')
			let s = withSeat(playing(P, rf), 'a', { lives: 1 })
			s = step(post(s, ...lost('a', '2:Big')), P, rf)
			s = step(post(s, ...beat('b', '2:Big')), P, rf)
			s = step(post(s, ...beat('c', '2:Big')), P, rf)
			expect(s.result.kind).toBeNull()
			expect(s.lives.pending).toEqual([])
			expect(aliveIds(s)).toEqual(['b', 'c'])
		})

		it('a settled many-player game is frozen: later facts change nothing', () => {
			const rf = manyModes('royale')
			let s = withSeat(playing(P, rf), 'a', { lives: 1 })
			s = step(post(s, ...lost('a', '2:Big')), P, rf)
			s = step(post(s, ...beat('b', '2:Big')), P, rf)
			s = step(s, P, rf, ['c'])
			const decided = s.result
			expect(decided.kind).toBe('win')
			s = step(s, P, rf, ['c'])
			expect(s.result).toEqual(decided)
		})

		it('the death record is stored on the lobby and never projected', () => {
			let l = game('a', 'b', 'c')
			l = withLives(l, 'a', 1)
			l = blind(l, 'a', '2:Big', false, true)
			const step1 = pvpTick(l, ctx)
			expect(stateOf(step1.lobby).facts.deaths).toEqual([
				{ playerId: 'a', blindKey: '2:Big', outBefore: {} },
			])
			const state = sends(step1).find((o) => o.op === ServerOp.STATE)
			const changed = (state?.payload as { changed: { [k: string]: unknown } })
				.changed
			expect(changed['pvp.lives']).toMatchObject({
				pending: [{ playerId: 'a', blindKey: '2:Big', waitsOn: ['b', 'c'] }],
			})
			expect(JSON.stringify(changed)).not.toContain('outBefore')
			expect(JSON.stringify(changed)).not.toContain('deaths')
		})

		it('on state read back from the runtime a many-player death settles', () => {
			let l = game('a', 'b', 'c')
			l = withLives(l, 'a', 1)
			l = tickOf(blind(l, 'a', '2:Big', false, true))
			l = blind(l, 'b', '2:Big', true, false)
			l = tickOf(fromRuntime(l))
			l = blind(l, 'c', '2:Big', true, false)
			l = tickOf(fromRuntime(l))
			expect(stateOf(l).lives.pending).toEqual([])
			expect(stateOf(l).result.kind).toBeNull()
			l = leave(l, 'c', 1000).lobby
			const finish = pvpTick(fromRuntime(l), ctx)
			expect(saved(finish)?.status).toBe('agreed')
		})
	})

	describe('forfeit at N>2: the forfeiter is out, not at zero lives', () => {
		const P = ['a', 'b', 'c']
		it.each<ManyName>(['royale', 'nemesis'])(
			'%s: the game goes on for the other two',
			(name) => {
				const rf = manyModes(name)
				const s = step(post(playing(P, rf), 'pvp.forfeit', 'a'), P, rf)
				expect(s.lives.players.a).toMatchObject({
					forfeited: true,
					eliminated: true,
					lives: 4,
				})
				expect(aliveIds(s)).toEqual(['b', 'c'])
				expect(s.result.kind).toBeNull()
				expect(s.lives.pending).toEqual([])
				expect(s.facts.deaths ?? []).toEqual([])
			},
		)

		it('the last two forfeiting leaves one winner', () => {
			const rf = manyModes('royale')
			let s = step(post(playing(P, rf), 'pvp.forfeit', 'a'), P, rf)
			s = step(post(s, 'pvp.forfeit', 'b'), P, rf)
			expect(s.result).toMatchObject({ kind: 'win', winnerId: 'c' })
		})

		it('a forfeiter does not hold the other players out of the next start', () => {
			let l = started('a', 'b', 'c')
			l = tickOf(fact(l, 'pvp.forfeit', 'c', {}))
			l = ready(ready(l, 'a'), 'b')
			expect(pvpOf(l)?.round).toBe(1)
		})
	})

	describe('R31: the Ready gate follows the tick', () => {
		const changedKeys = (step1: Step): string[] => {
			const state = sends(step1).find((o) => o.op === ServerOp.STATE)
			return Object.keys(
				(state?.payload as { changed: { [k: string]: unknown } }).changed,
			)
		}

		it.each<[string, (l: Lobby) => Lobby]>([
			[
				'an ante-timer run-out of its last life',
				(l) => anteExpired(l, 'a', 'c'),
			],
			[
				'a lost blind on its last life',
				(l) => blind(l, 'c', '1:Small', false, true),
			],
			['a forfeit', (l) => fact(l, 'pvp.forfeit', 'c', {})],
		])(
			'the others are ready and %s puts the third out: the tick opens the round and announces pvp.ready',
			(_what, out) => {
				let l = withLives(started('a', 'b', 'c'), 'c', 1)
				l = ready(ready(l, 'a'), 'b')
				expect(pvpOf(l)?.round).toBe(0)
				const step1 = pvpTick(out(l), ctx)
				expect(pvpOf(step1.lobby)?.round).toBe(1)
				expect(pvpOf(step1.lobby)?.lastStart).toMatchObject({ roundId: 1 })
				expect(changedKeys(step1)).toContain('pvp.ready')
			},
		)

		it('with nobody put out the round does not start and pvp.ready is not announced', () => {
			let l = started('a', 'b', 'c')
			l = ready(ready(l, 'a'), 'b')
			const step1 = pvpTick(l, ctx)
			expect(pvpOf(step1.lobby)?.round).toBe(0)
			expect(step1.out).toEqual([])
		})

		it('an out player cannot Ready', () => {
			const l = fact(started('a', 'b', 'c'), 'pvp.forfeit', 'c', {})
			const out = tickOf(l)
			const pvp = pvpOf(out)
			if (!pvp) throw new Error('no pvp')
			const r = readyReducer.reduce(
				out,
				'c',
				{ runId: pvp.runId, roundId: 1, startingHands: 4, blindKey: '2:Boss' },
				ctx,
			)
			expect(r).toEqual({ ok: false, reason: 'eliminated' })
		})
	})

	describe('a new ante is acted on between rounds, including when the next start has arrived', () => {
		const P = ['a', 'b', 'c', 'd']
		const rf: ModeFor = () => pickMode('nemesis', P.length)

		it('ante 2 reported while a round plays does not pair that round', () => {
			let s = step(playing(P, rf), P, rf)
			// no ante was reported when the round opened: nothing was paired
			expect(s.pairing).toBeNull()
			s = step(
				post(s, 'pvp.progress', 'a', { ante: 2, furthestBlind: 0 }),
				P,
				rf,
			)
			expect(s.round.phase).toBe('playing')
			expect(s.pairing).toBeNull()
		})

		it('a new start that arrives before the resolve opens the new round on the ante-2 pairing', () => {
			let s = step(playing(P, rf), P, rf)
			s = step(
				post(s, 'pvp.progress', 'a', { ante: 2, furthestBlind: 0 }),
				P,
				rf,
			)
			const start = s.lastStart
			if (start === null) throw new Error('no start')
			s = step(
				{ ...s, lastStart: { ...start, roundId: start.roundId + 1 } },
				P,
				rf,
			)
			expect(s.round).toMatchObject({ phase: 'playing', roundId: 2 })
			expect(s.pairing?.ante).toBe(2)
			expect(s.round.lastResult).toEqual({ roundId: 1, losers: [] })
		})

		it('a round left by a start is ranked on the pairing it was played with, not the next ante', () => {
			let s = step(playing(P, rf), P, rf)
			// ante 1 paired a-b and c-d; a crashed with a hand left, the rest are done
			const score = (handsLeft: number, n: string) => ({ handsLeft, score: n })
			s = {
				...s,
				pairing: {
					ante: 1,
					partners: { a: 'b', b: 'a', c: 'd', d: 'c' },
					usedPairs: ['a|b', 'c|d'],
					lastBye: null,
				},
				round: {
					...s.round,
					players: {
						a: { ...s.round.players.a, ...score(2, '1') },
						b: { ...s.round.players.b, ...score(0, '2') },
						c: { ...s.round.players.c, ...score(0, '3') },
						d: { ...s.round.players.d, ...score(0, '4') },
					},
				},
			}
			s = post(s, 'pvp.progress', 'c', { ante: 2, furthestBlind: 0 })
			const start = s.lastStart
			if (start === null) throw new Error('no start')
			s = step(
				{ ...s, lastStart: { ...start, roundId: start.roundId + 1 } },
				P,
				rf,
			)
			// a-b and c-d: the lower of each pair, not whoever ante 2 re-paired them with
			expect(s.round.lastResult).toEqual({ roundId: 1, losers: ['a', 'c'] })
			expect(s.pairing?.ante).toBe(2)
		})
	})

	describe('review round 1', () => {
		const P = ['a', 'b', 'c']
		const placesOf = (s: RefereeState): { [id: string]: number } =>
			Object.fromEntries(s.result.places.map((p) => [p.playerId, p.place]))
		// a and b are out of hands with a ahead: b loses the PvP round
		const bTrails = (s: RefereeState): RefereeState => ({
			...s,
			round: {
				...s.round,
				players: {
					...s.round.players,
					a: { ...s.round.players.a, handsLeft: 0, score: '9' },
					b: { ...s.round.players.b, handsLeft: 0, score: '1' },
				},
			},
		})

		describe('a last life lost on a PvP blind puts the player out at once', () => {
			it('royale: c runs out of its last life, a death with no blind is recorded, and b losing the last life in a PvP round later ends the game for a', () => {
				const rf = manyModes('royale')
				let s = withSeat(playing(P, rf), 'c', { lives: 1 })
				s = step(ranOut(s, 'c'), P, rf)
				expect(s.lives.players.c).toMatchObject({ lives: 0, eliminated: true })
				expect(s.lives.pending).toEqual([])
				expect(s.facts.deaths).toEqual([
					{ playerId: 'c', blindKey: null, outBefore: {} },
				])
				expect(s.result.kind).toBeNull()
				s = step(bTrails(withSeat(s, 'b', { lives: 1 })), P, rf)
				expect(s.result).toMatchObject({ kind: 'win', winnerId: 'a' })
				expect(placesOf(s)).toEqual({ a: 1, b: 2, c: 3 })
			})

			it('royale: a lost PvP Boss blind on the last life is the same', () => {
				const rf = manyModes('royale')
				let s = withSeat(playing(P, rf), 'c', { lives: 1 })
				s = step(post(s, ...lost('c', '2:Boss')), P, rf)
				expect(s.lives.players.c.eliminated).toBe(true)
				expect(s.facts.deaths ?? []).toEqual([])
				expect(s.lives.pending).toEqual([])
			})

			it('duel: the same run-out ends the game at once with the opponent winning', () => {
				const two = ['a', 'b']
				let s = withSeat(playing(two, pickMode), 'a', { lives: 1 })
				s = step(ranOut(s, 'a'), two, pickMode)
				expect(s.lives.pending).toEqual([])
				expect(s.result).toMatchObject({ kind: 'win', winnerId: 'b' })
			})

			it('two run-outs in one expiry leave nobody alive: one moment, so a draw sharing place 1', () => {
				const rf = manyModes('royale')
				let s = withSeat(playing(P, rf), 'c', { lives: 0, eliminated: true })
				s = withSeat(withSeat(s, 'a', { lives: 1 }), 'b', { lives: 1 })
				s = ranOutTogether(s, ['a', 'b'])
				s = step(s, P, rf)
				expect(s.result).toMatchObject({ kind: 'draw', winnerId: null })
				expect(placesOf(s)).toMatchObject({ a: 1, b: 1 })
			})

			it('four players, two run out in one expiry: they share a place below the survivor', () => {
				const rf = manyModes('royale')
				const four = ['a', 'b', 'c', 'd']
				let s = withSeat(playing(four, rf), 'd', { lives: 0, eliminated: true })
				s = withSeat(withSeat(s, 'b', { lives: 1 }), 'c', { lives: 1 })
				s = ranOutTogether(s, ['b', 'c'])
				s = step(s, four, rf)
				expect(s.result).toMatchObject({ kind: 'win', winnerId: 'a' })
				expect(placesOf(s)).toMatchObject({ a: 1, b: 2, c: 2, d: 4 })
			})

			it('two run-outs on the Boss in different ticks: the one that has not run out wins', () => {
				const rf = manyModes('royale')
				let s = withSeat(playing(P, rf), 'c', { lives: 0, eliminated: true })
				s = withSeat(withSeat(s, 'a', { lives: 1 }), 'b', { lives: 1 })
				s = step(ranOut(s, 'b'), P, rf)
				expect(s.result).toMatchObject({ kind: 'win', winnerId: 'a' })
				s = step(s, P, rf)
				expect(s.result).toMatchObject({ kind: 'win', winnerId: 'a' })
			})

			it('a server run-out knows no blind: the last life records a death with a null blind and waits on nobody', () => {
				const rf = manyModes('royale')
				let s = withSeat(playing(P, rf), 'c', { lives: 1 })
				s = step(ranOut(s, 'c'), P, rf)
				expect(s.lives.players.c.eliminated).toBe(true)
				expect(s.lives.pending).toHaveLength(0)
				expect(s.facts.deaths).toEqual([
					{ playerId: 'c', blindKey: null, outBefore: {} },
				])
			})

			it('royale: a death with no blind ranks below a player who was still in, and the earlier death below a later one', () => {
				const rf = manyModes('royale')
				let s = withSeat(playing(P, rf), 'c', { lives: 1 })
				s = withSeat(s, 'b', { lives: 1 })
				s = step(ranOut(s, 'c'), P, rf)
				s = step(ranOut(s, 'b'), P, rf)
				expect(s.result).toMatchObject({ kind: 'win', winnerId: 'a' })
				expect(placesOf(s)).toEqual({ a: 1, b: 2, c: 3 })
			})
		})

		// PvP starts at ante 2 by default (pvp_start_round): the ante-1 Boss is a
		// normal blind that every player reports, so a death on it waits like any other.
		describe('a Boss before the PvP start ante is a normal blind', () => {
			it('royale: a last life lost on 1:Boss opens a record and waits on the others', () => {
				const rf = manyModes('royale')
				let s = withSeat(playing(P, rf), 'c', { lives: 1 })
				s = step(post(s, ...lost('c', '1:Boss')), P, rf)
				expect(s.lives.pending).toEqual([
					{ playerId: 'c', blindKey: '1:Boss', waitsOn: ['a', 'b'] },
				])
				expect(s.facts.deaths).toHaveLength(1)
				expect(s.result.kind).toBeNull()
			})

			it('duel: the opponent has to beat 1:Boss before they win', () => {
				const two = ['a', 'b']
				let s = withSeat(playing(two, pickMode), 'a', { lives: 1 })
				s = step(post(s, ...lost('a', '1:Boss')), two, pickMode)
				expect(s.lives.pending).toEqual([
					{ playerId: 'a', blindKey: '1:Boss', waitsOn: ['b'] },
				])
				expect(s.result.kind).toBeNull()
			})

			it('the lobby can start PvP at ante 1: then 1:Boss is the PvP blind', () => {
				const rf = manyModes('royale')
				// the PvP blind is the one the players Readied on
				let s = withSeat(
					playing(P, rf, startOf(P, 1, 'a', 1)),
					'c',
					{ lives: 1 },
				)
				s = step(ranOut(s, 'c'), P, rf)
				expect(s.lives.players.c.eliminated).toBe(true)
				expect(s.lives.pending).toEqual([])
			})
		})

		describe('while a death record is open only settleMany writes the result', () => {
			it('b forfeits after a died on 2:Big and b and c beat it: places c1, b2, a3', () => {
				const rf = manyModes('royale')
				let s = withSeat(playing(P, rf), 'a', { lives: 1 })
				s = step(post(s, ...lost('a', '2:Big')), P, rf)
				s = step(post(s, ...beat('b', '2:Big')), P, rf)
				s = step(post(s, ...beat('c', '2:Big')), P, rf)
				expect(s.result.kind).toBeNull()
				s = step(post(s, 'pvp.forfeit', 'b'), P, rf)
				expect(s.result).toMatchObject({ kind: 'win', winnerId: 'c' })
				expect(placesOf(s)).toEqual({ a: 3, b: 2, c: 1 })
			})

			it('a forfeit while c has not answered leaves the game open until c does', () => {
				const rf = manyModes('royale')
				let s = withSeat(playing(P, rf), 'a', { lives: 1 })
				s = step(post(s, ...lost('a', '2:Big')), P, rf)
				s = step(post(s, ...beat('b', '2:Big')), P, rf)
				s = step(post(s, 'pvp.forfeit', 'b'), P, rf)
				expect(s.result.kind).toBeNull()
				s = step(post(s, ...beat('c', '2:Big')), P, rf)
				expect(s.result).toMatchObject({ kind: 'win', winnerId: 'c' })
				expect(placesOf(s)).toEqual({ a: 3, b: 2, c: 1 })
			})
		})

		describe('a forfeiter keeps their lives but counts as out before a later death', () => {
			it('x forfeits at 3 lives, a dies on 2:Big, b beats it: b1, a2, x3', () => {
				const rf = manyModes('royale')
				const xs = ['x', 'a', 'b']
				let s = withSeat(playing(xs, rf), 'a', { lives: 1 })
				s = step(post(s, 'pvp.forfeit', 'x'), xs, rf)
				s = step(post(s, ...lost('a', '2:Big')), xs, rf)
				expect(s.facts.deaths).toEqual([
					{ playerId: 'a', blindKey: '2:Big', outBefore: { x: true } },
				])
				s = step(post(s, ...beat('b', '2:Big')), xs, rf)
				expect(s.result).toMatchObject({ kind: 'win', winnerId: 'b' })
				expect(placesOf(s)).toEqual({ a: 2, b: 1, x: 3 })
			})
		})

		describe('a player with no round entry is left alone by the R34 hand cut', () => {
			it('a run-out makes up no entry and no stamp', () => {
				const rf = manyModes('royale')
				const full = playing(P, rf)
				const { a: _a, ...others } = full.round.players
				const s = step(
					ranOut({ ...full, round: { ...full.round, players: others } }, 'a'),
					P,
					rf,
				)
				expect(s.round.players.a).toBeUndefined()
				expect(s.facts.handRound.a).toBeUndefined()
			})
		})

		describe('a player put out leaves the Ready of the round (R31)', () => {
			it('c Readies first and forfeits; a and b Ready: the start has no c and a goes first', () => {
				let l = started('a', 'b', 'c')
				l = ready(l, 'c')
				expect(pvpOf(l)?.ready).toEqual({ c: true })
				l = tickOf(fact(l, 'pvp.forfeit', 'c', {}))
				expect(pvpOf(l)?.ready).toEqual({})
				expect(pvpOf(l)?.firstReady).toBeNull()
				l = ready(ready(l, 'a', 5), 'b', 6)
				expect(pvpOf(l)?.lastStart).toEqual({
					roundId: 1,
					firstPlayer: 'a',
					players: ['a', 'b'],
					blindKeys: { a: '2:Boss', b: '2:Boss' },
				})
			})

			it('the others Ready first: a player put out later who never Readied changes nothing', () => {
				let l = started('a', 'b', 'c')
				l = ready(ready(l, 'a', 5), 'b', 6)
				l = tickOf(fact(l, 'pvp.forfeit', 'c', {}))
				expect(pvpOf(l)?.lastStart).toEqual({
					roundId: 1,
					firstPlayer: 'a',
					players: ['a', 'b'],
					blindKeys: { a: '2:Boss', b: '2:Boss' },
				})
			})
		})
	})

	describe('invariants for N in 3..6', () => {
		const ALL = ['a', 'b', 'c', 'd', 'e', 'f']
		type Fact =
			| { t: 'timer'; who: number; n: number; key: string }
			| { t: 'blind'; who: number; key: string; beaten: boolean; lost: boolean }
			| { t: 'forfeit'; who: number }
		const keys = fc.constantFrom(
			'1:Small',
			'1:Big',
			'2:Small',
			'2:Big',
			'2:Boss',
		)
		const who = fc.integer({ min: 0, max: 5 })
		const fact1: fc.Arbitrary<Fact> = fc.oneof(
			fc.record({
				t: fc.constant('timer' as const),
				who,
				n: fc.integer({ min: 1, max: 3 }),
				key: keys,
			}),
			fc.record({
				t: fc.constant('blind' as const),
				who,
				key: keys,
				beaten: fc.boolean(),
				lost: fc.boolean(),
			}),
			fc.record({ t: fc.constant('forfeit' as const), who }),
		)

		function apply(
			state: RefereeState,
			f: Fact,
			players: string[],
		): RefereeState {
			const id = players[f.who % players.length]
			if (f.t === 'timer') return ranOut(state, id)
			const reducer =
				f.t === 'blind' ? FACT_REDUCERS['pvp.blind'] : FACT_REDUCERS['pvp.forfeit']
			const args =
				f.t === 'blind'
					? {
							runId: 'r1',
							blindKey: f.key,
							beaten: f.beaten && !f.lost,
							roundLost: f.lost,
						}
					: { runId: 'r1' }
			const r = reducer(state, id, args)
			return r.ok ? r.state : state
		}

		it('lives never go below 0 and a decided result never changes, under random blind, run-out and forfeit facts', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 3, max: 6 }),
					fc.constantFrom<ManyName>('royale', 'nemesis'),
					fc.array(fact1, { maxLength: 30 }),
					fc.integer({ min: 1, max: 2 }),
					(count, name, facts, startLives) => {
						const players = ALL.slice(0, count)
						const rf = manyModes(name)
						// few lives, so that deaths happen within the facts
						let state = players.reduce(
							(s, id) => withSeat(s, id, { lives: startLives }),
							playing(players, rf),
						)
						let frozen: RefereeState['result'] | null = null
						for (const f of facts) {
							state = step(apply(state, f, players), players, rf)
							for (const seat of Object.values(state.lives.players))
								expect(seat.lives).toBeGreaterThanOrEqual(0)
							if (frozen) expect(state.result).toEqual(frozen)
							else if (state.result.kind !== null) frozen = state.result
						}
					},
				),
				{ numRuns: 200 },
			)
		})

		it('one alive and no waiter left who can answer: the result is set (a death never waits on nobody)', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 3, max: 6 }),
					fc.constantFrom<ManyName>('royale', 'nemesis'),
					fc.array(fact1, { maxLength: 30 }),
					fc.integer({ min: 1, max: 2 }),
					(count, name, facts, startLives) => {
						const players = ALL.slice(0, count)
						const rf = manyModes(name)
						// few lives, so that deaths happen within the facts
						let state = players.reduce(
							(s, id) => withSeat(s, id, { lives: startLives }),
							playing(players, rf),
						)
						for (const f of facts) {
							state = step(apply(state, f, players), players, rf)
							const alive = aliveIds(state)
							// nobody ever reports pvp.blind for a PvP blind, so no one can
							// answer a record on one; a death with no blind (a server
							// run-out) waits on no one
							const canAnswer = state.lives.pending.some((p) => {
								const key = p.blindKey
								return (
									key !== null &&
									!state.facts.pvpBlinds[p.playerId]?.includes(key) &&
									p.waitsOn.some(
										(w) =>
											alive.includes(w) &&
											state.facts.blinds[w]?.[key] === undefined,
									)
								)
							})
							if (alive.length <= 1 && !canAnswer)
								expect(state.result.kind).not.toBeNull()
						}
					},
				),
				{ numRuns: 300 },
			)
		})
	})
})

describe('consumed facts leave the log', () => {
	const logTypes = (lobby: Lobby): string[] =>
		stateOf(lobby)
			.facts.log.map((f) => f.type)
			.sort()
	const tickRuntime = (lobby: Lobby): Lobby =>
		pvpTick(fromRuntime(lobby), ctx).lobby

	it('drops a blind result once read; the same result sent again costs nothing more', () => {
		let l = game('a', 'b')
		l = blind(l, 'a', '1:Small', false, true)
		expect(logTypes(l)).toEqual(['blind'])
		l = tickRuntime(l)
		expect(livesOf(l, 'a')).toBe(3)
		expect(logTypes(l)).toEqual([])
		// the log no longer holds it, facts.blinds still does: no second fact, no life
		const again = FACT_REDUCERS['pvp.blind'](stateOf(l), 'a', {
			runId: runIdOf(l),
			blindKey: '1:Small',
			beaten: false,
			roundLost: true,
		})
		expect(again.ok).toBe(true)
		l = tickRuntime(withReferee(l, again.ok ? again.state : stateOf(l)))
		expect(logTypes(l)).toEqual([])
		expect(livesOf(l, 'a')).toBe(3)
	})

	it('keeps the facts a request dedupes on', () => {
		let l = game('a', 'b')
		l = timer(l, 'a')
		const s = stateOf(l)
		const voucher: PvpFact = {
			type: 'voucher',
			playerId: 'a',
			voucherKey: 'v_mp_hieroglyph',
		}
		l = withReferee(l, {
			...s,
			facts: { ...s.facts, log: [...s.facts.log, voucher] },
		})
		l = blind(l, 'a', '1:Big', true, false)
		l = tickRuntime(l)
		expect(logTypes(l)).toEqual(['voucher'])
		expect(stateOf(l).facts.applied).toBe(1)
	})

	it('still treats a forfeit sent again as the same forfeit', () => {
		let l = game('a', 'b', 'c')
		l = fact(l, 'pvp.forfeit', 'a', {})
		l = tickRuntime(l)
		expect(logTypes(l)).toEqual(['forfeit'])
		const again = FACT_REDUCERS['pvp.forfeit'](stateOf(l), 'a', {
			runId: runIdOf(l),
		})
		expect(again).toEqual({ ok: true, state: stateOf(l), changed: [] })
	})
})

describe('personal clocks in the tick (docs/pvp-match.md section 8)', () => {
	const PRESSURE = { ruleset: 'ruleset_mp_experimental' }
	const BASE_MS = (l: Lobby): number => {
		const rules = stateOf(l).rules
		if (rules.runId === null) throw new Error('no game')
		return rules.timerBaseMs * 2
	}

	// A Pressure game started and frozen at t = 1000: nobody is ready, no round open.
	const pressure = (extra: { [key: string]: unknown } = {}): Lobby =>
		tickAt(raced(startedLobbyWith({ ...PRESSURE, ...extra }, 'a', 'b')), 1000)

	// B6: an untimed Pressure clock reaching 0 is a server run-out.
	it('B6: an untimed Pressure clock reaching 0 costs one life and refills to the base', () => {
		const frozen = pressure()
		const base = BASE_MS(frozen)
		const lives = livesOf(frozen, 'a')
		// the first tick after the freeze starts the clock at t = 1000
		const running = tickAt(frozen, 1000)
		const out = tickAt(running, 1000 + base)
		expect(livesOf(out, 'a')).toBe(lives - 1)
		expect(stateOf(out).facts.forgiven).toEqual({})
		expect(stateOf(out).facts.clocks.a.ms).toBe(base)
	})

	// B7 (already green at the deadline level): the allowance is the base plus a
	// hand's time per untimed hand, read when the press opens the deadline.
	it('B7: two untimed hands then a press end at now + base + 2 hands', () => {
		let l = gameRuled('a', 'b')
		const roundId = stateOf(l).round.roundId
		for (const hands of [3, 2])
			for (const id of ['a', 'b'])
				l = fact(l, 'pvp.hand', id, {
					roundId,
					score: '5',
					handsLeft: hands,
					timerLossesApplied: 0,
				})
		const pressed = PVP_REQUESTS['pvp.timer_start'].reduce(
			l,
			'a',
			{ runId: runIdOf(l), kind: 'pvp', roundId },
			ctx,
		)
		if (!pressed.ok) throw new Error(`refused: ${pressed.reason}`)
		const opened = tickAt(pressed.lobby, 5000)
		expect(stateOf(opened).facts.deadline).toMatchObject({
			kind: 'pvp',
			endsAt: 5000 + 60_000 + 2 * 10_000,
		})
	})

	it('seeds a clock at the base for every seated player (the freeze tick then starts it) and the memo', () => {
		const l = pressure()
		const base = BASE_MS(l)
		for (const id of ['a', 'b'])
			expect(stateOf(l).facts.clocks[id]).toEqual({
				ms: base,
				running: true,
				rate: 1,
				since: 1000,
				n: 2,
				spent: false,
				graceUntil: null,
			})
		expect(stateOf(l).facts.skipsSeen.a).toEqual({ rival: 'b', skips: 0 })
	})

	it('a quiet tick returns the same referee state, not a copy', () => {
		const frozen = pressure()
		const again = tickAt(frozen, 1000)
		const quiet = tickAt(again, 1000)
		expect(stateOf(quiet).facts.clocks).toBe(stateOf(again).facts.clocks)
		expect(quiet).toBe(again)
	})

	it('a restarted run runs no clock before its own first event, and freezes on it', () => {
		const lobby = startedLobbyWith({ ...PRESSURE }, 'a', 'b')
		const restarted = {
			...lobby,
			game: { ...lobby.game, started: { ...(lobby.game.started as object), restarted: true } as never },
		}
		const early = tickAt(tickAt(restarted, 1000), 4000)
		expect(stateOf(early).rules.runId).toBeNull()
		expect(stateOf(early).facts.clocks).toEqual({})
		const begun = tickAt(raced(early, 4500), 5000)
		expect(stateOf(begun).rules.runId).not.toBeNull()
	})

	it('a quiet tick at a later time still returns the same lobby', () => {
		const again = tickAt(pressure(), 1000)
		let l = again
		for (const now of [1010, 1050, 1100]) l = tickAt(l, now)
		expect(l).toBe(again)
	})

	it('seeds nothing on a ruleset with no personal clock', () => {
		const l = tickAt(raced(startedLobbyWith(RULED, 'a', 'b')), 1000)
		expect(stateOf(l).facts.clocks).toEqual({})
		expect(stateOf(l).facts.skipsSeen).toEqual({})
	})

	it('a new game replaces the clocks of the previous one', () => {
		const first = pressure()
		const stale = withReferee(first, {
			...stateOf(first),
			facts: {
				...stateOf(first).facts,
				clocks: {
					...stateOf(first).facts.clocks,
					ghost: stateOf(first).facts.clocks.a,
				},
			},
		})
		expect(Object.keys(stateOf(stale).facts.clocks).sort()).toEqual([
			'a',
			'b',
			'ghost',
		])
		const again = tickAt(raced(startedLobbyWith(PRESSURE, 'a', 'b')), 2000)
		expect(Object.keys(stateOf(again).facts.clocks).sort()).toEqual(['a', 'b'])
		expect(stateOf(again).facts.clocks.a.since).toBe(2000)
	})

	it('steps only the holders of a clock entry', () => {
		const frozen = pressure()
		const s = stateOf(frozen)
		const { b: _gone, ...onlyA } = s.facts.clocks
		const l = tickAt(
			withReferee(frozen, { ...s, facts: { ...s.facts, clocks: onlyA } }),
			1000,
		)
		expect(Object.keys(stateOf(l).facts.clocks)).toEqual(['a'])
	})

	it('Score Preview charges 3500 ms once, and the next tick charges nothing', () => {
		const frozen = pressure()
		const base = BASE_MS(frozen)
		const previewed = withReferee(
			frozen,
			withFact(stateOf(frozen), { type: 'preview_charge', playerId: 'a' }),
		)
		const once = tickAt(previewed, 1000)
		expect(stateOf(once).facts.clocks.a.ms).toBe(base - 3500)
		expect(stateOf(once).facts.clocks.b.ms).toBe(base)
		const again = tickAt(once, 1000)
		expect(stateOf(again).facts.clocks.a.ms).toBe(base - 3500)
	})

	it('two clocks running out in one tick are one moment: two players on their last life draw', () => {
		const frozen = withLives(withLives(pressure(), 'a', 1), 'b', 1)
		const base = BASE_MS(frozen)
		const running = tickAt(frozen, 1000)
		const run = saved(pvpTick(running, testContext(1000 + base)))
		expect(run?.placements.map((p) => p.place)).toEqual([1, 1])
	})

	it('a player who left stops their clock but keeps the entry', () => {
		let l = tickAt(raced(startedLobbyWith(PRESSURE, 'a', 'b', 'c')), 1000)
		const base = BASE_MS(l)
		l = fact(l, 'pvp.forfeit', 'a', {})
		l = tickAt(l, 1500)
		const left = stateOf(l).facts.clocks.a
		expect(left.running).toBe(false)
		expect(stateOf(l).facts.clocks.b.running).toBe(true)
		const later = tickAt(l, 1500 + 2 * base)
		expect(stateOf(later).facts.clocks.a).toEqual(left)
		expect(livesOf(later, 'a')).toBe(livesOf(l, 'a'))
		expect(livesOf(later, 'b')).toBeLessThan(livesOf(l, 'b'))
	})

	it('pvp.clocks is announced only when a clock n changes, not while one just runs', () => {
		const frozen = pressure()
		const base = BASE_MS(frozen)
		const running = tickAt(frozen, 1000)
		const quiet = tickAt(running, 1000 + base / 2)
		expect(changedMatchKeys(running, quiet)).toEqual([])
		const out = tickAt(quiet, 1000 + base)
		expect(changedMatchKeys(quiet, out)).toContain('pvp.clocks')
	})

	it('a run-out is forgiven while forgiveness is left, then costs a life', () => {
		const frozen = pressure({ timer_forgiveness: 1 })
		const base = BASE_MS(frozen)
		const lives = livesOf(frozen, 'a')
		let l = tickAt(frozen, 1000)
		l = tickAt(l, 1000 + base)
		expect(livesOf(l, 'a')).toBe(lives)
		l = tickAt(l, 1000 + 2 * base)
		expect(livesOf(l, 'a')).toBe(lives - 1)
	})
})

describe('a PvP game with no known clock rules is refused (bad_rules)', () => {
	// A lobby of a and b on `ruleset`, b ready, ready for mpapi_start_game.
	function lobbyWith(ruleset: string | undefined): Lobby {
		let lobby = newLobby({
			code: 'ABC123',
			modId: 'MultiplayerPvP',
			maxPlayers: 8,
			creatorId: 'a',
			now: 0,
			graceMs: 10_000,
			resultTimeoutMs: 60_000,
		})
		lobby = { ...lobby, metadata: withRules({ ruleset }) }
		for (const id of ['a', 'b']) lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
		return send(lobby, 'b', 'mpapi_ready', { ready: true }).lobby
	}

	it.each([
		['a missing ruleset', undefined],
		['an unknown ruleset', 'ruleset_nope'],
	])('mpapi_start_game with %s is rejected', (_name, ruleset) => {
		const step = send(lobbyWith(ruleset), 'a', 'mpapi_start_game', { stake: 2 })
		expect(rejection(step)).toBe('bad_rules')
		expect(rejectedKey(step)).toBe('ruleset')
		expect(step.lobby.game.started).toBeNull()
	})

	// D1c: the server reads what the client always writes and invents nothing, so a
	// lobby that lacks a key, or has a malformed one, never starts, and the refusal
	// names the key.
	it.each<[string, { [k: string]: unknown }]>([
		['queue_mode', { queue_mode: undefined }],
		['queue_mode', { queue_mode: 'pvp_mystery' }],
		['starting_lives', { starting_lives: undefined }],
		['starting_lives', { starting_lives: 0 }],
		['manhunt_hunter_lives', { manhunt_hunter_lives: 'many' }],
		['pvp_start_round', { pvp_start_round: undefined }],
		['timer_base_seconds', { timer_base_seconds: undefined }],
		['timer_forgiveness', { timer_forgiveness: 'x' }],
		['timer_increment_seconds', { timer_increment_seconds: 'soon' }],
	])('mpapi_start_game with a bad %s is rejected bad_rules naming it', (key, over) => {
		let lobby = lobbyWith('ruleset_mp_balanced')
		lobby = { ...lobby, metadata: withRules({ ruleset: 'ruleset_mp_balanced', ...over }) }
		const step = send(lobby, 'a', 'mpapi_start_game', { stake: 2 })
		expect(rejection(step)).toBe('bad_rules')
		expect(rejectedKey(step)).toBe(key)
		expect(step.lobby.game.started).toBeNull()
	})

	it('a complete lobby starts', () => {
		const step = send(lobbyWith('ruleset_mp_balanced'), 'a', 'mpapi_start_game', { stake: 2 })
		expect(rejection(step)).toBeUndefined()
		expect(step.lobby.game.started).not.toBeNull()
	})

	it('a lobby that goes bad before the freeze ends unrefereeable at the tick without throwing', () => {
		let lobby = startedLobbyWith({}, 'a', 'b')
		lobby = raced({ ...lobby, metadata: withRules({ starting_lives: undefined }) })
		const step = pvpTick(lobby, ctx)
		expect(step.lobby.game.started).toBeNull()
		expect(saved(step)?.status).toBe('abandoned')
	})
})

// The lobby after its first replay event: the moment the run begins and the rules freeze.
const raced = (lobby: Lobby, at = 1500): Lobby => ({
	...lobby,
	game: {
		...lobby.game,
		started: lobby.game.started
			? { ...lobby.game.started, raceStartedAt: at }
			: lobby.game.started,
	},
})
const isFrozen = (lobby: Lobby): boolean =>
	stateOf(lobby).rules.runId === lobby.game.started?.runId
const refusedKeys = (step: Step): string[] =>
	sends(step)
		.filter((o) => o.op === ServerOp.ERROR)
		.map((o) => (o.payload as { key?: string }).key ?? '')

describe('the rules freeze once, from the metadata as it stands (D1d)', () => {
	it('a casual lobby that starts on balanced and is set to majorleague during Setup freezes to majorleague', () => {
		const lobby = startedLobbyWith({ ruleset: 'ruleset_mp_balanced' }, 'a', 'b')
		const ticked = pvpTick(lobby, ctx).lobby
		const changed = setMetadata(ticked, 'a', {
			ruleset: 'ruleset_mp_majorleague',
		})
		expect(changed.lobby.metadata.ruleset).toBe('ruleset_mp_majorleague')
		expect(refusedKeys(changed)).toEqual([])
		const frozen = pvpTick(raced(changed.lobby), ctx).lobby
		const rules = stateOf(frozen).rules
		if (rules.runId === null) throw new Error('not frozen')
		expect(rules.skipTimeRule).toBe('own')
		expect(rules.clocks.pvp).toBeNull()
	})

	it('a tick before the first replay event freezes nothing and does not throw', () => {
		const lobby = pvpTick(startedLobbyWith({}, 'a', 'b'), ctx).lobby
		expect(stateOf(lobby).rules.runId).toBeNull()
		expect(pvpTick(lobby, ctx).lobby).toBe(lobby)
	})

	it('a 3-player forfeit before the freeze leaves the rules unfrozen, and the forfeit applies at the freeze', () => {
		const lobby = startedLobbyWith({}, 'a', 'b', 'c')
		const runId = lobby.game.started?.runId
		const forfeited = PVP_REQUESTS['pvp.forfeit'].reduce(
			lobby,
			'c',
			{ runId },
			ctx,
		)
		if (!forfeited.ok) throw new Error(`refused: ${forfeited.reason}`)
		const ticked = pvpTick(forfeited.lobby, ctx).lobby
		expect(stateOf(ticked).rules.runId).toBeNull()
		const frozen = pvpTick(raced(ticked), ctx).lobby
		expect(stateOf(frozen).lives.players.c.forfeited).toBe(true)
	})

	it('a pvp.vote does not freeze', () => {
		const lobby = startedLobbyWith({}, 'a', 'b')
		const runId = lobby.game.started?.runId
		const voted = PVP_REQUESTS['pvp.vote'].reduce(
			lobby,
			'a',
			{ runId, kind: 'draw', yes: true },
			ctx,
		)
		expect(voted.ok).toBe(false)
		expect(stateOf(pvpTick(lobby, ctx).lobby).rules.runId).toBeNull()
	})

	it('while Setup is open a pvp request is refused setup_open and freezes nothing; the vote result then lands and is the one frozen', () => {
		const lobby = startedLobbyWith({ ruleset: 'ruleset_mp_balanced' }, 'a', 'b', 'c')
		const runId = lobby.game.started?.runId
		const open = { kind: 'vote', id: 'v1', options: [], votes: {}, deadline: 99_999 } as never
		const inSetup = { ...lobby, game: { ...lobby.game, setup: { open, results: {} } } }
		const refused = PVP_REQUESTS['pvp.progress'].reduce(inSetup, 'a', { runId, ante: 3, furthestBlind: 30 }, ctx)
		expect(refused.ok).toBe(false)
		if (!refused.ok) expect(refused.reason).toBe('setup_open')
		expect(isFrozen(inSetup)).toBe(false)
		const changed = setMetadata(inSetup, 'a', { ruleset: 'ruleset_mp_majorleague' })
		expect(refusedKeys(changed)).toEqual([])
		expect(changed.lobby.metadata.ruleset).toBe('ruleset_mp_majorleague')
		const done = { ...changed.lobby, game: { ...changed.lobby.game, setup: { open: null, results: {} } } }
		const frozen = pvpTick(raced(done), ctx).lobby
		const rules = stateOf(frozen).rules
		if (rules.runId === null) throw new Error('not frozen')
		expect(rules.skipTimeRule).toBe('own')
	})

	it('any other pvp request freezes first, from the metadata at that moment', () => {
		const lobby = startedLobbyWith({ ruleset: 'ruleset_mp_balanced' }, 'a', 'b')
		const runId = lobby.game.started?.runId
		const result = PVP_REQUESTS['pvp.animating'].reduce(
			lobby,
			'a',
			{ runId, animating: true },
			ctx,
		)
		if (!result.ok) throw new Error(`refused: ${result.reason}`)
		expect(isFrozen(result.lobby)).toBe(true)
		expect(stateOf(result.lobby).facts.animating).toEqual(['a'])
	})

	it('a restart yields an unfrozen referee that freezes from the metadata as it stands then', () => {
		const lobby = pvpTick(
			raced(startedLobbyWith({ ruleset: 'ruleset_mp_balanced' }, 'a', 'b')),
			ctx,
		).lobby
		expect(isFrozen(lobby)).toBe(true)
		const restarted = restartedGame(lobby, ctx)
		if (!restarted) throw new Error('no restart')
		const after = { ...lobby, game: restarted.game }
		expect(stateOf(after).rules.runId).toBeNull()
		const changed = setMetadata(after, 'a', {
			ruleset: 'ruleset_mp_experimental',
		})
		const refrozen = pvpTick(raced(changed.lobby), ctx).lobby
		const rules = stateOf(refrozen).rules
		if (rules.runId === null) throw new Error('not frozen')
		expect(rules.clocks.personal?.kind).toBe('pressure')
	})
})

describe('the ruleset and the rule keys under a started game (D1d guard)', () => {
	it('before the freeze a ruleset the table does not know is refused bad_rules, and the rest of the patch goes through', () => {
		const lobby = startedLobbyWith(
			{ ruleset: 'ruleset_mp_experimental' },
			'a',
			'b',
		)
		const changed = setMetadata(lobby, 'a', { ruleset: 'ruleset_nope', x: 1 })
		expect(refusedKeys(changed)).toEqual(['ruleset'])
		expect(changed.lobby.metadata.ruleset).toBe('ruleset_mp_experimental')
		expect(changed.lobby.metadata.x).toBe(1)
		const ticked = pvpTick(raced(changed.lobby), ctx).lobby
		const rules = stateOf(ticked).rules
		if (rules.runId === null) throw new Error('no game')
		expect(rules.clocks.personal?.kind).toBe('pressure')
	})

	it.each<[string, unknown]>([
		['queue_mode', 'pvp_mystery'],
		['starting_lives', 0],
		['pvp_start_round', 'x'],
		['timer_base_seconds', null],
		['timer_forgiveness', 'x'],
		['timer_increment_seconds', 'soon'],
	])('before the freeze a malformed %s is refused and the lobby keeps the value it had', (key, value) => {
		const lobby = startedLobbyWith({}, 'a', 'b')
		const changed = setMetadata(lobby, 'a', { [key]: value })
		expect(refusedKeys(changed)).toEqual([key])
		expect(changed.lobby.metadata[key]).toBe(lobby.metadata[key])
	})

	it('after the freeze a changed starting_lives is refused, a changed ruleset too, and other keys still pass', () => {
		const lobby = pvpTick(
			raced(
				startedLobbyWith(
					{ ruleset: 'ruleset_mp_experimental', starting_lives: 4 },
					'a',
					'b',
				),
			),
			ctx,
		).lobby
		expect(isFrozen(lobby)).toBe(true)
		const changed = setMetadata(lobby, 'a', {
			starting_lives: 2,
			ruleset: 'ruleset_mp_balanced',
			deck: 'b_red',
		})
		expect(refusedKeys(changed).sort()).toEqual(['ruleset', 'starting_lives'])
		expect(changed.lobby.metadata.starting_lives).toBe(4)
		expect(changed.lobby.metadata.ruleset).toBe('ruleset_mp_experimental')
		expect(changed.lobby.metadata.deck).toBe('b_red')
	})

	it('the same ruleset and other keys still go through while a game runs', () => {
		const lobby = startedLobbyWith({ ruleset: 'ruleset_mp_experimental' }, 'a', 'b')
		const same = setMetadata(lobby, 'a', { ruleset: 'ruleset_mp_experimental', x: 1 })
		expect(same.lobby.metadata.x).toBe(1)
		expect(setMetadata(lobby, 'a', { x: 2 }).lobby.metadata.x).toBe(2)
	})
})

describe('a leave before the run begins (D1d pre-freeze end)', () => {
	const saveOf = (step: Step): RunRecord => {
		const run = saved(step)
		if (!run) throw new Error('no run saved')
		return run
	}
	const dodges = (step: Step) => step.out.filter((o) => o.kind === 'dodged')
	const ranked = (lobby: Lobby): Lobby => ({
		...lobby,
		rankedMode: 'pvp_ranked_balanced',
	})

	test.each([
		['a leaves the 2-player casual game: b wins', ['a', 'b'], 'a', false, 'b'],
		['b leaves the 2-player casual game: a wins', ['a', 'b'], 'b', false, 'a'],
	])('preFreezeEnd: %s', (_name, startedIds, leaver, isRanked, stayer) => {
		expect(preFreezeEnd(startedIds, leaver, 'RUN', isRanked)).toEqual({
			kind: 'result',
			result: {
				runId: 'RUN',
				kind: 'win',
				winnerId: stayer,
				winnerTeam: null,
				places: [
					{ playerId: stayer, place: 1 },
					{ playerId: leaver, place: 2 },
				],
			},
		})
	})

	it('preFreezeEnd: a ranked 2-player leave is a dodge, a 3-player leave is not an end', () => {
		expect(preFreezeEnd(['a', 'b'], 'b', 'RUN', true)).toEqual({
			kind: 'dodged',
			leaverId: 'b',
		})
		expect(preFreezeEnd(['a', 'b', 'c'], 'b', 'RUN', true)).toEqual({
			kind: 'none',
		})
		expect(preFreezeEnd(['a', 'b'], 'x', 'RUN', false)).toEqual({ kind: 'none' })
	})

	it('a casual 2-player leave stores the stayer first and ends the game', () => {
		const left = leave(startedLobby('a', 'b'), 'b', 500).lobby
		const step = pvpTick(left, ctx)
		const run = saveOf(step)
		expect(step.lobby.game.started).toBeNull()
		expect(run.status).toBe('agreed')
		expect(run.placements.map((p) => [p.playerId, p.place])).toEqual([
			['a', 1],
			['b', 2],
		])
		expect(dodges(step)).toEqual([])
	})

	it('a ranked 2-player leave is a dodge: stored dodged, nobody placed, one dodge record', () => {
		const left = leave(ranked(startedLobby('a', 'b')), 'b', 500).lobby
		const step = pvpTick(left, testContext(1234))
		const run = saveOf(step)
		expect(step.lobby.game.started).toBeNull()
		expect(run.status).toBe('dodged')
		expect(run.placements).toEqual([])
		expect(dodges(step)).toEqual([
			{
				kind: 'dodged',
				leaverId: 'b',
				runId: run.runId,
				at: 1234,
				rankedMode: 'pvp_ranked_balanced',
			},
		])
	})

	it('a pvp.forfeit before the run began is a dodge in a ranked lobby', () => {
		const lobby = ranked(startedLobby('a', 'b'))
		const forfeited = fact(lobby, 'pvp.forfeit', 'a', {})
		const step = pvpTick(forfeited, ctx)
		expect(saveOf(step).status).toBe('dodged')
		expect(dodges(step).map((o) => o.kind === 'dodged' && o.leaverId)).toEqual(['a'])
	})

	it('mpapi_abandon_game before the run began is a casual loss for the requester', () => {
		const lobby = startedLobby('a', 'b')
		const abandoned = send(lobby, 'b', 'mpapi_abandon_game').lobby
		const step = pvpTick(abandoned, ctx)
		const run = saveOf(step)
		expect(run.status).toBe('agreed')
		expect(run.placements.find((p) => p.place === 1)?.playerId).toBe('a')
	})

	it('a 3-player leave removes the leaver and the game goes on', () => {
		const left = leave(startedLobby('a', 'b', 'c'), 'c', 500).lobby
		const step = pvpTick(left, ctx)
		expect(saved(step)).toBeUndefined()
		expect(step.lobby.game.started).not.toBeNull()
		const after = pvpTick(raced(step.lobby), ctx).lobby
		expect(stateOf(after).lives.players.c.left).toBe(true)
	})

	it('a leave after the run began is the ordinary forfeit, not a dodge', () => {
		const live = started('a', 'b')
		const step = pvpTick(leave(ranked(live), 'b', 500).lobby, ctx)
		expect(dodges(step)).toEqual([])
		expect(saved(step)?.status).not.toBe('dodged')
	})
})

describe('fix round 1: the freeze point and the double leave', () => {
	const ranked = (lobby: Lobby): Lobby => ({
		...lobby,
		rankedMode: 'pvp_ranked_balanced',
	})

	it('pvp.ready as the first request of a run freezes the rules (F1)', () => {
		const lobby = startedLobby('a', 'b')
		const runId = lobby.game.started?.runId
		expect(stateOf(lobby).rules.runId).not.toBe(runId)
		for (const type of ['pvp.ready', 'pvp.unready']) {
			const result = PVP_REQUESTS[type].reduce(
				lobby,
				'a',
				{ runId, roundId: 1, startingHands: 4, blindKey: '2:Boss' },
				ctx,
			)
			if (!result.ok) throw new Error(`refused: ${result.reason}`)
			expect(stateOf(result.lobby).rules.runId).toBe(runId)
		}
	})

	it('a ranked start whose metadata holds only the pin starts on the pin (F2)', () => {
		const found = rankedPinOf('pvp_ranked_balanced')
		if (!found.ok) throw new Error('no pin')
		let lobby = newLobby({
			code: 'ABC123',
			modId: 'MultiplayerPvP',
			maxPlayers: 2,
			creatorId: 'a',
			rankedMode: 'pvp_ranked_balanced',
			allowedIds: ['a', 'b'],
			metadata: found.pin,
			now: 0,
			graceMs: 10_000,
			resultTimeoutMs: 60_000,
		})
		for (const id of ['a', 'b'])
			lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
		lobby = send(lobby, 'b', 'mpapi_ready', { ready: true }).lobby
		const step = send(lobby, 'a', 'mpapi_start_game', { stake: 2 })
		expect(rejection(step)).toBeUndefined()
		expect(rejectedKey(step)).toBeUndefined()
		const after = pvpTick(raced(step.lobby), ctx).lobby
		expect(stateOf(after).rules).toMatchObject({
			startingLives: 4,
			hunterLives: 7,
			pvpStartAnte: 2,
			mode: 'nemesis',
		})
	})

	it('the freeze starts the run with nobody animating: an entry found there is a leftover of the last run (F8)', () => {
		const lobby = raced(startedLobby('a', 'b'))
		const before = stateOf(lobby)
		const withAnimating = withReferee(lobby, {
			...before,
			facts: { ...before.facts, animating: ['a'] },
		})
		const after = pvpTick(withAnimating, ctx).lobby
		expect(isFrozen(after)).toBe(true)
		expect(stateOf(after).facts.animating).toEqual([])
	})

	it('both players leaving before the run began ends the game abandoned and unrated (F9)', () => {
		const left = leave(
			leave(startedLobby('a', 'b'), 'a', 500).lobby,
			'b',
			500,
		).lobby
		const step = pvpTick(left, ctx)
		expect(saved(step)?.status).toBe('abandoned')
		expect(saved(step)?.placements).toEqual([])
		expect(step.lobby.game.started).toBeNull()
		expect(step.out.filter((o) => o.kind === 'dodged')).toEqual([])
	})

	it('both players leaving a ranked game before the run began: each gets a dodge record (F9)', () => {
		const left = leave(
			leave(ranked(startedLobby('a', 'b')), 'a', 500).lobby,
			'b',
			500,
		).lobby
		const step = pvpTick(left, ctx)
		expect(saved(step)?.status).toBe('abandoned')
		expect(
			step.out.flatMap((o) => (o.kind === 'dodged' ? [o.leaverId] : [])),
		).toEqual(['a', 'b'])
	})

	it('both players forfeiting after the freeze in one tick ends the run (F9)', () => {
		let lobby = started('a', 'b')
		lobby = fact(lobby, 'pvp.forfeit', 'a', {})
		lobby = fact(lobby, 'pvp.forfeit', 'b', {})
		const step = pvpTick(lobby, ctx)
		expect(saved(step)).toBeDefined()
		expect(step.lobby.game.started).toBeNull()
	})

	it('the post-freeze double forfeit is a draw through the mode settle (F9)', () => {
		let lobby = started('a', 'b')
		lobby = fact(lobby, 'pvp.forfeit', 'a', {})
		lobby = fact(lobby, 'pvp.forfeit', 'b', {})
		const step = pvpTick(lobby, ctx)
		// lastPlayerStanding (modes/common.ts): no-one alive is a draw.
		expect(saved(step)?.status).toBe('agreed')
	})

	it('a ranked post-freeze double forfeit is abandoned and rates nobody', () => {
		let lobby = started('a', 'b')
		lobby = { ...lobby, rankedMode: 'pvp_ranked_balanced' }
		lobby = fact(lobby, 'pvp.forfeit', 'a', {})
		lobby = fact(lobby, 'pvp.forfeit', 'b', {})
		const step = pvpTick(lobby, ctx)
		expect(saved(step)?.status).toBe('abandoned')
		expect(saved(step)?.placements).toEqual([])
		expect(step.lobby.game.started).toBeNull()
	})

	it('a casual 3-player run where all forfeit still ends in the draw', () => {
		let lobby = started('a', 'b', 'c')
		for (const id of ['a', 'b', 'c']) lobby = fact(lobby, 'pvp.forfeit', id, {})
		expect(saved(pvpTick(lobby, ctx))?.status).toBe('agreed')
	})

	it('a ranked single forfeit is still rated: agreed, the stayer first', () => {
		let lobby = started('a', 'b')
		lobby = { ...lobby, rankedMode: 'pvp_ranked_balanced' }
		lobby = fact(lobby, 'pvp.forfeit', 'a', {})
		const run = saved(pvpTick(lobby, ctx))
		expect(run?.status).toBe('agreed')
		expect(
			[...(run?.placements ?? [])]
				.sort((x, y) => x.place - y.place)
				.map((p) => [p.playerId, p.place]),
		).toEqual([
			['b', 1],
			['a', 2],
		])
	})

	it('a ranked forfeit and a leave in one tick is abandoned and announces no unrefereeable log', () => {
		let lobby = started('a', 'b')
		lobby = { ...lobby, rankedMode: 'pvp_ranked_balanced' }
		lobby = fact(lobby, 'pvp.forfeit', 'a', {})
		lobby = leave(lobby, 'b', 500).lobby
		const step = pvpTick(lobby, ctx)
		expect(saved(step)?.status).toBe('abandoned')
		expect(saved(step)?.placements).toEqual([])
		expect(step.out.filter((o) => o.kind === 'log')).toEqual([])
		const ended = sends(step).filter(
			(o) =>
				o.op === ServerOp.EVENT &&
				(o.payload as { type: string }).type === 'game_ended',
		)
		expect(ended).toHaveLength(1)
		expect(ended[0].payload).toMatchObject({
			data: { status: 'abandoned', placements: [] },
		})
	})

	it('all players of a 3-player game leaving before the run began ends abandoned and unrated', () => {
		let l = startedLobby('a', 'b', 'c')
		for (const id of ['a', 'b', 'c']) l = leave(l, id, 500).lobby
		const step = pvpTick(l, ctx)
		expect(saved(step)?.status).toBe('abandoned')
		expect(saved(step)?.placements).toEqual([])
		expect(step.lobby.game.started).toBeNull()
		expect(step.out.filter((o) => o.kind === 'dodged')).toEqual([])
	})

	it('all players of a ranked 3-player lobby leaving before the run began end abandoned with no dodge record', () => {
		let l = ranked(startedLobby('a', 'b', 'c'))
		for (const id of ['a', 'b', 'c']) l = leave(l, id, 500).lobby
		const step = pvpTick(l, testContext(1234))
		expect(saved(step)?.status).toBe('abandoned')
		expect(step.out.filter((o) => o.kind === 'dodged')).toEqual([])
	})

	it('two of three leaving before the run began is still no end', () => {
		let l = startedLobby('a', 'b', 'c')
		for (const id of ['a', 'b']) l = leave(l, id, 500).lobby
		const step = pvpTick(l, ctx)
		expect(saved(step)).toBeUndefined()
		expect(step.lobby.game.started).not.toBeNull()
	})

	it('a freeze that finds bad metadata refuses the request naming the key (F6)', () => {
		const lobby = startedLobby('a', 'b')
		const broken = {
			...lobby,
			metadata: withRules({ starting_lives: undefined }),
		}
		const runId = broken.game.started?.runId
		const result = PVP_REQUESTS['pvp.ready'].reduce(
			broken,
			'a',
			{ runId, roundId: 1, startingHands: 4, blindKey: '2:Boss' },
			ctx,
		)
		expect(result).toEqual({
			ok: false,
			reason: 'bad_rules',
			key: 'starting_lives',
		})
	})

	it('an unrefereeable game is abandoned and the log names run and key (F6)', () => {
		const lobby = raced(startedLobby('a', 'b'))
		const broken = {
			...lobby,
			metadata: withRules({ starting_lives: undefined }),
		}
		const step = pvpTick(broken, ctx)
		expect(saved(step)?.status).toBe('abandoned')
		expect(step.out).toContainEqual({
			kind: 'log',
			message: `run ${broken.game.started?.runId} is unrefereeable: bad_rules starting_lives`,
		})
	})
})

describe('an Ante timer across a server restart', () => {
	// `a` Ready for round 2 and holding a 30 s Ante timer that runs out at t = 31000.
	function anteTimer(): Lobby {
		const l = ready(game('a', 'b'), 'a')
		const s = stateOf(l)
		return withReferee(l, {
			...s,
			facts: {
				...s.facts,
				deadline: { kind: 'ante', by: 'a', against: ['b'], endsAt: 31_000, shownMs: 30_000, n: 1 },
			},
		})
	}
	const resumed = (): Lobby => {
		const cp = checkpointOf(anteTimer(), 10_000)
		if (!cp) throw new Error('the lobby has players, so it checkpoints')
		return resumeFrom(cp, 70_000)
	}

	it('survives the resume: a restart is not the starter leaving, so the first tick keeps it', () => {
		const ticked = pvpTick(resumed(), testContext(71_000)).lobby
		expect(stateOf(ticked).facts.deadline).toMatchObject({ kind: 'ante', by: 'a', against: ['b'] })
	})

	it('waits for its starter: b is back, a is not, and the timer does not run out on b', () => {
		const back = join(resumed(), 'b', 'b-s2', info('b')).lobby
		const before = livesOf(back, 'b')
		// Well past the carried end (91 000), inside a's grace.
		const ticked = pvpTick(back, testContext(100_000)).lobby
		expect(livesOf(ticked, 'b')).toBe(before)
		expect(stateOf(ticked).facts.deadline).toMatchObject({ kind: 'ante', by: 'a', pausedMs: expect.any(Number) })
		// a is back: the clock goes on with the time it had.
		const both = join(ticked, 'a', 'a-s2', info('a')).lobby
		expect(stateOf(pvpTick(both, testContext(100_500)).lobby).facts.deadline).not.toHaveProperty('pausedMs')
	})

	it('does not outlive the round both players start by re-Readying in one batch', () => {
		let l = join(join(resumed(), 'a', 'a-s2', info('a')).lobby, 'b', 'b-s2', info('b')).lobby
		// Both resend Ready for the next blind before any tick sees a Ready alone.
		l = ready(ready(l, 'a'), 'b')
		expect(pvpOf(l)?.round).toBe(2)
		const ticked = pvpTick(l, testContext(72_000)).lobby
		expect(stateOf(ticked).facts.deadline).toBeNull()
	})
})
