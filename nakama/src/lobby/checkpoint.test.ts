import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { populatedPvpLobby } from '../testing/pvp_fixtures'
import {
	CHECKPOINT_SCHEMA,
	CHECKPOINT_TTL_MS,
	CLAIM_TIMEOUT_MS,
	type Checkpoint,
	checkpointOf,
	deleteCheckpoint,
	isClaimable,
	readCheckpoint,
	resumeFrom,
	resumeLobby,
	saveCheckpoint,
} from './checkpoint'
import { clockLive } from './pvp/clocks'
import { emptyFacts, refereeOf, withReferee } from './pvp/state'
import { bindCode, lookupCode, reserveCode } from './codes'
import { lobbyMatchInit, lobbyMatchLoop, lobbyMatchTerminate } from './match'
import { CURRENT_LOBBY_COLLECTION, CURRENT_LOBBY_KEY, LOBBY_CHECKPOINT_COLLECTION, LOBBY_CODE_COLLECTION, ServerOp, SYSTEM_USER_ID } from './protocol'
import { rpcLobbyCurrent, rpcLobbyFind } from './rpc'
import { type Lobby, join, newLobby } from './state'

const info = (name: string) => ({ displayName: name, preferredJoker: null, mods: null })

function checkpointed(lobby: Lobby, at: number): Checkpoint {
	const checkpoint = checkpointOf(lobby, at)
	if (!checkpoint) throw new Error('the lobby has players, so it checkpoints')
	return checkpoint
}

function factsOf(lobby: Lobby) {
	const referee = refereeOf(lobby)
	if (!referee) throw new Error('the lobby is a PvP game with a referee')
	return referee.facts
}

function startedLobby(): Lobby {
	let lobby = newLobby({ code: 'ABC123', modId: 'M', maxPlayers: 4, creatorId: 'a', now: 0, graceMs: 10_000 })
	lobby = join(lobby, 'a', 'a-s', info('a')).lobby
	lobby = join(lobby, 'b', 'b-s', info('b')).lobby
	return {
		...lobby,
		spectators: ['c'],
		actionBudget: { a: { tokens: 1, at: 5 } },
		game: { ...lobby.game, settleFrom: 1000, reports: { a: [] }, reportOrder: ['a'] },
	}
}

// A checkpoint of `lobby` as this build writes one, taken at `at`.
const stamped = (lobby: Lobby, at = 0, over: Partial<Checkpoint> = {}): Checkpoint => ({
	schema: CHECKPOINT_SCHEMA,
	lobby,
	at,
	claimedAt: null,
	expiresAt: at + CHECKPOINT_TTL_MS,
	...over,
})

// A fake Nakama with live matches: matchCreate runs the real lobbyMatchInit.
function nakama() {
	const matches: { [id: string]: Lobby } = {}
	let next = 0
	const nk: any = fakeNk({
		matchGet: (id: string) => (matches[id] ? { matchId: id } : null),
		matchCreate: (_name: string, params: any) => {
			const id = `m${++next}`
			const init = lobbyMatchInit({ ...playerCtx(''), matchId: id }, fakeLogger, nk, params)
			matches[id] = init.state.lobby
			return id
		},
		matchSignal: (id: string, data: string) => {
			const signal = JSON.parse(data)
			return matches[id].players.some((p) => p.id === signal.userId) ? 'yes' : 'no'
		},
	})
	return { nk, matches }
}

describe('checkpointOf / resumeFrom', () => {
	it('keeps a lobby with players, not an empty or closed one', () => {
		const lobby = startedLobby()
		expect(checkpointOf(lobby, 5)).toEqual({
			schema: CHECKPOINT_SCHEMA,
			lobby,
			at: 5,
			claimedAt: null,
			expiresAt: 5 + CHECKPOINT_TTL_MS,
		})
		expect(checkpointOf({ ...lobby, players: [] }, 5)).toBeNull()
		expect(checkpointOf({ ...lobby, closed: true }, 5)).toBeNull()
	})

	it('brings everyone back away with a fresh grace period and rebases the result clock', () => {
		const lobby = startedLobby()
		const resumed = resumeFrom(stamped(lobby, 2000), 9000)
		expect(resumed.players.map((p) => [p.id, p.awaySince, p.sessionId])).toEqual([
			['a', 9000, ''],
			['b', 9000, ''],
		])
		expect(resumed.game.settleFrom).toBe(1000 + 7000)
		expect(resumed.game.reports).toEqual({ a: [] })
		expect(resumed.hostId).toBe('a')
		expect(resumed.spectators).toEqual([])
		expect(resumed.actionBudget).toEqual({})
		expect(resumed.createdAt).toBe(9000)
		// JSON round trip, as storage does it.
		expect(resumeFrom(JSON.parse(JSON.stringify(stamped(lobby, 2000))), 9000)).toEqual(resumed)
	})

	it('lets a stuck claim be taken over, and expires', () => {
		const cp = stamped(startedLobby(), 0, { claimedAt: 100 })
		expect(isClaimable(cp, 100 + CLAIM_TIMEOUT_MS - 1)).toBe(false)
		expect(isClaimable(cp, 100 + CLAIM_TIMEOUT_MS)).toBe(true)
		expect(isClaimable({ ...cp, claimedAt: null }, CHECKPOINT_TTL_MS)).toBe(false)
	})
})

describe('deleting a checkpoint, as real Nakama takes it', () => {
	// Real Nakama throws a TypeError on a delete request with `version: undefined`;
	// the fake does the same, so the request must carry no version key at all.
	it('the fake refuses a version key that is not a string', () => {
		const { nk } = nakama()
		saveCheckpoint(nk, checkpointOf(startedLobby(), Date.now())!)
		expect(() =>
			nk.storageDelete([{ collection: LOBBY_CHECKPOINT_COLLECTION, key: 'ABC123', userId: SYSTEM_USER_ID, version: undefined }]),
		).toThrow(TypeError)
	})

	it('a delete without a version removes the checkpoint', () => {
		const { nk } = nakama()
		saveCheckpoint(nk, checkpointOf(startedLobby(), Date.now())!)
		deleteCheckpoint(nk, 'ABC123')
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
	})

	it('an expired checkpoint is deleted when someone rejoins', () => {
		const { nk } = nakama()
		saveCheckpoint(nk, checkpointOf(startedLobby(), Date.now())!)
		expect(resumeLobby(nk, fakeLogger, 'ABC123', Date.now() + CHECKPOINT_TTL_MS + 1)).toEqual({ kind: 'none' })
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
	})
})

describe('a restart', () => {
	it('checkpoints the lobby on shutdown and tells the players', () => {
		const { nk } = nakama()
		const sent: any[] = []
		const dispatcher: any = { broadcastMessage: (...args: any[]) => sent.push(args) }
		const lobby = startedLobby()
		const presences = { a: { userId: 'a' }, b: { userId: 'b' } }
		const state: any = { lobby, presences, pendingInfo: {}, label: '' }
		const ended = lobbyMatchTerminate({ ...playerCtx(''), matchId: 'm0' }, fakeLogger, nk, dispatcher, 1, state, 20)
		expect(ended.state.stopping).toBe(true)
		expect(lobbyMatchLoop({ ...playerCtx(''), matchId: 'm0' }, fakeLogger, nk, dispatcher, 2, ended.state, [])).toBeNull()
		expect(readCheckpoint(nk, 'ABC123')!.checkpoint.lobby).toEqual(lobby)
		expect(sent.map((s) => [s[0], JSON.parse(s[1]), s[2].length])).toEqual([[ServerOp.SERVER_RESTARTING, { graceSeconds: 20 }, 2]])
	})

	it('resumes the lobby under its code once a player comes back, once', () => {
		const { nk, matches } = nakama()
		const lobby = startedLobby()
		bindCode(nk, 'ABC123', 'gone', 'M')
		for (const id of ['a', 'b'])
			nk.storageWrite([
				{ collection: CURRENT_LOBBY_COLLECTION, key: CURRENT_LOBBY_KEY, userId: id, value: { matchId: 'gone', code: 'ABC123', modId: 'M' } },
			])
		saveCheckpoint(nk, stamped(lobby, Date.now()))
		// Its code can't be handed out meanwhile.
		expect(reserveCode(nk, 'ABC123', 'M')).toBe(false)

		const seat = JSON.parse(rpcLobbyCurrent(playerCtx('a'), fakeLogger, nk, '{}'))
		expect(seat).toEqual({ matchId: 'm1', code: 'ABC123', modId: 'M' })
		expect(matches.m1.players.map((p) => p.awaySince !== null)).toEqual([true, true])
		expect(matches.m1.game.reports).toEqual({ a: [] })
		// The other player, the code and the checkpoint all moved on.
		expect(JSON.parse(rpcLobbyCurrent(playerCtx('b'), fakeLogger, nk, '{}')).matchId).toBe('m1')
		expect(JSON.parse(rpcLobbyFind(playerCtx('c'), fakeLogger, nk, '{"code":"ABC123"}')).matchId).toBe('m1')
		expect(nk.objects.get(`${LOBBY_CODE_COLLECTION}/${SYSTEM_USER_ID}/ABC123`).value.matchId).toBe('m1')
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
		expect(Object.keys(matches)).toEqual(['m1'])
	})

	it('tells a second caller to wait while a resume is under way', () => {
		const { nk } = nakama()
		saveCheckpoint(nk, stamped(startedLobby(), Date.now(), { claimedAt: Date.now() }))
		nk.storageWrite([
			{ collection: CURRENT_LOBBY_COLLECTION, key: CURRENT_LOBBY_KEY, userId: 'a', value: { matchId: 'gone', code: 'ABC123', modId: 'M' } },
		])
		expect(JSON.parse(rpcLobbyCurrent(playerCtx('a'), fakeLogger, nk, '{}'))).toEqual({ resuming: true })
		expect(() => rpcLobbyFind(playerCtx('a'), fakeLogger, nk, '{"code":"ABC123"}')).toThrow(/resuming/)
		// The record is kept for the retry.
		expect(nk.objects.has(`${CURRENT_LOBBY_COLLECTION}/a/${CURRENT_LOBBY_KEY}`)).toBe(true)
	})

	it('drops an expired checkpoint', () => {
		const { nk } = nakama()
		saveCheckpoint(nk, stamped(startedLobby(), Date.now() - CHECKPOINT_TTL_MS))
		expect(reserveCode(nk, 'ABC123', 'M')).toBe(true)
		expect(resumeLobby(nk, fakeLogger, 'ABC123', Date.now())).toEqual({ kind: 'none' })
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
	})
})

describe('Run saves across a restart', () => {
	const save = (id: string, pos: number) => ({
		id,
		pos,
		hash: 'a'.repeat(64),
		data: `data-${id}`,
		at: 7,
	})
	const pending = (id: string) => ({
		id,
		count: 3,
		pos: 9,
		hash: 'b'.repeat(64),
		parts: { '0': 'x' },
	})

	function restartAndResume() {
		const { nk, matches } = nakama()
		const base = startedLobby()
		const lobby: Lobby = {
			...base,
			game: {
				...base.game,
				runSaves: { a: save('s1', 4), b: save('s2', 6) },
				runSavePending: { a: pending('s3') },
			},
		}
		bindCode(nk, 'ABC123', 'gone', 'M')
		type Terminate = Parameters<typeof lobbyMatchTerminate>
		const dispatcher = { broadcastMessage: () => {} } as unknown as Terminate[3]
		const state = {
			lobby,
			presences: {},
			pendingInfo: {},
			label: '',
		} as unknown as Terminate[5]
		lobbyMatchTerminate(
			{ ...playerCtx(''), matchId: 'm0' },
			fakeLogger,
			nk,
			dispatcher,
			1,
			state,
			20,
		)
		const result = resumeLobby(nk, fakeLogger, 'ABC123', Date.now())
		expect(result.kind).toBe('resumed')
		return { resumed: matches.m1, lobby }
	}

	it('gives the restored lobby each player latest complete Run save, unchanged', () => {
		const { resumed, lobby } = restartAndResume()
		expect(resumed.game.runSaves).toEqual(lobby.game.runSaves)
	})

	it('does not carry unfinished parts', () => {
		const { resumed } = restartAndResume()
		expect(resumed.game.runSavePending).toBeUndefined()
	})
})

// ---------------------------------------------------------------- server times

// The seat ids, blind keys, antes and sequence numbers of populatedPvpLobby, which name map entries rather
// than keys of the shape.
const DYNAMIC_KEYS = new Set(['ua', 'ub', 'ud', '1:Small', '1:Boss', 'd1', 'v1', 'x', '1', '2'])

// Every path of `value` down to its leaves, dynamic keys as `*`, array items as `[]`.
function keyPaths(value: unknown, path = ''): string[] {
	if (Array.isArray(value)) {
		if (value.length === 0) return [`${path}[]`]
		return value.flatMap((item) => keyPaths(item, `${path}[]`))
	}
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value)
		if (entries.length === 0) return [path]
		return entries.flatMap(([k, v]) => keyPaths(v, `${path}${path ? '.' : ''}${DYNAMIC_KEYS.has(k) ? '*' : k}`))
	}
	return [path]
}
const uniqueSorted = (paths: string[]): string[] => [...new Set(paths)].sort()

// Every numeric leaf under `value` whose key ends in a server-time name, with its real path.
function timeLeaves(value: unknown, path = ''): { path: string; at: number }[] {
	if (typeof value !== 'object' || value === null) return []
	return Object.entries(value).flatMap(([k, v]) => {
		const here = `${path}${path ? '.' : ''}${k}`
		if (typeof v === 'number') return /(At|Until|since|endsAt)$/.test(k) ? [{ path: here, at: v }] : []
		return timeLeaves(v, here)
	})
}

describe('a resume moves every server time of the referee by the downtime', () => {
	const AT = 50_000
	const DOWNTIME = 100_000
	const NOW = AT + DOWNTIME
	const resumedFixture = () => resumeFrom(checkpointed(populatedPvpLobby(), AT), NOW)

	it('moves a running deadline, each clock since and each graceUntil; null stays null', () => {
		const before = factsOf(populatedPvpLobby())
		const after = factsOf(resumedFixture())
		expect(after.deadline).toEqual({ ...before.deadline, endsAt: 70_000 + DOWNTIME })
		expect(after.clocks.ua).toEqual({ ...before.clocks.ua, since: 40_000 + DOWNTIME, graceUntil: 53_000 + DOWNTIME })
		expect(after.clocks.ub).toEqual({ ...before.clocks.ub, since: 45_000 + DOWNTIME, graceUntil: null })
	})

	it('a running personal clock shows after the resume what it showed when the server stopped', () => {
		const before = factsOf(populatedPvpLobby()).clocks.ua
		const after = factsOf(resumedFixture()).clocks.ua
		expect(clockLive(before, AT)).toBe(90_000 - 10_000 * 2)
		expect(clockLive(after, NOW)).toBe(clockLive(before, AT))
	})

	it('every opponent record, the never-published server facts included, restores identically through storage', () => {
		const lobby = populatedPvpLobby()
		const stored: Checkpoint = JSON.parse(JSON.stringify(checkpointed(lobby, AT)))
		const before = factsOf(lobby)
		const after = factsOf(resumeFrom(stored, NOW))
		for (const record of ['nemesis', 'opponent', 'server', 'effects', 'traps'] as const) {
			expect(before[record]).not.toEqual(emptyFacts()[record])
			expect(after[record]).toEqual(before[record])
		}
	})

	it('a paused deadline is copied unchanged', () => {
		const lobby = populatedPvpLobby({ paused: true })
		const before = factsOf(lobby).deadline
		expect(before).toMatchObject({ pausedMs: 20_000 })
		// Only the restart mark is added (an Ante deadline; see checkpoint.ts carriedOver).
		expect(before).toMatchObject({ kind: 'pvp' })
		expect(factsOf(resumeFrom(checkpointed(lobby, AT), NOW)).deadline).toEqual(before)
	})

	it('no downtime moves nothing, and a clock that jumped back moves nothing either', () => {
		const lobby = populatedPvpLobby()
		const same = factsOf(resumeFrom(checkpointed(lobby, AT), AT))
		const back = factsOf(resumeFrom(checkpointed(lobby, AT), AT - 1000))
		expect(same).toEqual(factsOf(lobby))
		expect(back).toEqual(factsOf(lobby))
	})

	// Names of the paths that hold an absolute time but are not a server time that a
	// resume must move, each with the reason. A new time key under lobby.game.pvp that
	// is neither shifted nor listed here fails the drift test below.
	const NOT_A_SERVER_TIME: { [path: string]: string } = {}

	it('drift: every time key under lobby.game.pvp is shifted by the downtime or listed as not a server time', () => {
		const before = timeLeaves(populatedPvpLobby().game.pvp, 'pvp')
		const after = timeLeaves(resumedFixture().game.pvp, 'pvp')
		expect(after.map((l) => l.path)).toEqual(before.map((l) => l.path))
		expect(before.map((l) => l.path)).toEqual([
			'pvp.referee.facts.deadline.endsAt',
			'pvp.referee.facts.clocks.ua.since',
			'pvp.referee.facts.clocks.ua.graceUntil',
			'pvp.referee.facts.clocks.ub.since',
		])
		const unshifted = before
			.filter((leaf, i) => after[i].at - leaf.at !== DOWNTIME && !(leaf.path in NOT_A_SERVER_TIME))
			.map((leaf) => leaf.path)
		expect(unshifted).toEqual([])
	})
})

// ---------------------------------------------------------------- the schema

// The key paths of a fully populated PvP lobby checkpoint, one frozen list per
// CHECKPOINT_SCHEMA. A change to the shape of what a checkpoint stores changes the
// paths found now, so they no longer equal the list of the current schema: add the
// new paths under the next number and bump CHECKPOINT_SCHEMA (a lobby checkpointed by
// an older build is then refused, not read with defaults). A frozen list is never edited.
const SHAPES: { [schema: number]: string[] } = {
	1: [
		'at',
		'claimedAt',
		'expiresAt',
		'lobby.actionBudget.*.at',
		'lobby.actionBudget.*.tokens',
		'lobby.allowedIds[]',
		'lobby.catchUpLimitMs',
		'lobby.chat[].at',
		'lobby.chat[].displayName',
		'lobby.chat[].senderId',
		'lobby.chat[].text',
		'lobby.closed',
		'lobby.code',
		'lobby.connSeq',
		'lobby.createdAt',
		'lobby.creatorId',
		'lobby.forfeitedSeats.*',
		'lobby.game.contest.against',
		'lobby.game.contest.at',
		'lobby.game.contest.by',
		'lobby.game.logs.*.ahead',
		'lobby.game.logs.*.bytes',
		'lobby.game.logs.*.lines[]',
		'lobby.game.logs.*.seq',
		'lobby.game.logs.*.truncated',
		'lobby.game.presence[].at',
		'lobby.game.presence[].by',
		'lobby.game.presence[].kind',
		'lobby.game.presence[].reason',
		'lobby.game.presence[].userId',
		'lobby.game.pvp.blindKeys.*',
		'lobby.game.pvp.firstReady',
		'lobby.game.pvp.lastStart.blindKeys.*',
		'lobby.game.pvp.lastStart.firstPlayer',
		'lobby.game.pvp.lastStart.players[]',
		'lobby.game.pvp.lastStart.roundId',
		'lobby.game.pvp.order[]',
		'lobby.game.pvp.readied[]',
		'lobby.game.pvp.ready.*',
		'lobby.game.pvp.referee.cardTargets.ante',
		'lobby.game.pvp.referee.cardTargets.targets.*',
		'lobby.game.pvp.referee.facts.anteSeen',
		'lobby.game.pvp.referee.facts.applied',
		'lobby.game.pvp.referee.facts.blinds.*.*.beaten',
		'lobby.game.pvp.referee.facts.blinds.*.*.roundLost',
		'lobby.game.pvp.referee.facts.clocks.*.graceUntil',
		'lobby.game.pvp.referee.facts.clocks.*.ms',
		'lobby.game.pvp.referee.facts.clocks.*.n',
		'lobby.game.pvp.referee.facts.clocks.*.rate',
		'lobby.game.pvp.referee.facts.clocks.*.running',
		'lobby.game.pvp.referee.facts.clocks.*.since',
		'lobby.game.pvp.referee.facts.clocks.*.spent',
		'lobby.game.pvp.referee.facts.deadline.against[]',
		'lobby.game.pvp.referee.facts.deadline.by',
		'lobby.game.pvp.referee.facts.deadline.endsAt',
		'lobby.game.pvp.referee.facts.deadline.kind',
		'lobby.game.pvp.referee.facts.deadline.n',
		'lobby.game.pvp.referee.facts.deadline.pausedMs',
		'lobby.game.pvp.referee.facts.deadline.shownMs',
		'lobby.game.pvp.referee.facts.deaths[].blindKey',
		'lobby.game.pvp.referee.facts.deaths[].outBefore.*',
		'lobby.game.pvp.referee.facts.deaths[].playerId',
		'lobby.game.pvp.referee.facts.forgiven.*',
		'lobby.game.pvp.referee.facts.guarded.*[]',
		'lobby.game.pvp.referee.facts.handRound.*',
		'lobby.game.pvp.referee.facts.log[].beaten',
		'lobby.game.pvp.referee.facts.log[].blindKey',
		'lobby.game.pvp.referee.facts.log[].hands',
		'lobby.game.pvp.referee.facts.log[].kind',
		'lobby.game.pvp.referee.facts.log[].playerId',
		'lobby.game.pvp.referee.facts.log[].roundLost',
		'lobby.game.pvp.referee.facts.log[].type',
		'lobby.game.pvp.referee.facts.log[].voucherKey',
		'lobby.game.pvp.referee.facts.pvpBlinds.*[]',
		'lobby.game.pvp.referee.facts.skips.*.facing',
		'lobby.game.pvp.referee.facts.skips.*.skips',
		'lobby.game.pvp.referee.facts.skips.*.skipsAtPvp',
		'lobby.game.pvp.referee.facts.skips.*.spentMs',
		'lobby.game.pvp.referee.facts.skipsSeen.*.rival',
		'lobby.game.pvp.referee.facts.skipsSeen.*.skips',
		'lobby.game.pvp.referee.facts.timerN',
		'lobby.game.pvp.referee.lives.pending[].blindKey',
		'lobby.game.pvp.referee.lives.pending[].playerId',
		'lobby.game.pvp.referee.lives.pending[].waitsOn[]',
		'lobby.game.pvp.referee.lives.players.*.eliminated',
		'lobby.game.pvp.referee.lives.players.*.events[].delta',
		'lobby.game.pvp.referee.lives.players.*.events[].key',
		'lobby.game.pvp.referee.lives.players.*.forfeited',
		'lobby.game.pvp.referee.lives.players.*.left',
		'lobby.game.pvp.referee.lives.players.*.lives',
		'lobby.game.pvp.referee.lives.runId',
		'lobby.game.pvp.referee.lives.teamLives.A',
		'lobby.game.pvp.referee.lives.teamLives.B',
		'lobby.game.pvp.referee.pairing.ante',
		'lobby.game.pvp.referee.pairing.lastBye',
		'lobby.game.pvp.referee.pairing.partners.*',
		'lobby.game.pvp.referee.pairing.usedPairs[]',
		'lobby.game.pvp.referee.result.kind',
		'lobby.game.pvp.referee.result.places[].place',
		'lobby.game.pvp.referee.result.places[].playerId',
		'lobby.game.pvp.referee.result.runId',
		'lobby.game.pvp.referee.result.winnerId',
		'lobby.game.pvp.referee.result.winnerTeam',
		'lobby.game.pvp.referee.round.lastResult.losers[]',
		'lobby.game.pvp.referee.round.lastResult.roundId',
		'lobby.game.pvp.referee.round.phase',
		'lobby.game.pvp.referee.round.players.*.ante',
		'lobby.game.pvp.referee.round.players.*.committedHands',
		'lobby.game.pvp.referee.round.players.*.creditedHands',
		'lobby.game.pvp.referee.round.players.*.furthestBlind',
		'lobby.game.pvp.referee.round.players.*.handsLeft',
		'lobby.game.pvp.referee.round.players.*.handsSpent',
		'lobby.game.pvp.referee.round.players.*.highestScore',
		'lobby.game.pvp.referee.round.players.*.pvpLeftMs',
		'lobby.game.pvp.referee.round.players.*.reportedApplied',
		'lobby.game.pvp.referee.round.players.*.reportedHands',
		'lobby.game.pvp.referee.round.players.*.score',
		'lobby.game.pvp.referee.round.players.*.timerLosses',
		'lobby.game.pvp.referee.round.roundId',
		'lobby.game.pvp.referee.round.runId',
		'lobby.game.pvp.referee.rules.clocks.ante',
		'lobby.game.pvp.referee.rules.clocks.personal.baseMs',
		'lobby.game.pvp.referee.rules.clocks.personal.graceMs',
		'lobby.game.pvp.referee.rules.clocks.personal.kind',
		'lobby.game.pvp.referee.rules.clocks.personal.previewCostMs',
		'lobby.game.pvp.referee.rules.clocks.personal.pvpMs',
		'lobby.game.pvp.referee.rules.clocks.personal.timedRate',
		'lobby.game.pvp.referee.rules.clocks.pvp.baseMs',
		'lobby.game.pvp.referee.rules.clocks.pvp.handMs',
		'lobby.game.pvp.referee.rules.deathOnRoundLoss',
		'lobby.game.pvp.referee.rules.hunterLives',
		'lobby.game.pvp.referee.rules.mode',
		'lobby.game.pvp.referee.rules.pvpStartAnte',
		'lobby.game.pvp.referee.rules.runId',
		'lobby.game.pvp.referee.rules.skipTimeRule',
		'lobby.game.pvp.referee.rules.startedCount',
		'lobby.game.pvp.referee.rules.startingLives',
		'lobby.game.pvp.referee.rules.timerBaseMs',
		'lobby.game.pvp.referee.rules.timerForgiveness',
		'lobby.game.pvp.referee.rules.timerIncrementMs',
		'lobby.game.pvp.referee.teams.runId',
		'lobby.game.pvp.referee.teams.teams.*',
		'lobby.game.pvp.referee.votes.draw[]',
		'lobby.game.pvp.referee.votes.runId',
		'lobby.game.pvp.referee.votes.seed[]',
		'lobby.game.pvp.round',
		'lobby.game.pvp.runId',
		'lobby.game.ready.*',
		'lobby.game.reportOrder[]',
		'lobby.game.reports.*[]',
		'lobby.game.resultPending',
		'lobby.game.resultWasPending',
		'lobby.game.runSaves.*.at',
		'lobby.game.runSaves.*.data',
		'lobby.game.runSaves.*.hash',
		'lobby.game.runSaves.*.id',
		'lobby.game.runSaves.*.pos',
		'lobby.game.settleFrom',
		'lobby.game.setup.open.banned[]',
		'lobby.game.setup.open.deadline',
		'lobby.game.setup.open.first',
		'lobby.game.setup.open.id',
		'lobby.game.setup.open.kind',
		'lobby.game.setup.open.options[]',
		'lobby.game.setup.open.order[]',
		'lobby.game.setup.open.pool[].key',
		'lobby.game.setup.open.pool[].stake',
		'lobby.game.setup.open.remaining',
		'lobby.game.setup.open.schedule[].action',
		'lobby.game.setup.open.schedule[].actor',
		'lobby.game.setup.open.schedule[].count',
		'lobby.game.setup.open.turn',
		'lobby.game.setup.open.turnMs',
		'lobby.game.setup.open.voters[]',
		'lobby.game.setup.open.votes.*',
		'lobby.game.setup.results.*.banned[]',
		'lobby.game.setup.results.*.counts.*',
		'lobby.game.setup.results.*.kind',
		'lobby.game.setup.results.*.option',
		'lobby.game.setup.results.*.survivors[].key',
		'lobby.game.setup.results.*.survivors[].stake',
		'lobby.game.started.hostId',
		'lobby.game.started.options',
		'lobby.game.started.players[].avatar',
		'lobby.game.started.players[].displayName',
		'lobby.game.started.players[].id',
		'lobby.game.started.raceStartedAt',
		'lobby.game.started.runId',
		'lobby.game.started.seed',
		'lobby.game.started.stake',
		'lobby.game.started.startedAt',
		'lobby.gameMode',
		'lobby.graceMs',
		'lobby.groupQueue.code',
		'lobby.groupQueue.matchId',
		'lobby.groupQueue.memberIds[]',
		'lobby.groupQueue.mode',
		'lobby.groupQueue.partyId',
		'lobby.groupQueue.phase',
		'lobby.groupQueue.since',
		'lobby.groupQueue.teams',
		'lobby.groupQueue.until',
		'lobby.groupsReleased',
		'lobby.groups[].homeCode',
		'lobby.groups[].memberIds[]',
		'lobby.groups[].partyId',
		'lobby.hostId',
		'lobby.kickedIds[]',
		'lobby.lastRunId',
		'lobby.maxPlayers',
		'lobby.metadata',
		'lobby.modId',
		'lobby.players[].awaySince',
		'lobby.players[].catchingUpSince',
		'lobby.players[].id',
		'lobby.players[].info.displayName',
		'lobby.players[].info.mods',
		'lobby.players[].info.preferredJoker',
		'lobby.players[].info.pvpVersion',
		'lobby.players[].ownState',
		'lobby.players[].sessionId',
		'lobby.rankedMode',
		'lobby.requiredStanding',
		'lobby.resultTimeoutMs',
		'lobby.rev',
		'lobby.spectators[]',
		'lobby.teamPicks.*',
		'lobby.teamPlan[][]',
		'schema',
	],
	2: [
		'at',
		'claimedAt',
		'expiresAt',
		'lobby.actionBudget.*.at',
		'lobby.actionBudget.*.tokens',
		'lobby.allowedIds[]',
		'lobby.catchUpLimitMs',
		'lobby.chat[].at',
		'lobby.chat[].displayName',
		'lobby.chat[].senderId',
		'lobby.chat[].text',
		'lobby.closed',
		'lobby.code',
		'lobby.connSeq',
		'lobby.createdAt',
		'lobby.creatorId',
		'lobby.forfeitedSeats.*',
		'lobby.game.contest.against',
		'lobby.game.contest.at',
		'lobby.game.contest.by',
		'lobby.game.logs.*.ahead',
		'lobby.game.logs.*.bytes',
		'lobby.game.logs.*.lines[]',
		'lobby.game.logs.*.seq',
		'lobby.game.logs.*.truncated',
		'lobby.game.presence[].at',
		'lobby.game.presence[].by',
		'lobby.game.presence[].kind',
		'lobby.game.presence[].reason',
		'lobby.game.presence[].userId',
		'lobby.game.pvp.blindKeys.*',
		'lobby.game.pvp.firstReady',
		'lobby.game.pvp.lastStart.blindKeys.*',
		'lobby.game.pvp.lastStart.firstPlayer',
		'lobby.game.pvp.lastStart.players[]',
		'lobby.game.pvp.lastStart.roundId',
		'lobby.game.pvp.order[]',
		'lobby.game.pvp.readied[]',
		'lobby.game.pvp.ready.*',
		'lobby.game.pvp.referee.cardTargets.ante',
		'lobby.game.pvp.referee.cardTargets.targets.*',
		'lobby.game.pvp.referee.facts.anteSeen',
		'lobby.game.pvp.referee.facts.applied',
		'lobby.game.pvp.referee.facts.blinds.*.*.beaten',
		'lobby.game.pvp.referee.facts.blinds.*.*.roundLost',
		'lobby.game.pvp.referee.facts.clocks.*.graceUntil',
		'lobby.game.pvp.referee.facts.clocks.*.ms',
		'lobby.game.pvp.referee.facts.clocks.*.n',
		'lobby.game.pvp.referee.facts.clocks.*.rate',
		'lobby.game.pvp.referee.facts.clocks.*.running',
		'lobby.game.pvp.referee.facts.clocks.*.since',
		'lobby.game.pvp.referee.facts.clocks.*.spent',
		'lobby.game.pvp.referee.facts.deadline.against[]',
		'lobby.game.pvp.referee.facts.deadline.by',
		'lobby.game.pvp.referee.facts.deadline.endsAt',
		'lobby.game.pvp.referee.facts.deadline.kind',
		'lobby.game.pvp.referee.facts.deadline.n',
		'lobby.game.pvp.referee.facts.deadline.pausedMs',
		'lobby.game.pvp.referee.facts.deadline.shownMs',
		'lobby.game.pvp.referee.facts.deaths[].blindKey',
		'lobby.game.pvp.referee.facts.deaths[].outBefore.*',
		'lobby.game.pvp.referee.facts.deaths[].playerId',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[]',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[].amount',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[].from',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[].kind',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[].n',
		'lobby.game.pvp.referee.facts.forgiven.*',
		'lobby.game.pvp.referee.facts.guarded.*[]',
		'lobby.game.pvp.referee.facts.handRound.*',
		'lobby.game.pvp.referee.facts.log[].beaten',
		'lobby.game.pvp.referee.facts.log[].blindKey',
		'lobby.game.pvp.referee.facts.log[].hands',
		'lobby.game.pvp.referee.facts.log[].kind',
		'lobby.game.pvp.referee.facts.log[].playerId',
		'lobby.game.pvp.referee.facts.log[].roundLost',
		'lobby.game.pvp.referee.facts.log[].type',
		'lobby.game.pvp.referee.facts.log[].voucherKey',
		'lobby.game.pvp.referee.facts.nemesis.*.*.each[]',
		'lobby.game.pvp.referee.facts.nemesis.*.*.one',
		'lobby.game.pvp.referee.facts.opponent.players.*.closed',
		'lobby.game.pvp.referee.facts.opponent.players.*.sells',
		'lobby.game.pvp.referee.facts.opponent.players.*.sells.*',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[]',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[].ante',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[].refused',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[].skipped',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[].spent',
		'lobby.game.pvp.referee.facts.pvpBlinds.*[]',
		'lobby.game.pvp.referee.facts.server.players.*.seenAnte',
		'lobby.game.pvp.referee.facts.skips.*.facing',
		'lobby.game.pvp.referee.facts.skips.*.skips',
		'lobby.game.pvp.referee.facts.skips.*.skipsAtPvp',
		'lobby.game.pvp.referee.facts.skips.*.spentMs',
		'lobby.game.pvp.referee.facts.skipsSeen.*.rival',
		'lobby.game.pvp.referee.facts.skipsSeen.*.skips',
		'lobby.game.pvp.referee.facts.timerN',
		'lobby.game.pvp.referee.facts.traps.trapSeq',
		'lobby.game.pvp.referee.facts.traps.traps[].holder',
		'lobby.game.pvp.referee.facts.traps.traps[].id',
		'lobby.game.pvp.referee.facts.traps.traps[].key',
		'lobby.game.pvp.referee.facts.traps.traps[].owner',
		'lobby.game.pvp.referee.facts.traps.traps[].state',
		'lobby.game.pvp.referee.facts.traps.traps[].state.fired.bounced',
		'lobby.game.pvp.referee.lives.pending[].blindKey',
		'lobby.game.pvp.referee.lives.pending[].playerId',
		'lobby.game.pvp.referee.lives.pending[].waitsOn[]',
		'lobby.game.pvp.referee.lives.players.*.eliminated',
		'lobby.game.pvp.referee.lives.players.*.events[].delta',
		'lobby.game.pvp.referee.lives.players.*.events[].key',
		'lobby.game.pvp.referee.lives.players.*.forfeited',
		'lobby.game.pvp.referee.lives.players.*.left',
		'lobby.game.pvp.referee.lives.players.*.lives',
		'lobby.game.pvp.referee.lives.runId',
		'lobby.game.pvp.referee.lives.teamLives.A',
		'lobby.game.pvp.referee.lives.teamLives.B',
		'lobby.game.pvp.referee.pairing.ante',
		'lobby.game.pvp.referee.pairing.lastBye',
		'lobby.game.pvp.referee.pairing.partners.*',
		'lobby.game.pvp.referee.pairing.usedPairs[]',
		'lobby.game.pvp.referee.result.kind',
		'lobby.game.pvp.referee.result.places[].place',
		'lobby.game.pvp.referee.result.places[].playerId',
		'lobby.game.pvp.referee.result.runId',
		'lobby.game.pvp.referee.result.winnerId',
		'lobby.game.pvp.referee.result.winnerTeam',
		'lobby.game.pvp.referee.round.lastResult.losers[]',
		'lobby.game.pvp.referee.round.lastResult.roundId',
		'lobby.game.pvp.referee.round.phase',
		'lobby.game.pvp.referee.round.players.*.ante',
		'lobby.game.pvp.referee.round.players.*.committedHands',
		'lobby.game.pvp.referee.round.players.*.creditedHands',
		'lobby.game.pvp.referee.round.players.*.furthestBlind',
		'lobby.game.pvp.referee.round.players.*.handsLeft',
		'lobby.game.pvp.referee.round.players.*.handsSpent',
		'lobby.game.pvp.referee.round.players.*.highestScore',
		'lobby.game.pvp.referee.round.players.*.pvpLeftMs',
		'lobby.game.pvp.referee.round.players.*.reportedApplied',
		'lobby.game.pvp.referee.round.players.*.reportedHands',
		'lobby.game.pvp.referee.round.players.*.score',
		'lobby.game.pvp.referee.round.players.*.timerLosses',
		'lobby.game.pvp.referee.round.roundId',
		'lobby.game.pvp.referee.round.runId',
		'lobby.game.pvp.referee.rules.clocks.ante',
		'lobby.game.pvp.referee.rules.clocks.personal.baseMs',
		'lobby.game.pvp.referee.rules.clocks.personal.graceMs',
		'lobby.game.pvp.referee.rules.clocks.personal.kind',
		'lobby.game.pvp.referee.rules.clocks.personal.previewCostMs',
		'lobby.game.pvp.referee.rules.clocks.personal.pvpMs',
		'lobby.game.pvp.referee.rules.clocks.personal.timedRate',
		'lobby.game.pvp.referee.rules.clocks.pvp.baseMs',
		'lobby.game.pvp.referee.rules.clocks.pvp.handMs',
		'lobby.game.pvp.referee.rules.deathOnRoundLoss',
		'lobby.game.pvp.referee.rules.hunterLives',
		'lobby.game.pvp.referee.rules.mode',
		'lobby.game.pvp.referee.rules.pvpStartAnte',
		'lobby.game.pvp.referee.rules.runId',
		'lobby.game.pvp.referee.rules.skipTimeRule',
		'lobby.game.pvp.referee.rules.startedCount',
		'lobby.game.pvp.referee.rules.startingLives',
		'lobby.game.pvp.referee.rules.timerBaseMs',
		'lobby.game.pvp.referee.rules.timerForgiveness',
		'lobby.game.pvp.referee.rules.timerIncrementMs',
		'lobby.game.pvp.referee.teams.runId',
		'lobby.game.pvp.referee.teams.teams.*',
		'lobby.game.pvp.referee.votes.draw[]',
		'lobby.game.pvp.referee.votes.runId',
		'lobby.game.pvp.referee.votes.seed[]',
		'lobby.game.pvp.round',
		'lobby.game.pvp.runId',
		'lobby.game.ready.*',
		'lobby.game.reportOrder[]',
		'lobby.game.reports.*[]',
		'lobby.game.resultPending',
		'lobby.game.resultWasPending',
		'lobby.game.runSaves.*.at',
		'lobby.game.runSaves.*.data',
		'lobby.game.runSaves.*.hash',
		'lobby.game.runSaves.*.id',
		'lobby.game.runSaves.*.pos',
		'lobby.game.settleFrom',
		'lobby.game.setup.open.banned[]',
		'lobby.game.setup.open.deadline',
		'lobby.game.setup.open.first',
		'lobby.game.setup.open.id',
		'lobby.game.setup.open.kind',
		'lobby.game.setup.open.options[]',
		'lobby.game.setup.open.order[]',
		'lobby.game.setup.open.pool[].key',
		'lobby.game.setup.open.pool[].stake',
		'lobby.game.setup.open.remaining',
		'lobby.game.setup.open.schedule[].action',
		'lobby.game.setup.open.schedule[].actor',
		'lobby.game.setup.open.schedule[].count',
		'lobby.game.setup.open.turn',
		'lobby.game.setup.open.turnMs',
		'lobby.game.setup.open.voters[]',
		'lobby.game.setup.open.votes.*',
		'lobby.game.setup.results.*.banned[]',
		'lobby.game.setup.results.*.counts.*',
		'lobby.game.setup.results.*.kind',
		'lobby.game.setup.results.*.option',
		'lobby.game.setup.results.*.survivors[].key',
		'lobby.game.setup.results.*.survivors[].stake',
		'lobby.game.started.hostId',
		'lobby.game.started.options',
		'lobby.game.started.players[].avatar',
		'lobby.game.started.players[].displayName',
		'lobby.game.started.players[].id',
		'lobby.game.started.raceStartedAt',
		'lobby.game.started.runId',
		'lobby.game.started.seed',
		'lobby.game.started.stake',
		'lobby.game.started.startedAt',
		'lobby.gameMode',
		'lobby.graceMs',
		'lobby.groupQueue.code',
		'lobby.groupQueue.matchId',
		'lobby.groupQueue.memberIds[]',
		'lobby.groupQueue.mode',
		'lobby.groupQueue.partyId',
		'lobby.groupQueue.phase',
		'lobby.groupQueue.since',
		'lobby.groupQueue.teams',
		'lobby.groupQueue.until',
		'lobby.groupsReleased',
		'lobby.groups[].homeCode',
		'lobby.groups[].memberIds[]',
		'lobby.groups[].partyId',
		'lobby.hostId',
		'lobby.kickedIds[]',
		'lobby.lastRunId',
		'lobby.maxPlayers',
		'lobby.metadata',
		'lobby.modId',
		'lobby.players[].awaySince',
		'lobby.players[].catchingUpSince',
		'lobby.players[].id',
		'lobby.players[].info.displayName',
		'lobby.players[].info.mods',
		'lobby.players[].info.preferredJoker',
		'lobby.players[].info.pvpVersion',
		'lobby.players[].ownState',
		'lobby.players[].sessionId',
		'lobby.rankedMode',
		'lobby.requiredStanding',
		'lobby.resultTimeoutMs',
		'lobby.rev',
		'lobby.spectators[]',
		'lobby.teamPicks.*',
		'lobby.teamPlan[][]',
		'schema',
	],
	3: [
		'at',
		'claimedAt',
		'expiresAt',
		'lobby.actionBudget.*.at',
		'lobby.actionBudget.*.tokens',
		'lobby.allowedIds[]',
		'lobby.catchUpLimitMs',
		'lobby.chat[].at',
		'lobby.chat[].displayName',
		'lobby.chat[].senderId',
		'lobby.chat[].text',
		'lobby.closed',
		'lobby.code',
		'lobby.connSeq',
		'lobby.createdAt',
		'lobby.creatorId',
		'lobby.forfeitedSeats.*',
		'lobby.game.contest.against',
		'lobby.game.contest.at',
		'lobby.game.contest.by',
		'lobby.game.logs.*.ahead',
		'lobby.game.logs.*.bytes',
		'lobby.game.logs.*.lines[]',
		'lobby.game.logs.*.seq',
		'lobby.game.logs.*.truncated',
		'lobby.game.presence[].at',
		'lobby.game.presence[].by',
		'lobby.game.presence[].kind',
		'lobby.game.presence[].reason',
		'lobby.game.presence[].userId',
		'lobby.game.pvp.blindKeys.*',
		'lobby.game.pvp.firstReady',
		'lobby.game.pvp.lastStart.blindKeys.*',
		'lobby.game.pvp.lastStart.firstPlayer',
		'lobby.game.pvp.lastStart.players[]',
		'lobby.game.pvp.lastStart.roundId',
		'lobby.game.pvp.order[]',
		'lobby.game.pvp.readied[]',
		'lobby.game.pvp.ready.*',
		'lobby.game.pvp.referee.cardTargets.ante',
		'lobby.game.pvp.referee.cardTargets.targets.*',
		'lobby.game.pvp.referee.facts.animating[]',
		'lobby.game.pvp.referee.facts.anteSeen',
		'lobby.game.pvp.referee.facts.applied',
		'lobby.game.pvp.referee.facts.blinds.*.*.beaten',
		'lobby.game.pvp.referee.facts.blinds.*.*.roundLost',
		'lobby.game.pvp.referee.facts.clocks.*.graceUntil',
		'lobby.game.pvp.referee.facts.clocks.*.ms',
		'lobby.game.pvp.referee.facts.clocks.*.n',
		'lobby.game.pvp.referee.facts.clocks.*.rate',
		'lobby.game.pvp.referee.facts.clocks.*.running',
		'lobby.game.pvp.referee.facts.clocks.*.since',
		'lobby.game.pvp.referee.facts.clocks.*.spent',
		'lobby.game.pvp.referee.facts.deadline.against[]',
		'lobby.game.pvp.referee.facts.deadline.by',
		'lobby.game.pvp.referee.facts.deadline.endsAt',
		'lobby.game.pvp.referee.facts.deadline.kind',
		'lobby.game.pvp.referee.facts.deadline.n',
		'lobby.game.pvp.referee.facts.deadline.pausedMs',
		'lobby.game.pvp.referee.facts.deadline.shownMs',
		'lobby.game.pvp.referee.facts.deaths[].blindKey',
		'lobby.game.pvp.referee.facts.deaths[].outBefore.*',
		'lobby.game.pvp.referee.facts.deaths[].playerId',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[]',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[].amount',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[].from',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[].kind',
		'lobby.game.pvp.referee.facts.effects.players.*.incoming[].n',
		'lobby.game.pvp.referee.facts.forgiven.*',
		'lobby.game.pvp.referee.facts.guarded.*[]',
		'lobby.game.pvp.referee.facts.handRound.*',
		'lobby.game.pvp.referee.facts.log[].beaten',
		'lobby.game.pvp.referee.facts.log[].blindKey',
		'lobby.game.pvp.referee.facts.log[].hands',
		'lobby.game.pvp.referee.facts.log[].kind',
		'lobby.game.pvp.referee.facts.log[].playerId',
		'lobby.game.pvp.referee.facts.log[].roundLost',
		'lobby.game.pvp.referee.facts.log[].type',
		'lobby.game.pvp.referee.facts.log[].voucherKey',
		'lobby.game.pvp.referee.facts.nemesis.*.*.each[]',
		'lobby.game.pvp.referee.facts.nemesis.*.*.one',
		'lobby.game.pvp.referee.facts.opponent.players.*.closed',
		'lobby.game.pvp.referee.facts.opponent.players.*.sells',
		'lobby.game.pvp.referee.facts.opponent.players.*.sells.*',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[]',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[].ante',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[].refused',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[].skipped',
		'lobby.game.pvp.referee.facts.opponent.players.*.slots[].spent',
		'lobby.game.pvp.referee.facts.pvpBlinds.*[]',
		'lobby.game.pvp.referee.facts.server.players.*.seenAnte',
		'lobby.game.pvp.referee.facts.skips.*.facing',
		'lobby.game.pvp.referee.facts.skips.*.skips',
		'lobby.game.pvp.referee.facts.skips.*.skipsAtPvp',
		'lobby.game.pvp.referee.facts.skips.*.spentMs',
		'lobby.game.pvp.referee.facts.skipsSeen.*.rival',
		'lobby.game.pvp.referee.facts.skipsSeen.*.skips',
		'lobby.game.pvp.referee.facts.timerN',
		'lobby.game.pvp.referee.facts.traps.trapSeq',
		'lobby.game.pvp.referee.facts.traps.traps[].holder',
		'lobby.game.pvp.referee.facts.traps.traps[].id',
		'lobby.game.pvp.referee.facts.traps.traps[].key',
		'lobby.game.pvp.referee.facts.traps.traps[].owner',
		'lobby.game.pvp.referee.facts.traps.traps[].state',
		'lobby.game.pvp.referee.facts.traps.traps[].state.fired.bounced',
		'lobby.game.pvp.referee.lives.pending[].blindKey',
		'lobby.game.pvp.referee.lives.pending[].playerId',
		'lobby.game.pvp.referee.lives.pending[].waitsOn[]',
		'lobby.game.pvp.referee.lives.players.*.eliminated',
		'lobby.game.pvp.referee.lives.players.*.events[].delta',
		'lobby.game.pvp.referee.lives.players.*.events[].key',
		'lobby.game.pvp.referee.lives.players.*.forfeited',
		'lobby.game.pvp.referee.lives.players.*.left',
		'lobby.game.pvp.referee.lives.players.*.lives',
		'lobby.game.pvp.referee.lives.runId',
		'lobby.game.pvp.referee.lives.teamLives.A',
		'lobby.game.pvp.referee.lives.teamLives.B',
		'lobby.game.pvp.referee.pairing.ante',
		'lobby.game.pvp.referee.pairing.lastBye',
		'lobby.game.pvp.referee.pairing.partners.*',
		'lobby.game.pvp.referee.pairing.usedPairs[]',
		'lobby.game.pvp.referee.result.kind',
		'lobby.game.pvp.referee.result.places[].place',
		'lobby.game.pvp.referee.result.places[].playerId',
		'lobby.game.pvp.referee.result.runId',
		'lobby.game.pvp.referee.result.winnerId',
		'lobby.game.pvp.referee.result.winnerTeam',
		'lobby.game.pvp.referee.round.lastResult.losers[]',
		'lobby.game.pvp.referee.round.lastResult.roundId',
		'lobby.game.pvp.referee.round.phase',
		'lobby.game.pvp.referee.round.players.*.ante',
		'lobby.game.pvp.referee.round.players.*.committedHands',
		'lobby.game.pvp.referee.round.players.*.creditedHands',
		'lobby.game.pvp.referee.round.players.*.furthestBlind',
		'lobby.game.pvp.referee.round.players.*.handsLeft',
		'lobby.game.pvp.referee.round.players.*.handsSpent',
		'lobby.game.pvp.referee.round.players.*.highestScore',
		'lobby.game.pvp.referee.round.players.*.pvpLeftMs',
		'lobby.game.pvp.referee.round.players.*.reportedApplied',
		'lobby.game.pvp.referee.round.players.*.reportedHands',
		'lobby.game.pvp.referee.round.players.*.score',
		'lobby.game.pvp.referee.round.players.*.timerLosses',
		'lobby.game.pvp.referee.round.roundId',
		'lobby.game.pvp.referee.round.runId',
		'lobby.game.pvp.referee.rules.clocks.ante',
		'lobby.game.pvp.referee.rules.clocks.personal.baseMs',
		'lobby.game.pvp.referee.rules.clocks.personal.graceMs',
		'lobby.game.pvp.referee.rules.clocks.personal.kind',
		'lobby.game.pvp.referee.rules.clocks.personal.previewCostMs',
		'lobby.game.pvp.referee.rules.clocks.personal.pvpMs',
		'lobby.game.pvp.referee.rules.clocks.personal.timedRate',
		'lobby.game.pvp.referee.rules.clocks.pvp.baseMs',
		'lobby.game.pvp.referee.rules.clocks.pvp.handMs',
		'lobby.game.pvp.referee.rules.deathOnRoundLoss',
		'lobby.game.pvp.referee.rules.hunterLives',
		'lobby.game.pvp.referee.rules.mode',
		'lobby.game.pvp.referee.rules.pvpStartAnte',
		'lobby.game.pvp.referee.rules.runId',
		'lobby.game.pvp.referee.rules.skipTimeRule',
		'lobby.game.pvp.referee.rules.startedCount',
		'lobby.game.pvp.referee.rules.startingLives',
		'lobby.game.pvp.referee.rules.timerBaseMs',
		'lobby.game.pvp.referee.rules.timerForgiveness',
		'lobby.game.pvp.referee.rules.timerIncrementMs',
		'lobby.game.pvp.referee.teams.runId',
		'lobby.game.pvp.referee.teams.teams.*',
		'lobby.game.pvp.referee.votes.draw[]',
		'lobby.game.pvp.referee.votes.runId',
		'lobby.game.pvp.referee.votes.seed[]',
		'lobby.game.pvp.round',
		'lobby.game.pvp.runId',
		'lobby.game.ready.*',
		'lobby.game.reportOrder[]',
		'lobby.game.reports.*[]',
		'lobby.game.resultPending',
		'lobby.game.resultWasPending',
		'lobby.game.runSaves.*.at',
		'lobby.game.runSaves.*.data',
		'lobby.game.runSaves.*.hash',
		'lobby.game.runSaves.*.id',
		'lobby.game.runSaves.*.pos',
		'lobby.game.settleFrom',
		'lobby.game.setup.open.banned[]',
		'lobby.game.setup.open.deadline',
		'lobby.game.setup.open.first',
		'lobby.game.setup.open.id',
		'lobby.game.setup.open.kind',
		'lobby.game.setup.open.options[]',
		'lobby.game.setup.open.order[]',
		'lobby.game.setup.open.pool[].key',
		'lobby.game.setup.open.pool[].stake',
		'lobby.game.setup.open.remaining',
		'lobby.game.setup.open.schedule[].action',
		'lobby.game.setup.open.schedule[].actor',
		'lobby.game.setup.open.schedule[].count',
		'lobby.game.setup.open.turn',
		'lobby.game.setup.open.turnMs',
		'lobby.game.setup.open.voters[]',
		'lobby.game.setup.open.votes.*',
		'lobby.game.setup.results.*.banned[]',
		'lobby.game.setup.results.*.counts.*',
		'lobby.game.setup.results.*.kind',
		'lobby.game.setup.results.*.option',
		'lobby.game.setup.results.*.survivors[].key',
		'lobby.game.setup.results.*.survivors[].stake',
		'lobby.game.started.hostId',
		'lobby.game.started.options',
		'lobby.game.started.players[].avatar',
		'lobby.game.started.players[].displayName',
		'lobby.game.started.players[].id',
		'lobby.game.started.raceStartedAt',
		'lobby.game.started.runId',
		'lobby.game.started.seed',
		'lobby.game.started.stake',
		'lobby.game.started.startedAt',
		'lobby.gameMode',
		'lobby.graceMs',
		'lobby.groupQueue.code',
		'lobby.groupQueue.matchId',
		'lobby.groupQueue.memberIds[]',
		'lobby.groupQueue.mode',
		'lobby.groupQueue.partyId',
		'lobby.groupQueue.phase',
		'lobby.groupQueue.since',
		'lobby.groupQueue.teams',
		'lobby.groupQueue.until',
		'lobby.groupsReleased',
		'lobby.groups[].homeCode',
		'lobby.groups[].memberIds[]',
		'lobby.groups[].partyId',
		'lobby.hostId',
		'lobby.kickedIds[]',
		'lobby.lastRunId',
		'lobby.maxPlayers',
		'lobby.metadata',
		'lobby.modId',
		'lobby.players[].awaySince',
		'lobby.players[].catchingUpSince',
		'lobby.players[].id',
		'lobby.players[].info.displayName',
		'lobby.players[].info.mods',
		'lobby.players[].info.preferredJoker',
		'lobby.players[].info.pvpVersion',
		'lobby.players[].ownState',
		'lobby.players[].sessionId',
		'lobby.rankedMode',
		'lobby.requiredStanding',
		'lobby.resultTimeoutMs',
		'lobby.rev',
		'lobby.spectators[]',
		'lobby.teamPicks.*',
		'lobby.teamPlan[][]',
		'schema',
	],

}

describe('the checkpoint schema', () => {
	const shapeNow = () =>
		uniqueSorted([
			...keyPaths(checkpointOf(populatedPvpLobby(), 50_000)),
			...keyPaths(checkpointOf(populatedPvpLobby({ paused: true }), 50_000)),
			...keyPaths(checkpointOf(populatedPvpLobby({ draft: true }), 50_000)),
		])

	it('drift: the key paths of a populated checkpoint are the list kept next to CHECKPOINT_SCHEMA', () => {
		expect(shapeNow()).toEqual(SHAPES[CHECKPOINT_SCHEMA])
	})

	it('a checkpoint is written with the current schema and an expiry', () => {
		const cp = checkpointed(populatedPvpLobby(), 50_000)
		expect(cp.schema).toBe(CHECKPOINT_SCHEMA)
		expect(cp.expiresAt).toBe(50_000 + CHECKPOINT_TTL_MS)
	})

	// A checkpoint written by an earlier build, as storage returns it.
	const stored = (nk: nkruntime.Nakama, value: { [key: string]: unknown }) =>
		nk.storageWrite([{ collection: 'lobby_checkpoints', key: 'ABC123', userId: SYSTEM_USER_ID, permissionRead: 0, permissionWrite: 0, value }])

	function counted() {
		const made = nakama()
		let created = 0
		const create = made.nk.matchCreate
		made.nk.matchCreate = (...args: unknown[]) => {
			created++
			return create(...args)
		}
		return { ...made, created: () => created }
	}

	it.each<[string, (cp: Checkpoint) => { [key: string]: unknown }]>([
		['with no schema', ({ schema: _s, ...rest }) => rest],
		['with another schema', (cp) => ({ ...cp, schema: CHECKPOINT_SCHEMA + 1 })],
		['of schema 1 (before the opponent facts)', (cp) => ({ ...cp, schema: 1 })],
		['with a schema that is not a number', (cp) => ({ ...cp, schema: String(CHECKPOINT_SCHEMA) })],
	])('resumeLobby deletes a checkpoint %s and creates no match', (_name, make) => {
		const { nk, created } = counted()
		stored(nk, make(stamped(startedLobby(), Date.now())))
		expect(resumeLobby(nk, fakeLogger, 'ABC123', Date.now())).toEqual({ kind: 'none' })
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
		expect(created()).toBe(0)
	})

	// A run frozen before an unknown queue_mode was refused held mode 'standard'; this
	// build cannot produce it, so the checkpoint is gone at restore like another schema.
	it('resumeLobby deletes a checkpoint whose frozen referee holds the retired mode standard', () => {
		const lobby = populatedPvpLobby()
		const referee = refereeOf(lobby)
		if (!referee) throw new Error('the fixture has a referee')
		const frozen = {
			...referee,
			rules: { ...referee.rules, mode: 'standard' } as unknown as typeof referee.rules,
		}
		const { nk, created } = counted()
		stored(nk, { ...stamped(withReferee(lobby, frozen), Date.now()) })
		expect(resumeLobby(nk, fakeLogger, 'ABC123', Date.now())).toEqual({ kind: 'none' })
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
		expect(created()).toBe(0)
	})

	it.each<[string, (cp: Checkpoint) => { [key: string]: unknown }]>([
		['no expiresAt', ({ expiresAt: _e, ...rest }) => rest],
		['an expiresAt that is not a number', (cp) => ({ ...cp, expiresAt: String(cp.expiresAt) })],
	])('resumeLobby deletes a current-schema checkpoint with %s', (_name, make) => {
		const { nk, created } = counted()
		stored(nk, make(stamped(startedLobby(), Date.now())))
		expect(resumeLobby(nk, fakeLogger, 'ABC123', Date.now())).toEqual({ kind: 'none' })
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
		expect(created()).toBe(0)
	})

	it('a checkpoint with no numeric expiresAt does not hold its code', () => {
		const { nk } = nakama()
		const { expiresAt: _e, ...unstamped } = stamped(startedLobby(), Date.now())
		stored(nk, unstamped)
		expect(reserveCode(nk, 'ABC123', 'M')).toBe(true)
	})

	it('a checkpoint of the current schema still resumes', () => {
		const { nk, created } = counted()
		bindCode(nk, 'ABC123', 'gone', 'M')
		saveCheckpoint(nk, stamped(startedLobby(), Date.now()))
		expect(resumeLobby(nk, fakeLogger, 'ABC123', Date.now())).toEqual({ kind: 'resumed', matchId: 'm1', modId: 'M' })
		expect(created()).toBe(1)
	})

	it('a checkpoint that cannot be resumed from is deleted and logged', () => {
		const { nk } = nakama()
		saveCheckpoint(nk, stamped({ ...startedLobby(), players: null as never }, Date.now()))
		const errors: unknown[][] = []
		const logger = { ...fakeLogger, error: (...args: unknown[]) => errors.push(args) } as unknown as nkruntime.Logger
		expect(resumeLobby(nk, logger, 'ABC123', Date.now())).toEqual({ kind: 'none' })
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
		expect(lookupCode(nk, 'ABC123')).toBeNull()
		expect(errors.length).toBe(1)
		expect(errors[0].slice(0, 2)).toEqual(['Lobby %s could not resume from its checkpoint: %s', 'ABC123'])
	})

	it('a match that fails to start for another reason keeps the checkpoint, releases the claim and logs it', () => {
		const { nk } = nakama()
		saveCheckpoint(nk, stamped(startedLobby(), Date.now()))
		const create = nk.matchCreate
		nk.matchCreate = () => {
			throw new Error('runtime busy')
		}
		const errors: unknown[][] = []
		const logger = { ...fakeLogger, error: (...args: unknown[]) => errors.push(args) } as unknown as nkruntime.Logger
		expect(resumeLobby(nk, logger, 'ABC123', Date.now())).toEqual({ kind: 'resuming' })
		const kept = readCheckpoint(nk, 'ABC123')
		expect(kept?.checkpoint.claimedAt).toBeNull()
		expect(kept?.checkpoint.lobby.players.map((p) => p.id)).toEqual(['a', 'b'])
		expect(lookupCode(nk, 'ABC123')).toBeNull()
		expect(errors).toEqual([['Lobby %s could not resume from its checkpoint: %s', 'ABC123', 'Error: runtime busy']])
		// The next rejoin tries again and gets the lobby back.
		nk.matchCreate = create
		expect(resumeLobby(nk, fakeLogger, 'ABC123', Date.now()).kind).toBe('resumed')
		expect(readCheckpoint(nk, 'ABC123')).toBeNull()
	})

	it('a resume whose checkpoint is gone refuses to start instead of making a blank lobby', () => {
		const { nk } = nakama()
		expect(() => lobbyMatchInit(playerCtx(''), fakeLogger, nk, { resumeCode: 'ABC123' })).toThrow('Lobby ABC123 has no checkpoint to resume from')
	})
})
