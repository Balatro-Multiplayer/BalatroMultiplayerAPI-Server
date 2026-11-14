import { describe, expect, it } from 'vitest'
import { SETUP_ACTIONS, setupOf, setupTick } from '../../actions/setup'
import { PVP_MOD_ID } from '../../standing/pvp_version'
import { withRules } from '../../testing/pvp_rules'
import { testContext } from '../../testing/request_context'
import { ServerOp } from '../protocol'
import { action } from '../relay'
import { type Lobby, type Outbound, type Step, disconnect, join, leave, newLobby, setMetadata, snapshotFor, tick } from '../state'
import { frozenState } from './freeze_env'
import { PVP_REQUESTS } from './register'
import { pvpTick } from './referee'
import { type RefereeState, refereeOf, withReferee } from './state'

// The server owns "Setup finished": the race start is stamped, and the rules freeze,
// only once Setup is over (docs/pvp-match.md sections 4 and 7).

const info = (name: string) => ({ displayName: name, preferredJoker: null, mods: null })
const decks = (...keys: string[]) => keys.map((key) => ({ key }))

function send(lobby: Lobby, from: string, key: string, params: unknown = {}, now = 1000): Step {
	return action(
		lobby,
		from,
		{ cid: `${key}-${from}`, action: key, to: 'server', params },
		{ now, newSeed: () => 'SEED1234', newId: () => 'RUN1', random: () => 0 },
	)
}

type Send = Extract<Outbound, { kind: 'send' }>
const rejection = (step: Step): string | undefined => {
	const r = step.out.find((o): o is Send => o.kind === 'send' && o.op === ServerOp.ACTION_REJECTED)
	return r && (r.payload as { reason: string }).reason
}
const records = (out: Outbound[]) => out.filter((o) => o.kind === 'forfeited' || o.kind === 'dodged')

// A started PvP game of two (a hosts), ranked or casual, nothing played, nothing opened.
function game(ranked: boolean): Lobby {
	let lobby = newLobby({
		code: 'ABCDE',
		modId: PVP_MOD_ID,
		maxPlayers: 2,
		creatorId: 'a',
		now: 0,
		graceMs: 10_000,
		gameMode: ranked ? 'duel' : undefined,
	})
	for (const id of ['a', 'b']) lobby = join(lobby, id, `${id}-s`, info(id)).lobby
	const players = ['a', 'b'].map((id) => ({ id, displayName: id }))
	const started = { runId: 'r1', hostId: 'a', players } as never
	return {
		...lobby,
		rankedMode: ranked ? 'duel' : undefined,
		metadata: withRules({ ruleset: 'ruleset_mp_balanced' }),
		game: { ...lobby.game, started },
	}
}

const logEvent = (lobby: Lobby, now: number): Lobby =>
	send(lobby, 'a', 'mpapi_log_event', { t: 0, opcode: 'x', run: 'r1' }, now).lobby
const racedAt = (lobby: Lobby): number | undefined => lobby.game.started?.raceStartedAt
const openDraft = (lobby: Lobby, now = 100): Lobby => {
	const step = send(lobby, 'a', 'mpapi_setup_draft', { id: 'draft', candidates: decks('x', 'y', 'z') }, now)
	expect(rejection(step)).toBeUndefined()
	return step.lobby
}

describe('a ranked game stamps the race only once the Draft result exists', () => {
	it('a log event before the Draft opens stamps nothing, so a leave during the Draft is a dodge', () => {
		let lobby = logEvent(game(true), 50)
		expect(racedAt(lobby)).toBeUndefined()
		lobby = openDraft(lobby)
		const left = leave(lobby, 'b', 600).lobby
		const refereed = pvpTick(tick(left, 700).lobby, testContext(700))
		expect(records(refereed.out).map((o) => o.kind)).toEqual(['dodged'])
		expect(refereed.lobby.game.started).toBeNull()
	})

	it('a disconnect during the Draft, after such a log event, is a dodge and not a forfeit', () => {
		const lobby = openDraft(logEvent(game(true), 50))
		const away = disconnect(lobby, 'b', 'b-s', 200).lobby
		const expired = tick(away, 10_200)
		const refereed = pvpTick(expired.lobby, testContext(10_200))
		expect(records([...expired.out, ...refereed.out]).map((o) => o.kind)).toEqual(['dodged'])
	})

	it('a log event in the gap between Setup steps stamps nothing', () => {
		const lobby = game(true)
		const vote = { kind: 'vote', option: 'balanced', counts: {} } as never
		const between = { ...lobby, game: { ...lobby.game, setup: { open: null, results: { ruleset: vote } } } }
		expect(racedAt(logEvent(between, 3000))).toBeUndefined()
	})

	it('the Draft always completes by its own timeouts, and a stamp follows', () => {
		let lobby = openDraft(game(true))
		for (let now = 200; setupOf(lobby.game).open && now < 10_000_000; now += 60_000)
			lobby = setupTick(lobby, now, () => 0).lobby
		const setup = setupOf(lobby.game)
		expect(setup.open).toBeNull()
		expect(setup.results.draft).toMatchObject({ kind: 'draft' })
		expect(racedAt(logEvent(lobby, 20_000_000))).toBe(20_000_000)
	})

	it('a game of two with the Draft done stamps on the first event', () => {
		const done = send(game(true), 'a', 'mpapi_setup_draft', { id: 'draft', candidates: decks('x'), keep: 1 }).lobby
		expect(setupOf(done.game).results.draft).toBeDefined()
		expect(racedAt(logEvent(done, 900))).toBe(900)
	})

	it('a casual game of another shape is not held by the Draft rule', () => {
		expect(racedAt(logEvent(game(false), 900))).toBe(900)
	})
})

describe('a casual ruleset vote that has closed but is not published yet', () => {
	const closedVote = (): Lobby => {
		const lobby = game(false)
		const vote = { kind: 'vote', option: 'majorleague', counts: {} } as never
		return { ...lobby, game: { ...lobby.game, setup: { open: null, results: { ruleset: vote } } } }
	}
	const progress = (lobby: Lobby) =>
		PVP_REQUESTS['pvp.progress'].reduce(lobby, 'a', { runId: 'r1', ante: 3, furthestBlind: 30 }, testContext(1000))

	it('refuses a freezing request and stamps nothing until the host has written the ruleset', () => {
		const lobby = closedVote()
		const refused = progress(lobby)
		expect(refused.ok).toBe(false)
		if (!refused.ok) expect(refused.reason).toBe('setup_open')
		expect(racedAt(logEvent(lobby, 2000))).toBeUndefined()
		const published = setMetadata(lobby, 'a', { ruleset: 'ruleset_mp_majorleague' })
		const lobbyAfter = published.lobby
		expect(lobbyAfter.metadata.ruleset).toBe('ruleset_mp_majorleague')
		expect(progress(lobbyAfter).ok).toBe(true)
		expect(racedAt(logEvent(lobbyAfter, 4000))).toBe(4000)
	})
})

describe('a Setup step cannot be opened once the run began', () => {
	const frozen = (lobby: Lobby): Lobby => {
		const result = frozenState(lobby, refereeOf(lobby) as RefereeState, testContext(0))
		if (!result.ok) throw new Error(`rules did not freeze: ${result.key}`)
		return withReferee(lobby, result.state)
	}
	const vote = (lobby: Lobby) =>
		send(lobby, 'a', 'mpapi_setup_vote', { id: 'grief', options: ['x', 'y'], seconds: 120 }, 5000)

	it('a step opened after the rules froze holds nothing: the opponent still gets their request through', () => {
		const lobby = frozen(game(false))
		const opened = vote(lobby)
		expect(rejection(opened)).toBeUndefined()
		expect(setupOf(opened.lobby.game).open).not.toBeNull()
		const answer = PVP_REQUESTS['pvp.progress'].reduce(opened.lobby, 'b', { runId: 'r1', ante: 2, furthestBlind: 20 }, testContext(5000))
		expect(answer.ok).toBe(true)
	})

	it('a casual Draft still opens after a freezing request came between the vote and the Draft', () => {
		const lobby = game(false)
		const published = { kind: 'vote', option: 'balanced', counts: {} } as never
		const voted = { ...lobby, game: { ...lobby.game, setup: { open: null, results: { ruleset: published } } } }
		const froze = PVP_REQUESTS['pvp.progress'].reduce(voted, 'a', { runId: 'r1', ante: 1, furthestBlind: 10 }, testContext(1000))
		expect(froze.ok).toBe(true)
		const after = frozen(voted)
		const step = send(after, 'a', 'mpapi_setup_draft', { id: 'draft', candidates: decks('x', 'y') }, 2000)
		expect(rejection(step)).toBeUndefined()
		expect(setupOf(step.lobby.game).open).not.toBeNull()
	})

	it('refuses a draft or a vote after the race began', () => {
		const lobby = logEvent(game(false), 900)
		expect(racedAt(lobby)).toBe(900)
		expect(rejection(vote(lobby))).toBe('run_started')
		expect(
			rejection(send(lobby, 'a', 'mpapi_setup_draft', { id: 'draft', candidates: decks('x', 'y') }, 5000)),
		).toBe('run_started')
	})

	it('still opens a step before the run (the control)', () => {
		expect(rejection(vote(game(false)))).toBeUndefined()
		expect(SETUP_ACTIONS.length).toBeGreaterThan(0)
	})
})

describe('the snapshot view of a started game', () => {
	it('does not carry the server-only restart flag', () => {
		const lobby = game(true)
		const restarted = { ...lobby, game: { ...lobby.game, started: { ...(lobby.game.started as object), restarted: true } as never } }
		const view = snapshotFor(restarted, 'a', 1000).game.started
		expect(view).not.toBeNull()
		expect(Object.keys(view as object)).not.toContain('restarted')
	})
})

describe('a seat that was away when the game ended is told how it ended', () => {
	const dodgedWhileAway = () => {
		const lobby = openDraft(logEvent(game(true), 50))
		const away = disconnect(lobby, 'b', 'b-s', 200).lobby
		const expired = tick(away, 10_200)
		return pvpTick(expired.lobby, testContext(10_200))
	}

	it('the away seat gets the end the stayer received, in its next snapshot', () => {
		const refereed = dodgedWhileAway()
		const gameEnded = refereed.out.find(
			(o): o is Send => o.kind === 'send' && (o.payload as { type?: string }).type === 'game_ended',
		)
		const sent = (gameEnded?.payload as { data: { runId: string; status: string } }).data
		expect(sent.status).toBe('dodged')
		expect(snapshotFor(refereed.lobby, 'b', 20_000).game.lastEnded).toEqual({ runId: sent.runId, status: 'dodged' })
	})

	it('a seat still inside its grace when the game ends is told too', () => {
		const away = disconnect(openDraft(logEvent(game(true), 50)), 'b', 'b-s', 200).lobby
		// The other player leaves the Draft: the game ends with b still seated, away.
		const left = pvpTick(leave(away, 'a', 300).lobby, testContext(300))
		const seat = left.lobby.players.find((p) => p.id === 'b')
		expect(seat?.awaySince).not.toBeNull()
		expect(left.lobby.game.started).toBeNull()
		expect(snapshotFor(left.lobby, 'b', 400).game.lastEnded).toEqual({ runId: 'r1', status: 'dodged' })
	})

	it('the seat that was present has nothing to catch up on, and the next game clears it', () => {
		const refereed = dodgedWhileAway()
		expect(snapshotFor(refereed.lobby, 'a', 20_000).game.lastEnded).toBeNull()
		// b comes back as a new seat: still told, until the host starts the next game.
		const back = join(refereed.lobby, 'b', 'b-s2', info('b'), 20_500).lobby
		expect(snapshotFor(back, 'b', 21_000).game.lastEnded).toMatchObject({ status: 'dodged' })
		const readied = { ...back, game: { ...back.game, ready: { a: true, b: true } } }
		const started = send(readied, 'a', 'mpapi_start_game', {}, 30_000)
		expect(rejection(started)).toBeUndefined()
		expect(snapshotFor(started.lobby, 'b', 30_000).game.lastEnded).toBeNull()
	})
})
