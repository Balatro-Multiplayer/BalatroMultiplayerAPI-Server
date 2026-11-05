// Authoritative actions: the MPAPI ActionTypes declared `authoritative = true`
// (MPAPI api/action/builtin.lua), which the server runs instead of relaying.
// Every other action -- anything mod-specific -- is relayed untouched
// (lobby/relay.ts), so the server never needs to know a mod's actions.
//
// Pure: a reducer gets the lobby and its context and returns the new game
// state plus the results to broadcast, or a rejection reason for the sender.
import type { GameState, SpectateEvent, StartedGame } from '../lobby/protocol'
import {
	type Lobby,
	type Outbound,
	MAX_PLAYERS,
	emptyGame,
	isParticipant,
} from '../lobby/state'
import { lobbyKindOf } from '../review/ranked'
import { runSavePart } from './run_save'
import { finishGame, parsePlacements } from './results'
import { SETUP_ACTIONS, setupForRestart } from './setup'
import { PVP_MOD_ID, VERSION_MISMATCH, versionOutliers } from '../standing/pvp_version'

export interface ActionContext {
	from: string
	now: number
	// A fresh Balatro seed and a fresh run id (injected so reducers stay
	// deterministic in tests).
	newSeed: () => string
	newId: () => string
	// A number in [0, 1), for Setup's rolls.
	random: () => number
}

// A result broadcast as ACTION {from:'server'}: to every player (the
// default), every player but the sender, or nobody. `out` are further effects
// (storing a finished run), carried out after the broadcast.
export interface ActionResult {
	game: GameState
	params: unknown
	to?: 'all' | 'others' | 'none'
	out?: Outbound[]
	// Replay events to pass on to spectators, one by one (a batch of events).
	spectate?: SpectateEvent[]
}

export type Reduction = ActionResult | { reject: string }

export interface AuthoritativeAction {
	key: string
	reduce(lobby: Lobby, ctx: ActionContext, params: unknown): Reduction
}

const MAX_OPTIONS_BYTES = 4 * 1024
const MIN_GAME_PLAYERS = 2

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// {ready: boolean} -- the sender's own ready flag.
const ready: AuthoritativeAction = {
	key: 'mpapi_ready',
	reduce(lobby, ctx, params) {
		if (!isPlainObject(params) || typeof params.ready !== 'boolean')
			return { reject: 'bad_params' }
		if (lobby.game.started) return { reject: 'in_game' }
		const readyMap = { ...lobby.game.ready }
		if (params.ready) readyMap[ctx.from] = true
		else delete readyMap[ctx.from]
		return {
			game: { ...lobby.game, ready: readyMap },
			params: { playerId: ctx.from, ready: params.ready },
		}
	},
}

// What every client gets when a game starts (or restarts).
function startedParams(started: StartedGame) {
	return {
		runId: started.runId,
		seed: started.seed,
		stake: started.stake,
		options: started.options,
		players: started.players,
	}
}

// A new game on the lobby's present players, with a server-picked seed.
function newGame(
	lobby: Lobby,
	ctx: ActionContext,
	stake: number | null,
	options: unknown,
): StartedGame {
	return {
		runId: ctx.newId(),
		seed: ctx.newSeed(),
		stake,
		options,
		startedAt: ctx.now,
		hostId: lobby.hostId,
		players: lobby.players
			.filter((pl) => pl.awaySince === null)
			.map((pl) => ({
				id: pl.id,
				displayName: pl.info.displayName,
				...(pl.info.preferredJoker ? { avatar: pl.info.preferredJoker } : {}),
			})),
	}
}

// {stake?, options?, minPlayers?} -- host only, once every other connected
// player is ready. The server picks the seed, so the host can't. minPlayers
// lets a gamemode ask for more than the usual two.
const startGame: AuthoritativeAction = {
	key: 'mpapi_start_game',
	reduce(lobby, ctx, params) {
		const p = isPlainObject(params) ? params : {}
		if (p.stake !== undefined && typeof p.stake !== 'number')
			return { reject: 'bad_params' }
		if (
			p.minPlayers !== undefined &&
			(typeof p.minPlayers !== 'number' || p.minPlayers % 1 !== 0)
		)
			return { reject: 'bad_params' }
		const options = p.options === undefined ? null : p.options
		if (JSON.stringify(options).length > MAX_OPTIONS_BYTES)
			return { reject: 'bad_params' }
		if (lobby.hostId !== ctx.from) return { reject: 'not_host' }
		if (lobby.game.started) return { reject: 'in_game' }
		// Queueing as a group (lobby/group_queue.ts): the group's game is the
		// public one it's matched into.
		if (lobby.groupQueue) return { reject: 'group_queue' }
		const minPlayers = Math.min(
			Math.max(MIN_GAME_PLAYERS, typeof p.minPlayers === 'number' ? p.minPlayers : 0),
			lobby.maxPlayers,
			MAX_PLAYERS,
		)
		const present = lobby.players.filter((pl) => pl.awaySince === null)
		if (present.length < minPlayers) return { reject: 'too_few_players' }
		for (const pl of present) {
			if (pl.id !== lobby.hostId && !lobby.game.ready[pl.id])
				return { reject: 'not_all_ready' }
		}
		// PvP versions read scores differently, so one game takes one version.
		// The version is the server's own record of the player's mod report.
		if (lobby.modId === PVP_MOD_ID) {
			const versions: { [id: string]: string } = {}
			for (const pl of present) versions[pl.id] = pl.info.pvpVersion || ''
			if (versionOutliers(versions).length > 0) return { reject: VERSION_MISMATCH }
		}
		const started = newGame(
			lobby,
			ctx,
			typeof p.stake === 'number' ? p.stake : null,
			options,
		)
		return {
			game: { ...emptyGame(), started },
			params: startedParams(started),
		}
	},
}

// {} -- host only: a new game on a new seed, same options and stake (a
// finished Draft has set the stake), same Setup results. The current one is
// stored as 'restarted' (no GAME_ENDED: clients go straight into the new game,
// through the same path as a start).
const restartGame: AuthoritativeAction = {
	key: 'mpapi_restart_game',
	reduce(lobby, ctx) {
		if (lobby.hostId !== ctx.from) return { reject: 'not_host' }
		const current = lobby.game.started
		if (!current) return { reject: 'not_in_game' }
		const finished = finishGame(lobby, ctx.now, {
			status: 'restarted',
			announce: false,
		})
		const started = newGame(finished.lobby, ctx, current.stake, current.options)
		return {
			game: { ...emptyGame(), started, setup: setupForRestart(lobby.game) },
			params: startedParams(started),
			out: finished.out,
		}
	},
}

// {} -- host only: ends the game without a result.
const abandonGame: AuthoritativeAction = {
	key: 'mpapi_abandon_game',
	reduce(lobby, ctx) {
		if (lobby.hostId !== ctx.from) return { reject: 'not_host' }
		const current = lobby.game.started
		if (!current) return { reject: 'not_in_game' }
		const finished = finishGame(lobby, ctx.now, {
			status: 'abandoned',
			announce: true,
		})
		return {
			game: finished.lobby.game,
			params: { runId: current.runId },
			out: finished.out,
		}
	},
}

// {placements: [{playerId, place, performance?, metric?}]} -- every
// participant's own view of the result. A later report replaces an earlier
// one; results.ts settles the game once they're all in.
const reportResult: AuthoritativeAction = {
	key: 'mpapi_report_result',
	reduce(lobby, ctx, params) {
		const started = lobby.game.started
		if (!started) return { reject: 'not_in_game' }
		if (!isParticipant(lobby, ctx.from)) return { reject: 'not_participant' }
		const placements = parsePlacements(
			isPlainObject(params) ? params.placements : null,
			started.players,
		)
		if (!placements) return { reject: 'bad_params' }
		const game = lobby.game
		return {
			game: {
				...game,
				reports: { ...game.reports, [ctx.from]: placements },
				reportOrder:
					game.reportOrder.indexOf(ctx.from) === -1
						? game.reportOrder.concat([ctx.from])
						: game.reportOrder,
				settleFrom: game.settleFrom === null ? ctx.now : game.settleFrom,
			},
			params: { playerId: ctx.from, reported: true },
		}
	},
}

// {pending: boolean} -- any participant of the started game. Marks the run as
// having a pending result (a pending death waits on the others) or clears it.
// While pending, results.ts keeps the run open; clearing lets it settle.
const setResultPending: AuthoritativeAction = {
	key: 'mpapi_set_result_pending',
	reduce(lobby, ctx, params) {
		const started = lobby.game.started
		if (!started) return { reject: 'not_in_game' }
		if (!isParticipant(lobby, ctx.from)) return { reject: 'not_participant' }
		if (!isPlainObject(params) || typeof params.pending !== 'boolean')
			return { reject: 'bad_params' }
		const game = {
			...lobby.game,
			resultPending: params.pending,
			resultWasPending: lobby.game.resultWasPending || params.pending,
		}
		return { game, params: { playerId: ctx.from, pending: params.pending } }
	},
}

// {opponentId?} -- any participant of a started matchmade game contests it:
// the opponent breaks the rules on purpose or stalls. The run is then stored as
// 'contested' (results.ts) and a moderator decides it. The opponent may be
// left out in a game of 2; in a larger one the contester names them.
const contest: AuthoritativeAction = {
	key: 'mpapi_contest',
	reduce(lobby, ctx, params) {
		const started = lobby.game.started
		if (!started) return { reject: 'not_in_game' }
		if (!isParticipant(lobby, ctx.from)) return { reject: 'not_participant' }
		if (!lobby.rankedMode && !lobby.gameMode) return { reject: 'not_matchmade' }
		if (lobby.game.contest) return { reject: 'already_contested' }
		const input = isPlainObject(params) ? params : {}
		const others = started.players.filter((p) => p.id !== ctx.from)
		let against: string
		if (input.opponentId === undefined || input.opponentId === null) {
			if (others.length !== 1) return { reject: 'bad_params' }
			against = others[0].id
		} else {
			const named = input.opponentId
			if (typeof named !== 'string' || !others.some((p) => p.id === named))
				return { reject: 'bad_params' }
			against = named
		}
		const contested = { by: ctx.from, against, at: ctx.now }
		return {
			game: { ...lobby.game, contest: contested },
			params: { playerId: ctx.from, against },
			out: [
				{
					kind: 'contest',
					runId: started.runId,
					code: lobby.code,
					by: ctx.from,
					against,
					at: ctx.now,
					lobbyKind: lobbyKindOf(lobby),
				},
			],
		}
	},
}

// A player's replay log is capped; past it, further events are dropped (not
// refused, so the client isn't warned on every event).
export const MAX_LOG_EVENTS = 20_000
export const MAX_LOG_BYTES = 1024 * 1024
const MAX_OPCODE_LENGTH = 64

// One replay event from a participant, added to their log. `relayed` is what
// the others are told (null when the event was dropped or is not for this run).
type Appended = { game: GameState; relayed: SpectateEvent | null } | { reject: string }

function appendLogEvent(lobby: Lobby, from: string, now: number, params: unknown): Appended {
	if (
		!isPlainObject(params) ||
		typeof params.t !== 'number' ||
		typeof params.opcode !== 'string' ||
		params.opcode.length === 0 ||
		params.opcode.length > MAX_OPCODE_LENGTH
	)
		return { reject: 'bad_params' }
	const started = lobby.game.started
	if (!started) return { reject: 'not_in_game' }
	// An event the client sent for a run the server has since restarted
	// (it was in flight as the restart went out) belongs to no stored
	// log: kept, it would sit ahead of the new run's manifest and fail
	// the new run's hash check. Clients tag events with their run.
	if (typeof params.run === 'string' && params.run !== started.runId)
		return { game: lobby.game, relayed: null }
	const args = params.args === undefined ? null : params.args
	const line = JSON.stringify([params.t, params.opcode, args])
	const size = line.length

	const game = lobby.game
	const log = game.logs[from] || { lines: [], bytes: 0, truncated: false }
	if (
		log.truncated ||
		log.lines.length >= MAX_LOG_EVENTS ||
		log.bytes + size > MAX_LOG_BYTES
	) {
		const truncated = { ...log, truncated: true }
		return {
			game: { ...game, logs: { ...game.logs, [from]: truncated } },
			relayed: null,
		}
	}
	const grown = {
		lines: log.lines.concat([line]),
		bytes: log.bytes + size,
		truncated: false,
	}
	// The first event of the game marks the start of the race (the match
	// manifest is written when the racers' run begins). Single events and
	// batches both come through here.
	const stamped =
		started.raceStartedAt === undefined ? { ...started, raceStartedAt: now } : started
	return {
		game: { ...game, started: stamped, logs: { ...game.logs, [from]: grown } },
		relayed: { playerId: from, t: params.t, opcode: params.opcode, args },
	}
}

// {t, opcode, args?, run?} -- one replay event from a participant, kept for the
// stored run and passed on to the others (who track how far each player's
// stream has got).
const logEvent: AuthoritativeAction = {
	key: 'mpapi_log_event',
	reduce(lobby, ctx, params) {
		if (!lobby.game.started) return { reject: 'not_in_game' }
		if (!isParticipant(lobby, ctx.from)) return { reject: 'not_participant' }
		const appended = appendLogEvent(lobby, ctx.from, ctx.now, params)
		if ('reject' in appended) return appended
		return {
			game: appended.game,
			params: appended.relayed,
			to: appended.relayed ? 'others' : 'none',
		}
	},
}

// Most events one mpapi_log_events message may carry.
export const MAX_LOG_BATCH = 50

// {events: [{t, opcode, args?, run?}, ...]} -- up to MAX_LOG_BATCH replay
// events, in order, each handled as mpapi_log_event would. The others are told
// once: {playerId, t, opcode, args, count} of the last event kept, which is all
// they track (how far the stream has got). Spectators get every event. One bad
// event refuses the whole batch, before any of it is kept.
const logEvents: AuthoritativeAction = {
	key: 'mpapi_log_events',
	reduce(lobby, ctx, params) {
		if (!lobby.game.started) return { reject: 'not_in_game' }
		if (!isParticipant(lobby, ctx.from)) return { reject: 'not_participant' }
		if (
			!isPlainObject(params) ||
			!Array.isArray(params.events) ||
			params.events.length === 0 ||
			params.events.length > MAX_LOG_BATCH
		)
			return { reject: 'bad_params' }
		let current = lobby
		const relayed: SpectateEvent[] = []
		for (const event of params.events) {
			const appended = appendLogEvent(current, ctx.from, ctx.now, event)
			if ('reject' in appended) return appended
			current = { ...current, game: appended.game }
			if (appended.relayed) relayed.push(appended.relayed)
		}
		if (relayed.length === 0) return { game: current.game, params: null, to: 'none' }
		const last = relayed[relayed.length - 1]
		return {
			game: current.game,
			params: { ...last, count: relayed.length },
			to: 'others',
			spectate: relayed,
		}
	},
}

const REGISTRY: { [key: string]: AuthoritativeAction } = {
	[ready.key]: ready,
	[startGame.key]: startGame,
	[restartGame.key]: restartGame,
	[abandonGame.key]: abandonGame,
	[reportResult.key]: reportResult,
	[setResultPending.key]: setResultPending,
	[contest.key]: contest,
	[logEvent.key]: logEvent,
	[logEvents.key]: logEvents,
	[runSavePart.key]: runSavePart,
}
for (const setupAction of SETUP_ACTIONS) REGISTRY[setupAction.key] = setupAction

// The replay-log action, which relay.ts budgets separately.
export const LOG_EVENT_KEY = logEvent.key
export const LOG_EVENTS_KEY = logEvents.key

export function authoritativeAction(key: string): AuthoritativeAction | null {
	return Object.prototype.hasOwnProperty.call(REGISTRY, key)
		? REGISTRY[key]
		: null
}

// Balatro's seed alphabet: 1-9 and A-Z without O (G.CONTROLLER seed entry).
const SEED_ALPHABET = '123456789ABCDEFGHIJKLMNPQRSTUVWXYZ'
export const SEED_LENGTH = 8

// Turns random hex (e.g. a UUID) into a Balatro seed.
export function seedFromHex(hex: string): string {
	const digits = hex.replace(/[^0-9a-f]/gi, '')
	let seed = ''
	for (let i = 0; i < SEED_LENGTH; i++) {
		const n = Number.parseInt(digits.substr(i * 3, 3) || '0', 16)
		seed += SEED_ALPHABET[n % SEED_ALPHABET.length]
	}
	return seed
}
