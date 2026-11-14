// Authoritative actions: the MPAPI ActionTypes declared `authoritative = true`
// (MPAPI api/action/builtin.lua), which the server runs instead of relaying.
// Every other action -- anything mod-specific -- is relayed untouched
// (lobby/relay.ts), so the server never needs to know a mod's actions.
//
// Pure: a reducer gets the lobby and its context and returns the new game
// state plus the results to broadcast, or a rejection reason for the sender.
import type { GameState, PlayerLog, SpectateEvent, StartedGame } from '../lobby/protocol'
import {
	type Lobby,
	type Outbound,
	MAX_PLAYERS,
	emptyGame,
	isParticipant,
} from '../lobby/state'
import { logHeldOf } from '../lobby/log_check'
import { startingPresence } from '../lobby/presence'
import { lobbyKindOf } from '../review/ranked'
import { reduceForfeit } from '../lobby/pvp/facts'
import { settingsFromMetadata } from '../lobby/pvp/settings'
import { type PvpMode, refereeOf, withReferee } from '../lobby/pvp/state'
import { MODE_DISABLED, ticketModeDisabled } from '../matchmaking/mode_switch'
import { runSavePart } from './run_save'
import { finishGame, isRefereed, parsePlacements } from './results'
import { setupPending } from '../lobby/pvp/freeze_env'
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
	// The PvP modes the kill switch has off (config.disabledPvpModes), read by
	// the shell when the action arrives: the reducer never reads the config.
	disabledPvpModes: readonly PvpMode[]
}

// What a step needs from the outside: the clock, randomness and ids, injected so
// actions, requests and the PvP tick stay deterministic in tests (match.ts passes
// the real ones).
export type StepContext = Omit<ActionContext, 'from' | 'disabledPvpModes'>

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
	// Extra fields for the sender's ack of a log action (relay.ts adds them to
	// { ack: true }).
	ack?: { [field: string]: unknown }
}

// `key` rides with a bad_rules refusal: the lobby metadata key that is missing or malformed.
export type Reduction = ActionResult | { reject: string; key?: string }

export interface AuthoritativeAction {
	key: string
	reduce(lobby: Lobby, ctx: ActionContext, params: unknown): Reduction
}

// The refusal for the actions a refereed PvP game takes from the server alone
// (docs/pvp-match.md section 3).
export const SERVER_REFEREE = 'server_referee'

// The key of the action that starts a game.
export const START_GAME_KEY = 'mpapi_start_game'

// The refusal of a start while any seat is away (disconnected, in grace).
export const PLAYER_AWAY = 'player_away'

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

// The refusal for a PvP game whose ruleset has no clock rules (pvp/settings.ts).
export const BAD_RULES = 'bad_rules'

// The first lobby metadata key a PvP game cannot be frozen from (missing or malformed),
// or null; any other mod has no PvP rules to freeze. The player count does not change the
// answer, so the lobby's players stand in for the started ids.
function badRulesKey(lobby: Lobby): string | null {
	if (lobby.modId !== PVP_MOD_ID) return null
	const result = settingsFromMetadata(
		lobby.metadata,
		lobby.players.map((p) => p.id),
	)
	return result.ok ? null : result.key
}

// Whether the lobby's PvP mode (its queue_mode, a ranked lobby being Nemesis) is
// switched off. A lobby whose mode is not known never reaches here (bad_rules).
function modeSwitchedOff(lobby: Lobby, disabled: readonly PvpMode[]): boolean {
	if (lobby.modId !== PVP_MOD_ID) return false
	return ticketModeDisabled(
		disabled,
		lobby.modId,
		lobby.metadata.queue_mode,
		(lobby.rankedMode ?? '') !== '',
	)
}

// A new game on every seat, with a server-picked seed. A seat that is away
// stays in it (its grace continues like any other step's).
function newGame(
	lobby: Lobby,
	ctx: StepContext,
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
		players: lobby.players.map((pl) => ({
			id: pl.id,
			displayName: pl.info.displayName,
			...(pl.info.preferredJoker ? { avatar: pl.info.preferredJoker } : {}),
		})),
	}
}

// {stake?, options?, minPlayers?} -- host only, with no seat away and every
// other seat ready. The server picks the seed, so the host can't. minPlayers
// lets a gamemode ask for more than the usual two.
const startGame: AuthoritativeAction = {
	key: START_GAME_KEY,
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
		// A seat that is away is still a seat (its Ready is kept until it leaves
		// or is evicted): the game starts on every seat or not at all.
		if (lobby.players.some((pl) => pl.awaySince !== null))
			return { reject: PLAYER_AWAY }
		if (lobby.players.length < minPlayers) return { reject: 'too_few_players' }
		for (const pl of lobby.players) {
			if (pl.id !== lobby.hostId && !lobby.game.ready[pl.id])
				return { reject: 'not_all_ready' }
		}
		// PvP versions read scores differently, so one game takes one version.
		// The version is the server's own record of the player's mod report.
		if (lobby.modId === PVP_MOD_ID) {
			const versions: { [id: string]: string } = {}
			for (const pl of lobby.players) versions[pl.id] = pl.info.pvpVersion || ''
			if (versionOutliers(versions).length > 0) return { reject: VERSION_MISMATCH }
		}
		// The kill switch comes before the rules: a mode that is off never starts.
		if (modeSwitchedOff(lobby, ctx.disabledPvpModes)) return { reject: MODE_DISABLED }
		// The rules freeze from the metadata the host published: a key the server reads that
		// is missing or malformed never starts, and the refusal names it.
		const badKey = badRulesKey(lobby)
		if (badKey !== null) return { reject: BAD_RULES, key: badKey }
		const started = newGame(
			lobby,
			ctx,
			typeof p.stake === 'number' ? p.stake : null,
			options,
		)
		return {
			game: { ...emptyGame(), started, presence: startingPresence(started) },
			params: startedParams(started),
		}
	},
}

// The restart itself: the current game stored as 'restarted', and a new one on
// a new seed. Also the outcome of a passed PvP seed vote (lobby/pvp/referee.ts).
export function restartedGame(
	lobby: Lobby,
	ctx: StepContext,
): { game: GameState; params: unknown; out: Outbound[] } | null {
	const current = lobby.game.started
	if (!current) return null
	const finished = finishGame(lobby, ctx.now, {
		status: 'restarted',
		announce: false,
	})
	// `restarted`: the Draft-dodge window (a leave before the race begins) belongs to
	// the first run of a game only; a seat that drops across a restart is a forfeit.
	const started: StartedGame = {
		...newGame(finished.lobby, ctx, current.stake, current.options),
		restarted: true,
	}
	return {
		game: {
			...emptyGame(),
			started,
			setup: setupForRestart(lobby.game),
			// An away seat joined at the start like the rest, then is recorded away:
			// the record never claims a connection that is not there.
			presence: startingPresence(started).concat(
				lobby.players
					.filter((pl) => pl.awaySince !== null)
					.map((pl) => ({ userId: pl.id, kind: 'disconnected' as const, at: ctx.now })),
			),
		},
		params: startedParams(started),
		out: finished.out,
	}
}

// {} -- host only: a new game on a new seed, same options and stake (a
// finished Draft has set the stake), same Setup results. The current one is
// stored as 'restarted' (no GAME_ENDED: clients go straight into the new game,
// through the same path as a start).
const restartGame: AuthoritativeAction = {
	key: 'mpapi_restart_game',
	reduce(lobby, ctx) {
		if (lobby.hostId !== ctx.from) return { reject: 'not_host' }
		if (!lobby.game.started) return { reject: 'not_in_game' }
		// A refereed game restarts only through a passed seed vote.
		if (isRefereed(lobby)) return { reject: SERVER_REFEREE }
		return restartedGame(lobby, ctx) ?? { reject: 'not_in_game' }
	},
}

// {} -- host only: ends the game without a result.
const abandonGame: AuthoritativeAction = {
	key: 'mpapi_abandon_game',
	reduce(lobby, ctx) {
		const current = lobby.game.started
		// In a refereed game it is a forfeit by the requester, whoever they are;
		// pvpTick settles the rest (docs/pvp-match.md section 3).
		if (current && isRefereed(lobby)) {
			if (!isParticipant(lobby, ctx.from)) return { reject: 'not_participant' }
			const referee = refereeOf(lobby)
			if (referee === null) return { reject: 'not_in_game' }
			const forfeit = reduceForfeit(referee, ctx.from, { runId: current.runId })
			// Nothing left to decide (a pending death, a finished game): accepted,
			// no fact recorded.
			if (
				!forfeit.ok &&
				(forfeit.reason === 'eliminated' || forfeit.reason === 'round_over')
			)
				return { game: lobby.game, params: { runId: current.runId } }
			if (!forfeit.ok) return { reject: forfeit.reason }
			return {
				game: withReferee(lobby, forfeit.state).game,
				params: { runId: current.runId },
			}
		}
		if (lobby.hostId !== ctx.from) return { reject: 'not_host' }
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
		// The referee decides the result; a report would also start the result
		// clock (settleFrom) and abandon a live game.
		if (isRefereed(lobby)) return { reject: SERVER_REFEREE }
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
		if (isRefereed(lobby)) return { reject: SERVER_REFEREE }
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
	// A numbered event (seq) is kept only when it is the next one the server
	// holds. An earlier number is a copy of one already kept. A later number
	// means events before it were lost: it is not kept, so the stored log never
	// has a gap inside, and the ack tells the client where to start again.
	const numbered = typeof params.seq === 'number' && Number.isInteger(params.seq) && params.seq > 0
	const seq = numbered ? (params.seq as number) : 0
	const held = logHeldOf(log)
	if (numbered && seq <= held) return { game, relayed: null }
	if (numbered && seq > held + 1) {
		const ahead = Math.max(log.ahead ?? 0, seq)
		return {
			game: { ...game, logs: { ...game.logs, [from]: { ...log, seq: held, ahead } } },
			relayed: null,
		}
	}
	const counted = numbered ? { seq } : {}
	if (
		log.truncated ||
		log.lines.length >= MAX_LOG_EVENTS ||
		log.bytes + size > MAX_LOG_BYTES
	) {
		const truncated = { ...log, ...counted, truncated: true }
		return {
			game: { ...game, logs: { ...game.logs, [from]: truncated } },
			relayed: null,
		}
	}
	const grown: PlayerLog = {
		...log,
		...counted,
		lines: log.lines.concat([line]),
		bytes: log.bytes + size,
		truncated: false,
	}
	// The first event of the game marks the start of the race (the match
	// manifest is written when the racers' run begins). Single events and
	// batches both come through here. Until Setup is finished (setupPending: a step
	// open, a ranked game's Draft result missing, a casual vote not published) the race
	// cannot have begun, so no event stamps it: a client message must never decide that
	// the run started (a dodge becomes a forfeit on that stamp).
	const stamped =
		started.raceStartedAt === undefined && !setupPending(lobby)
			? { ...started, raceStartedAt: now }
			: started
	return {
		game: { ...game, started: stamped, logs: { ...game.logs, [from]: grown } },
		relayed: { playerId: from, t: params.t, opcode: params.opcode, args },
	}
}

// What the sender is told in the ack of a log action when it numbers its
// events: the highest number the server holds with no gap. Nothing for a
// client that sends no numbers.
function ackOf(game: GameState, from: string, events: unknown[]): { got: number } | undefined {
	const numbered = events.some((e) => isPlainObject(e) && typeof e.seq === 'number')
	if (!numbered) return undefined
	const log = game.logs[from]
	return { got: logHeldOf(log) }
}

// {t, opcode, args?, run?} -- one replay event from a participant, kept for the
// stored run and passed on to the others as {playerId, t} only (who track how far each
// player's stream has got); spectators get the whole event.
const logEvent: AuthoritativeAction = {
	key: 'mpapi_log_event',
	reduce(lobby, ctx, params) {
		if (!lobby.game.started) return { reject: 'not_in_game' }
		if (!isParticipant(lobby, ctx.from)) return { reject: 'not_participant' }
		const appended = appendLogEvent(lobby, ctx.from, ctx.now, params)
		if ('reject' in appended) return appended
		const { relayed } = appended
		// The others are told only who and when; a spectator gets the whole event.
		return {
			game: appended.game,
			params: relayed ? { playerId: relayed.playerId, t: relayed.t } : null,
			to: relayed ? 'others' : 'none',
			spectate: relayed ? [relayed] : undefined,
			ack: ackOf(appended.game, ctx.from, [params]),
		}
	},
}

// Most events one mpapi_log_events message may carry.
export const MAX_LOG_BATCH = 50

// {events: [{t, opcode, args?, run?}, ...]} -- up to MAX_LOG_BATCH replay
// events, in order, each handled as mpapi_log_event would. The others are told
// once: {playerId, t, count} of the last event kept, which is all they track
// (how far the stream has got); never the opcode or args, which carry a score. Spectators get every event. One bad
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
		const ack = ackOf(current.game, ctx.from, params.events)
		if (relayed.length === 0) return { game: current.game, params: null, to: 'none', ack }
		const last = relayed[relayed.length - 1]
		return {
			game: current.game,
			params: { playerId: last.playerId, t: last.t, count: relayed.length },
			to: 'others',
			spectate: relayed,
			ack,
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
