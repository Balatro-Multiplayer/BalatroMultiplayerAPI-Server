// Setup (ADR 0003): the Draft and the votes a game runs before its run. The
// host starts each step; the server holds it, checks every ban, pick and vote,
// does every roll and closes a step whose time is up (setupTick). Which step
// comes next is the mods' business: they read the results.
//
// A Draft is MPAPI's ban-pick (BalatroMultiplayerAPI api/ban_pick.lua): a
// pool sampled from the host's candidates, banned down turn by turn until the
// kept tiles are left, or until a pick names the one kept tile.
//
// Pure, like registry.ts: randomness comes in through `random`.
import type {
	DraftResult,
	DraftTurn,
	GameState,
	OpenDraft,
	OpenVote,
	SetupItem,
	SetupState,
	SetupView,
	VoteResult,
} from '../lobby/protocol'
import { BROADCAST_TARGET, SERVER_TARGET, ServerOp } from '../lobby/protocol'
import type { Lobby, Step } from '../lobby/state'
import type { ActionContext, AuthoritativeAction, Reduction } from './registry'
import { draftFirstIndex } from '../tournament/lobby_draft'

export const STEP_ID_PATTERN = /^[a-z0-9_]{1,32}$/
export const MAX_CANDIDATES = 64
export const MAX_SCHEDULE_TURNS = 64
export const MAX_STAKE = 32
export const MAX_VOTE_OPTIONS = 8
export const DEFAULT_TURN_SECONDS = 30
export const DEFAULT_VOTE_SECONDS = 15
const MIN_STEP_SECONDS = 5
const MAX_STEP_SECONDS = 120

// The key a server-initiated Setup change (a timeout, a closed vote) is
// broadcast under. No client may send it.
export const SETUP_STATE_KEY = 'mpapi_setup_state'

export function emptySetup(): SetupState {
	return { open: null, results: {} }
}

export function setupOf(game: GameState): SetupState {
	return game.setup || emptySetup()
}

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWhole(value: unknown, min: number, max: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= min &&
		value <= max
	)
}

function shuffled<T>(items: T[], random: () => number): T[] {
	const out = items.slice()
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1))
		const swap = out[i]
		out[i] = out[j]
		out[j] = swap
	}
	return out
}

function pickIndex(length: number, random: () => number): number {
	return Math.min(length - 1, Math.floor(random() * length))
}

// The participants still seated, in start order.
function seatedParticipants(lobby: Lobby): string[] {
	const started = lobby.game.started
	if (!started) return []
	const seated: { [id: string]: boolean } = {}
	for (const p of lobby.players) seated[p.id] = true
	return started.players.filter((p) => seated[p.id]).map((p) => p.id)
}

function connected(lobby: Lobby, userId: string): boolean {
	return lobby.players.some((p) => p.id === userId && p.awaySince === null)
}

// ── Views ─────────────────────────────────────────────────────────────────────

export function draftActor(draft: OpenDraft): string | null {
	const turn = draft.schedule[draft.turn]
	if (!turn || draft.order.length === 0) return null
	return draft.order[(draft.first + turn.actor - 1) % draft.order.length]
}

export function setupView(setup: SetupState, now: number): SetupView {
	const open = setup.open
	if (!open) return { open: null, results: setup.results }
	const msLeft = Math.max(0, open.deadline - now)
	if (open.kind === 'vote') {
		const { votes, deadline: _deadline, ...rest } = open
		return {
			open: { ...rest, voted: Object.keys(votes), msLeft },
			results: setup.results,
		}
	}
	const { turnMs: _turnMs, deadline: _deadline, ...rest } = open
	return {
		open: { ...rest, actor: draftActor(open), msLeft },
		results: setup.results,
	}
}

// ── Draft rules ───────────────────────────────────────────────────────────────

// Single bans rotating through every actor until `keep` tiles are left.
export function deriveSchedule(
	poolSize: number,
	keep: number,
	actors: number,
): DraftTurn[] {
	const turns: DraftTurn[] = []
	for (let i = 0; i < poolSize - keep; i++) {
		turns.push({ actor: (i % actors) + 1, action: 'ban', count: 1 })
	}
	return turns
}

function finishDraft(
	game: GameState,
	draft: OpenDraft,
	survivors: SetupItem[],
): GameState {
	const setup = setupOf(game)
	const result: DraftResult = { kind: 'draft', survivors, banned: draft.banned }
	const started = game.started
	// One kept tile with a stake is the run's stake: a restart keeps it.
	const keptStake = survivors.length === 1 ? survivors[0].stake : undefined
	return {
		...game,
		started:
			started && typeof keptStake === 'number'
				? { ...started, stake: keptStake }
				: started,
		setup: { open: null, results: { ...setup.results, [draft.id]: result } },
	}
}

// The Draft past its current turn: the next turn starts its clock, or, past
// the last, the Draft finishes with every tile not banned.
function advanceDraft(
	game: GameState,
	draft: OpenDraft,
	now: number,
): GameState {
	const turn = draft.turn + 1
	const next = draft.schedule[turn]
	if (!next) {
		const banned: { [key: string]: boolean } = {}
		for (const key of draft.banned) banned[key] = true
		return finishDraft(
			game,
			draft,
			draft.pool.filter((item) => !banned[item.key]),
		)
	}
	const advanced: OpenDraft = {
		...draft,
		turn,
		remaining: next.count,
		deadline: now + draft.turnMs,
	}
	return { ...game, setup: { ...setupOf(game), open: advanced } }
}

// The current actor's ban or pick of `key`; null when it isn't allowed.
function chooseTile(
	game: GameState,
	draft: OpenDraft,
	key: string,
	now: number,
): GameState | null {
	const item = draft.pool.find((i) => i.key === key)
	if (!item || draft.banned.indexOf(key) !== -1) return null
	const turn = draft.schedule[draft.turn]
	if (turn.action === 'pick') return finishDraft(game, { ...draft }, [item])
	const banned: OpenDraft = {
		...draft,
		banned: draft.banned.concat([key]),
		remaining: draft.remaining - 1,
	}
	if (banned.remaining > 0) {
		return { ...game, setup: { ...setupOf(game), open: banned } }
	}
	return advanceDraft(game, banned, now)
}

// A turn whose time ran out: random bans for what it still needs, or a random
// pick.
function timeOutTurn(
	game: GameState,
	draft: OpenDraft,
	now: number,
	random: () => number,
): GameState {
	let current = game
	let open: OpenDraft | OpenVote | null = draft
	const turn = draft.turn
	while (
		open &&
		open.kind === 'draft' &&
		open.id === draft.id &&
		open.turn === turn
	) {
		const banned = open.banned
		const left = open.pool.filter((i) => banned.indexOf(i.key) === -1)
		if (left.length === 0) break
		const next = chooseTile(
			current,
			open,
			left[pickIndex(left.length, random)].key,
			now,
		)
		if (!next) break
		current = next
		open = setupOf(current).open
	}
	return current
}

function parseCandidates(value: unknown): SetupItem[] | null {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_CANDIDATES
	)
		return null
	const seen: { [key: string]: boolean } = {}
	const items: SetupItem[] = []
	for (const raw of value) {
		if (
			!isPlainObject(raw) ||
			typeof raw.key !== 'string' ||
			raw.key.length === 0
		)
			return null
		if (seen[raw.key]) return null
		if (raw.stake !== undefined && !isWhole(raw.stake, 1, MAX_STAKE))
			return null
		seen[raw.key] = true
		items.push(raw as SetupItem)
	}
	return items
}

function parseSchedule(value: unknown): DraftTurn[] | null {
	if (!Array.isArray(value) || value.length > MAX_SCHEDULE_TURNS) return null
	const turns: DraftTurn[] = []
	for (const raw of value) {
		if (!isPlainObject(raw)) return null
		if (!isWhole(raw.actor, 1, MAX_CANDIDATES)) return null
		if (raw.action !== 'ban' && raw.action !== 'pick') return null
		if (!isWhole(raw.count, 1, MAX_CANDIDATES)) return null
		turns.push({ actor: raw.actor, action: raw.action, count: raw.count })
	}
	return turns
}

function stepSeconds(value: unknown, fallback: number): number | null {
	if (value === undefined) return fallback
	return isWhole(value, MIN_STEP_SECONDS, MAX_STEP_SECONDS) ? value : null
}

// Checks shared by both step starts: host only, in a started game, nothing
// else open, and a fresh step id.
function startRefusal(
	lobby: Lobby,
	ctx: ActionContext,
	id: unknown,
): string | null {
	if (!lobby.game.started) return 'not_in_game'
	if (lobby.hostId !== ctx.from) return 'not_host'
	if (typeof id !== 'string' || !STEP_ID_PATTERN.test(id)) return 'bad_params'
	const setup = setupOf(lobby.game)
	if (setup.open) return 'step_open'
	if (setup.results[id]) return 'step_done'
	return null
}

function changed(game: GameState, now: number): Reduction {
	return { game, params: { setup: setupView(setupOf(game), now) } }
}

// {id, candidates: [{key, stake?, ...}], poolSize?, keep?, schedule?,
// maxStake?, turnSeconds?} -- host only. The server samples the pool, rolls
// any missing stake from 1 to maxStake, and rolls who acts first.
const startDraft: AuthoritativeAction = {
	key: 'mpapi_setup_draft',
	reduce(lobby, ctx, params) {
		const p = isPlainObject(params) ? params : {}
		const refusal = startRefusal(lobby, ctx, p.id)
		if (refusal) return { reject: refusal }
		const candidates = parseCandidates(p.candidates)
		if (!candidates) return { reject: 'bad_params' }
		const poolSize = p.poolSize === undefined ? candidates.length : p.poolSize
		if (!isWhole(poolSize, 1, candidates.length))
			return { reject: 'bad_params' }
		const keep = p.keep === undefined ? 1 : p.keep
		if (!isWhole(keep, 0, poolSize)) return { reject: 'bad_params' }
		const schedule = p.schedule === undefined ? null : parseSchedule(p.schedule)
		if (p.schedule !== undefined && !schedule) return { reject: 'bad_params' }
		if (p.maxStake !== undefined && !isWhole(p.maxStake, 1, MAX_STAKE))
			return { reject: 'bad_params' }
		const turnSeconds = stepSeconds(p.turnSeconds, DEFAULT_TURN_SECONDS)
		if (turnSeconds === null) return { reject: 'bad_params' }

		const order = seatedParticipants(lobby)
		if (order.length === 0) return { reject: 'not_in_game' }
		const maxStake = p.maxStake as number | undefined
		const pool = shuffled(candidates, ctx.random)
			.slice(0, poolSize)
			.map((item) =>
				item.stake === undefined && maxStake !== undefined
					? { ...item, stake: 1 + pickIndex(maxStake, ctx.random) }
					: item,
			)
		const turns = schedule || deriveSchedule(poolSize, keep, order.length)
		const turnMs = turnSeconds * 1000
		const draft: OpenDraft = {
			kind: 'draft',
			id: p.id as string,
			pool,
			banned: [],
			order,
			// A tournament lobby's ban order decides; any other lobby rolls.
			first: draftFirstIndex(lobby.tournament, order) ?? pickIndex(order.length, ctx.random),
			schedule: turns,
			turn: 0,
			remaining: turns.length > 0 ? turns[0].count : 0,
			turnMs,
			deadline: ctx.now + turnMs,
		}
		const game = {
			...lobby.game,
			setup: { ...setupOf(lobby.game), open: draft },
		}
		if (turns.length === 0)
			return changed(finishDraft(game, draft, pool), ctx.now)
		return changed(game, ctx.now)
	},
}

// {key} -- the current actor bans the tile, or picks it on a pick turn.
const chooseDraftTile: AuthoritativeAction = {
	key: 'mpapi_setup_choose',
	reduce(lobby, ctx, params) {
		const open = setupOf(lobby.game).open
		if (!open || open.kind !== 'draft') return { reject: 'no_draft' }
		if (draftActor(open) !== ctx.from) return { reject: 'not_your_turn' }
		const key = isPlainObject(params) ? params.key : undefined
		if (typeof key !== 'string') return { reject: 'bad_params' }
		const game = chooseTile(lobby.game, open, key, ctx.now)
		if (!game) return { reject: 'bad_tile' }
		return changed(game, ctx.now)
	},
}

// ── Vote rules ────────────────────────────────────────────────────────────────

// Each vote is one chance: an option's odds are its votes over all votes cast.
// With no votes every option has the same odds.
export function rollVote(vote: OpenVote, random: () => number): VoteResult {
	const counts: { [option: string]: number } = {}
	for (const option of vote.options) counts[option] = 0
	for (const voter of Object.keys(vote.votes)) counts[vote.votes[voter]] += 1
	const total = Object.keys(vote.votes).length
	if (total === 0) {
		return {
			kind: 'vote',
			option: vote.options[pickIndex(vote.options.length, random)],
			counts,
		}
	}
	let ticket = pickIndex(total, random)
	for (const option of vote.options) {
		if (ticket < counts[option]) return { kind: 'vote', option, counts }
		ticket -= counts[option]
	}
	return { kind: 'vote', option: vote.options[vote.options.length - 1], counts }
}

function closeVote(
	game: GameState,
	vote: OpenVote,
	random: () => number,
): GameState {
	const setup = setupOf(game)
	return {
		...game,
		setup: {
			open: null,
			results: { ...setup.results, [vote.id]: rollVote(vote, random) },
		},
	}
}

// Every voter still connected has voted: nobody is left to wait for.
function everyoneVoted(lobby: Lobby, vote: OpenVote): boolean {
	return vote.voters.every(
		(id) => vote.votes[id] !== undefined || !connected(lobby, id),
	)
}

// {id, options: [string], seconds?} -- host only. Every seated participant may
// vote once.
const startVote: AuthoritativeAction = {
	key: 'mpapi_setup_vote',
	reduce(lobby, ctx, params) {
		const p = isPlainObject(params) ? params : {}
		const refusal = startRefusal(lobby, ctx, p.id)
		if (refusal) return { reject: refusal }
		const options = p.options
		if (
			!Array.isArray(options) ||
			options.length < 2 ||
			options.length > MAX_VOTE_OPTIONS
		)
			return { reject: 'bad_params' }
		for (let i = 0; i < options.length; i++) {
			const option = options[i]
			if (typeof option !== 'string' || !STEP_ID_PATTERN.test(option))
				return { reject: 'bad_params' }
			if (options.indexOf(option) !== i) return { reject: 'bad_params' }
		}
		const seconds = stepSeconds(p.seconds, DEFAULT_VOTE_SECONDS)
		if (seconds === null) return { reject: 'bad_params' }
		const vote: OpenVote = {
			kind: 'vote',
			id: p.id as string,
			options: options as string[],
			voters: seatedParticipants(lobby),
			votes: {},
			deadline: ctx.now + seconds * 1000,
		}
		return changed(
			{
				...lobby.game,
				setup: { ...setupOf(lobby.game), open: vote },
			},
			ctx.now,
		)
	},
}

// {option} -- a voter's one vote; the vote closes once every connected voter
// has voted.
const castVote: AuthoritativeAction = {
	key: 'mpapi_setup_cast',
	reduce(lobby, ctx, params) {
		const open = setupOf(lobby.game).open
		if (!open || open.kind !== 'vote') return { reject: 'no_vote' }
		if (open.voters.indexOf(ctx.from) === -1) return { reject: 'not_voter' }
		if (open.votes[ctx.from] !== undefined) return { reject: 'already_voted' }
		const option = isPlainObject(params) ? params.option : undefined
		if (typeof option !== 'string' || open.options.indexOf(option) === -1)
			return { reject: 'bad_params' }
		const vote: OpenVote = {
			...open,
			votes: { ...open.votes, [ctx.from]: option },
		}
		const game = {
			...lobby.game,
			setup: { ...setupOf(lobby.game), open: vote },
		}
		if (everyoneVoted(lobby, vote))
			return changed(closeVote(game, vote, ctx.random), ctx.now)
		return changed(game, ctx.now)
	},
}

// Only the server sends it (setupTick); listed so a client can't relay one.
const setupState: AuthoritativeAction = {
	key: SETUP_STATE_KEY,
	reduce() {
		return { reject: 'server_only' }
	},
}

export const SETUP_ACTIONS: AuthoritativeAction[] = [
	startDraft,
	chooseDraftTile,
	startVote,
	castVote,
	setupState,
]

// ── Time ──────────────────────────────────────────────────────────────────────

// Time passing: a Draft turn past its deadline gets random choices, a vote
// past its deadline (or with nobody left to wait for) closes. Every change is
// broadcast as SETUP_STATE_KEY.
export function setupTick(
	lobby: Lobby,
	now: number,
	random: () => number,
): Step {
	const open = lobby.game.started ? setupOf(lobby.game).open : null
	if (!open) return { lobby, out: [] }
	let game: GameState | null = null
	if (open.kind === 'draft' && now >= open.deadline) {
		game = timeOutTurn(lobby.game, open, now, random)
	} else if (
		open.kind === 'vote' &&
		(now >= open.deadline || everyoneVoted(lobby, open))
	) {
		game = closeVote(lobby.game, open, random)
	}
	if (!game) return { lobby, out: [] }
	const next = { ...lobby, game }
	return {
		lobby: next,
		out: [
			{
				kind: 'send',
				op: ServerOp.ACTION,
				payload: {
					cid: '',
					action: SETUP_STATE_KEY,
					from: SERVER_TARGET,
					to: BROADCAST_TARGET,
					params: { setup: setupView(setupOf(game), now) },
				},
				to: next.players.map((p) => p.id),
			},
		],
	}
}

// A restart keeps what Setup decided, and nothing still open.
export function setupForRestart(game: GameState): SetupState {
	return { open: null, results: setupOf(game).results }
}

// A resumed match: open deadlines move on by the time the server was down.
export function setupAfterDowntime(
	game: GameState,
	downtime: number,
): SetupState | undefined {
	const setup = game.setup
	if (!setup || !setup.open) return setup
	return {
		...setup,
		open: { ...setup.open, deadline: setup.open.deadline + downtime },
	}
}
