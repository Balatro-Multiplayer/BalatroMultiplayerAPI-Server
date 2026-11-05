// The bmp_lobby authoritative match: adapts Nakama's match callbacks to the
// pure rules in state.ts and carries out the Outbound effects they return.
// One match per lobby; the match ends (returns null) once the lobby closes.
import { seedFromHex } from '../actions/registry'
import { finishGame, settle } from '../actions/results'
import { setupTick } from '../actions/setup'
import { activeRunOf } from './active'
import { checkpointOf, readCheckpoint, resumeFrom, saveCheckpoint } from './checkpoint'
import { releaseCode } from './codes'
import {
	CURRENT_LOBBY_COLLECTION,
	CURRENT_LOBBY_KEY,
	ClientOp,
	ServerOp,
	type LobbySignal,
	type MatchedGroup,
	type PlayerInfo,
	type PlayerLog,
	type RunRecord,
} from './protocol'
import { readConfig } from '../config'
import { deleteBinding, dissolveParty, signalHome, writeBinding } from '../matchmaking/group/binding'
import { clearMatched } from '../matchmaking/queue'
import { hasPlayerAnswer, releaseGroups } from './group_queue'
import { answerGroupSignal, isGroupSignal } from './group_signals'
import { type RelayStep, action } from './relay'
import { catchUpLimitMsFor } from './catch_up'
import {
	DEFAULT_GRACE_MS,
	DEFAULT_RESULT_TIMEOUT_MS,
	type Lobby,
	type Outbound,
	type Step,
	adminRemove,
	adminView,
	close,
	disconnect,
	join,
	joinRejection,
	kick,
	labelOf,
	leave,
	newLobby,
	setMetadata,
	setCatchingUp,
	setOwnState,
	setPlayerInfo,
	tick,
} from './state'
import { banNameFor, readProfile, shownNameOf } from '../player/profile'
import { applyRatings } from '../rating/apply'
import { logBounds } from '../rating/metrics'
import { currentSeason } from '../rating/season'
import { enqueue } from '../mirror/outbox'
import { chatCheck, chatPost, reportEvidence } from './chat'
import {
	SPECTATOR_ROLE,
	addSpectator,
	isSpectator,
	removeSpectator,
	spectateRejection,
	spectateRunOf,
} from './spectate'
import { recordRun } from '../achievements/record'
import { sendLateResults, sendRankedResults } from './late_result'
import { holdingsOf } from '../achievements/storage'
import { DEFAULT_AVATAR } from '../shared/avatars/ids'
import { selectableOrDefault } from '../shared/avatars/unlocked'
import { runFlags } from './anticheat'
import { eventsByPlayer, type LogEvent } from '../shared/replay/events'
import { recordForfeit } from './forfeits'
import { logChecksOf, saveRun } from './storage'
import { standingFor } from '../standing/current'
import { pvpVersionOf } from '../standing/pvp_version'
import { readModReport } from '../standing/storage'
import { hasFailedVerdict, readIntegrity } from '../integrity'
import { rejoinRefusal, rejoinRejectMessage } from '../standing/rejoin'
import type { RequiredStanding } from '../standing/standing'
import { settingsOf, type ServerSettings } from '../server_kind'

const TICK_RATE = 5
const MAX_MESSAGE_BYTES = 64 * 1024

export interface LobbyMatchState extends nkruntime.MatchState {
	lobby: Lobby
	// userId -> the presence currently attached.
	presences: { [userId: string]: nkruntime.Presence }
	// Player info from matchJoinAttempt's metadata, consumed by matchJoin
	// (which gets no metadata of its own).
	pendingInfo: { [userId: string]: PlayerInfo }
	// Users let in as spectators by matchJoinAttempt, until matchJoin.
	pendingSpectators?: string[]
	label: string
	// Set once the lobby has checkpointed for a server restart: the next loop
	// ends the match (matchTerminate itself must hand back a state).
	stopping?: boolean
}

function secondsFromEnv(
	ctx: nkruntime.Context,
	name: string,
	fallbackMs: number,
): number {
	const seconds = Number(ctx.env[name])
	return seconds > 0 ? seconds * 1000 : fallbackMs
}

// The per-user record lobby_current reads. Only cleared if it still names
// this match, so a player already in a newer lobby keeps its record.
function writeCurrent(
	nk: nkruntime.Nakama,
	ctx: nkruntime.Context,
	lobby: Lobby,
	userId: string,
) {
	nk.storageWrite([
		{
			collection: CURRENT_LOBBY_COLLECTION,
			key: CURRENT_LOBBY_KEY,
			userId,
			value: { matchId: ctx.matchId, code: lobby.code, modId: lobby.modId },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
}

function clearCurrent(
	nk: nkruntime.Nakama,
	ctx: nkruntime.Context,
	userId: string,
) {
	const key = {
		collection: CURRENT_LOBBY_COLLECTION,
		key: CURRENT_LOBBY_KEY,
		userId,
	}
	const objects = nk.storageRead([key])
	if (objects.length > 0 && objects[0].value.matchId === ctx.matchId) {
		nk.storageDelete([key])
	}
}

// Carries out a Step's effects and returns the new match state, or null once
// the lobby has closed (which ends the match).
function apply(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	state: LobbyMatchState,
	raw: Step,
): LobbyMatchState | null {
	// Already closed: a signal that closed the lobby stored its game but has to
	// hand back the stale pre-close lobby. Any later call on it (the leaver's
	// kicked presence reaching matchLeave, a join, the loop) must not run the
	// stale game's effects again: that stored every abandoned game twice.
	if (state.lobby.closed) return null
	// A lobby that closes mid-game still stores the game.
	let step = raw
	if (step.lobby.closed && step.lobby.game.started) {
		const finished = finishGame(step.lobby, Date.now())
		step = { lobby: finished.lobby, out: step.out.concat(finished.out) }
	}
	// A matchmade lobby's groups go home once its first game is over.
	const released = releaseGroups(state.lobby.game.started !== null, step.lobby)
	step = { lobby: released.lobby, out: step.out.concat(released.out) }
	const presences = { ...state.presences }
	for (const effect of step.out) {
		runEffect(ctx, logger, nk, dispatcher, step.lobby, presences, effect)
	}

	const label = labelOf(step.lobby)
	if (label !== state.label && !step.lobby.closed) {
		dispatcher.matchLabelUpdate(label)
	}

	if (step.lobby.closed) {
		releaseCode(nk, step.lobby.code, ctx.matchId)
		logger.info('Lobby %s closed', step.lobby.code)
		return null
	}
	return { ...state, lobby: step.lobby, presences, label }
}

// A finished run is flagged (lobby/anticheat.ts) and, for a ranked game,
// rated before it's stored, so the run and each player's pointer carry what
// it did to their rating. Each season best is capped at the player's own
// trusted log (rating/metrics.ts logBounds). A rating failure must not lose
// the run, so it leaves the run unrated instead.
function judged(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger,
	run: RunRecord,
	logs: { [userId: string]: PlayerLog },
	events: { [userId: string]: LogEvent[] },
): RunRecord {
	const checks = logChecksOf(run, logs, (input) => nk.sha256Hash(input))
	const flagged = { ...run, flags: runFlags(run, events, checks) }
	if (!run.rankedMode) return flagged
	try {
		return { ...flagged, ratings: applyRatings(nk, logger, run, run.rankedMode, logBounds(events, checks)) }
	} catch (e) {
		logger.error('Could not rate run %s: %v', run.runId, e)
		return flagged
	}
}

function runEffect(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	lobby: Lobby,
	presences: { [userId: string]: nkruntime.Presence },
	effect: Outbound,
) {
	switch (effect.kind) {
		case 'send': {
			const targets = effect.to
				.map((id) => presences[id])
				.filter((p) => p !== undefined)
			// An empty list would mean "everyone" to broadcastMessage.
			if (targets.length > 0) {
				dispatcher.broadcastMessage(
					effect.op,
					JSON.stringify(effect.payload),
					targets,
					null,
					true,
				)
			}
			return
		}
		case 'kick': {
			const presence = presences[effect.userId]
			delete presences[effect.userId]
			if (presence) dispatcher.matchKick([presence])
			return
		}
		case 'setCurrent':
			// A throw here would stop the whole match (as would any effect's).
			try {
				writeCurrent(nk, ctx, lobby, effect.userId)
			} catch (e) {
				logger.warn('Lobby %s: could not record %s as in it: %v', lobby.code, effect.userId, e)
			}
			return
		case 'saveRun': {
			let stored: RunRecord | null = null
			let events: { [userId: string]: LogEvent[] } = {}
			try {
				events = eventsByPlayer(effect.logs)
				const run = judged(nk, logger, effect.run, effect.logs, events)
				saveRun(nk, run, effect.logs)
				stored = run
				enqueue(nk, {
					kind: 'run',
					at: Date.now(),
					runId: run.runId,
					rating: run.rankedMode ? { modId: run.modId, mode: run.rankedMode, season: currentSeason(nk) } : null,
				})
				for (const playerId in run.flags) {
					logger.warn('Lobby %s: run %s: %s is flagged (%s)', lobby.code, run.runId, playerId, run.flags[playerId])
				}
			} catch (e) {
				logger.error(
					'Lobby %s: could not store run %s: %v',
					lobby.code,
					effect.run.runId,
					e,
				)
			}
			if (stored) {
				try {
					// A ranked run tells everyone it rated, leavers included; any other
					// run only tells the leavers of a pending result.
					if (stored.rankedMode) sendRankedResults(nk, stored)
					else sendLateResults(nk, stored, effect.lateResultTo)
				} catch (e) {
					logger.warn('Lobby %s: could not tell leavers the result of run %s: %v', lobby.code, stored.runId, e)
				}
			}
			// Achievements read the stored run; a failure here never touches it.
			if (stored) {
				try {
					recordRun(nk, logger, stored, events)
				} catch (e) {
					logger.error('Lobby %s: could not record achievements for run %s: %v', lobby.code, stored.runId, e)
				}
			}
			return
		}
		case 'contested':
			try {
				enqueue(nk, {
					kind: 'contest',
					at: effect.at,
					runId: effect.runId,
					code: effect.code,
					by: effect.by,
					against: effect.against,
					lobbyKind: effect.lobbyKind,
				})
			} catch (e) {
				logger.warn('Lobby %s: could not record the contest of run %s: %v', lobby.code, effect.runId, e)
			}
			return
		case 'forfeited':
			try {
				recordForfeit(nk, effect.userId, { runId: effect.runId, code: effect.code, at: effect.at, lobbyKind: effect.lobbyKind })
			} catch (e) {
				logger.warn('Lobby %s: could not record %s timing out: %v', lobby.code, effect.userId, e)
			}
			return
		case 'groupBind':
			try {
				writeBinding(nk, { partyId: effect.partyId, homeCode: lobby.code, modId: lobby.modId, memberIds: effect.memberIds })
			} catch (e) {
				logger.warn('Lobby %s: could not bind party %s: %v', lobby.code, effect.partyId, e)
			}
			return
		case 'groupUnbind':
			try {
				deleteBinding(nk, effect.partyId, effect.memberIds)
				clearMatched(nk, lobby.modId, effect.gameMode, effect.memberIds)
				dissolveParty(nk, effect.partyId)
			} catch (e) {
				logger.warn('Lobby %s: could not unbind party %s: %v', lobby.code, effect.partyId, e)
			}
			return
		case 'groupDissolve':
			try {
				dissolveParty(nk, effect.partyId)
			} catch (e) {
				logger.warn('Lobby %s: could not break up party %s: %v', lobby.code, effect.partyId, e)
			}
			return
		case 'awayOver':
			try {
				signalHome(nk, effect.homeCode, { type: 'away_over', partyId: effect.partyId, code: lobby.code })
			} catch (e) {
				logger.warn('Lobby %s: could not send group %s home to %s: %v', lobby.code, effect.partyId, effect.homeCode, e)
			}
			return
		case 'clearCurrent':
			try {
				clearCurrent(nk, ctx, effect.userId)
			} catch (e) {
				logger.warn(
					'Lobby %s: could not clear current lobby of %s: %v',
					lobby.code,
					effect.userId,
					e,
				)
			}
			return
	}
}

function stringParam(params: { [key: string]: unknown }, key: string): string {
	const value = params[key]
	return typeof value === 'string' ? value : ''
}

function jsonParam(params: { [key: string]: unknown }, key: string): unknown {
	const raw = stringParam(params, key)
	if (!raw) return null
	try {
		return JSON.parse(raw)
	} catch (e) {
		return null
	}
}

// matchmakerMatched's groups param: [{partyId, homeCode, memberIds}].
function groupsParam(params: { [key: string]: unknown }): MatchedGroup[] | undefined {
	const value = jsonParam(params, 'groups')
	if (!Array.isArray(value) || value.length === 0) return undefined
	return value.filter(
		(g) => g && typeof g.partyId === 'string' && typeof g.homeCode === 'string' && Array.isArray(g.memberIds),
	)
}

// matchmakerMatched's teamPlan param: two arrays of player ids.
function teamPlanParam(params: { [key: string]: unknown }): [string[], string[]] | null {
	const value = jsonParam(params, 'teamPlan')
	if (!Array.isArray(value) || value.length !== 2 || !value.every((t) => Array.isArray(t))) return null
	return [value[0], value[1]]
}

// matchmakerMatched's requiredStanding param.
function requiredStandingParam(params: { [key: string]: unknown }): RequiredStanding | undefined {
	const value = stringParam(params, 'requiredStanding')
	return value === 'valid' || value === 'verified' ? value : undefined
}

export function lobbyMatchInit(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	params: { [key: string]: unknown },
) {
	const resumeCode = stringParam(params, 'resumeCode')
	const found = resumeCode ? readCheckpoint(nk, resumeCode) : null
	const lobby = found ? resumeFrom(found.checkpoint, Date.now()) : newLobby({
		code: stringParam(params, 'code'),
		modId: stringParam(params, 'modId'),
		maxPlayers: Number(params.maxPlayers),
		creatorId: stringParam(params, 'creatorId'),
		rankedMode: stringParam(params, 'rankedMode') || undefined,
		allowedIds: stringParam(params, 'allowedIds')
			? stringParam(params, 'allowedIds').split(',')
			: undefined,
		gameMode: stringParam(params, 'gameMode') || undefined,
		groups: groupsParam(params),
		teamPlan: teamPlanParam(params),
		requiredStanding: requiredStandingParam(params),
		now: Date.now(),
		graceMs: secondsFromEnv(ctx, 'LOBBY_GRACE_SECONDS', DEFAULT_GRACE_MS),
		catchUpLimitMs: catchUpLimitMsFor(stringParam(params, 'modId'), Number(ctx.env.LOBBY_CATCH_UP_LIMIT_SECONDS) || undefined),
		resultTimeoutMs: secondsFromEnv(
			ctx,
			'RESULT_TIMEOUT_SECONDS',
			DEFAULT_RESULT_TIMEOUT_MS,
		),
	})
	const label = labelOf(lobby)
	const state: LobbyMatchState = {
		lobby,
		presences: {},
		pendingInfo: {},
		label,
	}
	if (found) logger.info('Lobby %s resumed for %s', lobby.code, lobby.modId)
	else logger.info('Lobby %s created for %s', lobby.code, lobby.modId)
	return { state, tickRate: TICK_RATE, label }
}

function parseMods(raw: string | undefined): unknown {
	if (!raw) return null
	try {
		return JSON.parse(raw)
	} catch (e) {
		return null
	}
}

// The joining player's info. Their profile (player/profile.ts), once they
// have logged in through session_init, decides the name and joker; the
// metadata only fills in for players who logged in through the API, and for
// mods.
export function joinInfoOf(
	nk: nkruntime.Nakama,
	settings: ServerSettings,
	presence: nkruntime.Presence,
	meta: { [key: string]: string },
): PlayerInfo {
	const sentMods = parseMods(meta.mods)
	// Never the client's word for it (a standing in meta is ignored).
	const standing = standingFor(nk, settings, presence.userId, Date.now()).standing
	const report = readModReport(nk, presence.userId)
	const pvpVersion = pvpVersionOf(report ? report.mods : [])
	const stored = readProfile(nk, presence.userId, presence.username)
	// The joker is never taken from the join metadata: only the stored pick,
	// if the player may still show it.
	const joker = stored
		? selectableOrDefault(stored.profile.preferredJoker, holdingsOf(nk, presence.userId, stored.profile.privileges))
		: DEFAULT_AVATAR
	if (stored && stored.profile.nakamaLogin) {
		return {
			displayName: shownNameOf(nk, presence.userId, stored.profile),
			preferredJoker: joker,
			mods: sentMods !== null ? sentMods : stored.profile.mods,
			standing,
			pvpVersion,
		}
	}
	return {
		displayName: banNameFor(nk, presence.userId) ?? (meta.displayName || presence.username),
		preferredJoker: joker,
		mods: sentMods,
		standing,
		pvpVersion,
	}
}

function accountExists(nk: nkruntime.Nakama, userId: string): boolean {
	try {
		nk.accountGetId(userId)
		return true
	} catch (e) {
		return false
	}
}

// One lobby at a time: a player whose current-lobby record names another
// live match they are still in must leave that one first -- unless that is
// their home lobby, whose group is away here (it answers 'away').
function otherLobbyOf(
	nk: nkruntime.Nakama,
	ctx: nkruntime.Context,
	userId: string,
): string | null {
	const objects = nk.storageRead([
		{ collection: CURRENT_LOBBY_COLLECTION, key: CURRENT_LOBBY_KEY, userId },
	])
	if (objects.length === 0) return null
	const matchId = objects[0].value.matchId
	if (
		typeof matchId !== 'string' ||
		matchId === ctx.matchId ||
		!nk.matchGet(matchId)
	)
		return null
	const signal: LobbySignal = { type: 'has_player', userId, forMatchId: ctx.matchId }
	return nk.matchSignal(matchId, JSON.stringify(signal)) === 'yes'
		? String(objects[0].value.code)
		: null
}

export function lobbyMatchJoinAttempt(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: LobbyMatchState,
	presence: nkruntime.Presence,
	metadata: { [key: string]: string },
) {
	const meta = metadata || {}
	// A deleted account's session token stays valid until it expires, and
	// its socket can still reach here; seating it would fail the per-user
	// storage writes (no users row) and stop the match for everyone.
	if (!accountExists(nk, presence.userId)) {
		return { state, accept: false, rejectMessage: 'No such account' }
	}
	if (meta.role === SPECTATOR_ROLE) {
		const refused = spectateRejection(state.lobby, presence.userId, meta.modId || '')
		if (refused) return { state, accept: false, rejectMessage: refused }
		const pending = (state.pendingSpectators || []).filter((id) => id !== presence.userId)
		return {
			state: { ...state, pendingSpectators: pending.concat([presence.userId]) },
			accept: true,
		}
	}
	const rejection = joinRejection(
		state.lobby,
		presence.userId,
		meta.modId || '',
	)
	if (rejection) {
		return { state, accept: false, rejectMessage: rejection }
	}
	const standingRefused = rejoinRefusal(
		state.lobby.requiredStanding,
		standingFor(nk, settingsOf(ctx), presence.userId, Date.now()),
		hasFailedVerdict(readIntegrity(nk, presence.userId)),
	)
	if (standingRefused) {
		// The seat stays: a returning player's grace period keeps running, so
		// they can fix their mods (or wait for the verdict) and come back.
		logger.info('Lobby %s refused %s: %s', state.lobby.code, presence.userId, standingRefused.reason)
		return { state, accept: false, rejectMessage: rejoinRejectMessage(standingRefused) }
	}
	const otherCode = otherLobbyOf(nk, ctx, presence.userId)
	if (otherCode) {
		return {
			state,
			accept: false,
			rejectMessage: `Already in lobby ${otherCode}`,
		}
	}

	const info = joinInfoOf(nk, settingsOf(ctx), presence, meta)
	return {
		state: {
			...state,
			pendingInfo: { ...state.pendingInfo, [presence.userId]: info },
		},
		accept: true,
	}
}

export function lobbyMatchJoin(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: LobbyMatchState,
	presences: nkruntime.Presence[],
) {
	let current: LobbyMatchState | null = state
	for (const presence of presences) {
		if (!current) break
		const pendingSpectators = current.pendingSpectators || []
		if (pendingSpectators.indexOf(presence.userId) !== -1) {
			const watching = {
				...current,
				pendingSpectators: pendingSpectators.filter((id) => id !== presence.userId),
				presences: { ...current.presences, [presence.userId]: presence },
			}
			current = apply(ctx, logger, nk, dispatcher, watching, addSpectator(watching.lobby, presence.userId))
			continue
		}
		const pendingInfo = { ...current.pendingInfo }
		const info = pendingInfo[presence.userId] || {
			displayName: presence.username,
			preferredJoker: null,
			mods: null,
		}
		delete pendingInfo[presence.userId]
		const attached = {
			...current,
			pendingInfo,
			presences: { ...current.presences, [presence.userId]: presence },
		}
		current = apply(
			ctx,
			logger,
			nk,
			dispatcher,
			attached,
			join(attached.lobby, presence.userId, presence.sessionId, info, Date.now()),
		)
	}
	return current ? { state: current } : null
}

export function lobbyMatchLeave(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: LobbyMatchState,
	presences: nkruntime.Presence[],
) {
	let current: LobbyMatchState | null = state
	const now = Date.now()
	for (const presence of presences) {
		if (!current) break
		const attached = current.presences[presence.userId]
		if (attached && attached.sessionId === presence.sessionId) {
			const remaining: { [userId: string]: nkruntime.Presence } = { ...current.presences }
			delete remaining[presence.userId]
			current = { ...current, presences: remaining }
		}
		if (isSpectator(current.lobby, presence.userId)) {
			if (attached && attached.sessionId === presence.sessionId)
				current = apply(ctx, logger, nk, dispatcher, current, removeSpectator(current.lobby, presence.userId))
			continue
		}
		current = apply(
			ctx,
			logger,
			nk,
			dispatcher,
			current,
			disconnect(current.lobby, presence.userId, presence.sessionId, now),
		)
	}
	return current ? { state: current } : null
}

function parseMessage(
	nk: nkruntime.Nakama,
	message: nkruntime.MatchMessage,
): { [key: string]: unknown } | null {
	if (message.data.byteLength > MAX_MESSAGE_BYTES) return null
	try {
		const data = JSON.parse(nk.binaryToString(message.data))
		// Lua JSON encoders can't tell an empty object from an empty array,
		// so a payload-less op from the game arrives as [].
		if (Array.isArray(data)) return data.length === 0 ? {} : null
		return typeof data === 'object' && data !== null ? data : null
	} catch (e) {
		return null
	}
}

function stepForMessage(
	nk: nkruntime.Nakama,
	lobby: Lobby,
	senderId: string,
	opCode: number,
	data: { [key: string]: unknown },
): RelayStep | null {
	switch (opCode) {
		case ClientOp.ACTION:
			return action(lobby, senderId, data, {
				now: Date.now(),
				newSeed: () => seedFromHex(nk.uuidv4()),
				newId: () => nk.uuidv4(),
				random: Math.random,
			})
		case ClientOp.LEAVE:
			if (isSpectator(lobby, senderId)) {
				const stopped = removeSpectator(lobby, senderId)
				return { lobby: stopped.lobby, out: [{ kind: 'kick', userId: senderId }] }
			}
			return leave(lobby, senderId)
		case ClientOp.KICK:
			return kick(
				lobby,
				senderId,
				typeof data.playerId === 'string' ? data.playerId : '',
			)
		case ClientOp.SET_METADATA:
			return setMetadata(lobby, senderId, data.metadata)
		case ClientOp.SET_STATE:
			return setOwnState(
				lobby,
				senderId,
				data.state === undefined ? null : data.state,
			)
		case ClientOp.SPECTATE_VIEW:
			return typeof data.playerId === 'string'
				? spectateRunOf(
						lobby,
						senderId,
						data.playerId,
						(input) => nk.sha256Hash(input),
						data.fromStart === true,
					)
				: null
		case ClientOp.CATCHING_UP:
			return setCatchingUp(lobby, senderId, data.catchingUp === true, Date.now())
		default:
			return null
	}
}

export function lobbyMatchLoop(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: LobbyMatchState,
	messages: nkruntime.MatchMessage[],
) {
	// A signal that closed the lobby (the last player leaving, an admin close)
	// already stored its game and released its code, but a signal can't end the
	// match, so it hands back the pre-close lobby marked closed. Ending here
	// keeps that stale lobby -- whose game still looks started -- from being
	// finished and stored a second time.
	if (state.stopping || state.lobby.closed) return null
	let current: LobbyMatchState | null = state
	for (const message of messages) {
		if (!current) break
		const data = parseMessage(nk, message)
		const step =
			data &&
			stepForMessage(
				nk,
				current.lobby,
				message.sender.userId,
				message.opCode,
				data,
			)
		if (!step) {
			logger.warn(
				'Lobby %s: dropped op %d from %s',
				current.lobby.code,
				message.opCode,
				message.sender.userId,
			)
			continue
		}
		if (step.refused) {
			logger.warn(
				'Lobby %s: refused %s from %s (%s)',
				current.lobby.code,
				step.refused.key,
				message.sender.userId,
				step.refused.reason,
			)
		}
		if (step.dropped) {
			const d = step.dropped
			logger.warn(
				'Lobby %s: dropped %s from %s (%s; host %s%s)',
				current.lobby.code,
				d.key,
				d.from,
				d.kind,
				d.hostId,
				d.kind === 'not_self' ? `; claimed ${d.claimed}` : '',
			)
		}
		current = apply(ctx, logger, nk, dispatcher, current, step)
	}
	if (!current) return null
	const now = Date.now()
	const ticked = apply(ctx, logger, nk, dispatcher, current, tick(current.lobby, now))
	if (!ticked) return null
	const setupTicked = apply(
		ctx,
		logger,
		nk,
		dispatcher,
		ticked,
		setupTick(ticked.lobby, now, Math.random),
	)
	if (!setupTicked) return null
	const settled = apply(
		ctx,
		logger,
		nk,
		dispatcher,
		setupTicked,
		settle(setupTicked.lobby, now),
	)
	return settled ? { state: settled } : null
}

export function lobbyMatchSignal(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: LobbyMatchState,
	data: string,
) {
	let signal: LobbySignal
	try {
		signal = JSON.parse(data)
	} catch (e) {
		return { state, data: 'bad_signal' }
	}
	if (signal.type === 'has_player') {
		return { state, data: hasPlayerAnswer(state.lobby, signal.userId, signal.forMatchId) }
	}
	if (isGroupSignal(signal)) {
		const answer = answerGroupSignal(state.lobby, signal, readConfig(nk), Date.now())
		const next = apply(ctx, logger, nk, dispatcher, state, answer.step)
		return { state: next || { ...state, lobby: { ...state.lobby, closed: true } }, data: answer.reply }
	}
	if (signal.type === 'get_active') {
		return {
			state,
			data: JSON.stringify(
				activeRunOf(state.lobby, signal.userId, (input) =>
					nk.sha256Hash(input),
				),
			),
		}
	}
	if (signal.type === 'chat_check') {
		const check = chatCheck(state.lobby, signal.userId, Date.now())
		if (!check.ok) return { state, data: JSON.stringify({ error: check.reason }) }
		return {
			state: { ...state, lobby: check.lobby },
			data: JSON.stringify({
				code: check.lobby.code,
				displayName: check.displayName,
				context: check.context,
			}),
		}
	}
	if (signal.type === 'chat_post') {
		const next = apply(
			ctx,
			logger,
			nk,
			dispatcher,
			state,
			chatPost(state.lobby, signal.userId, signal.text, Date.now()),
		)
		return { state: next || state, data: 'ok' }
	}
	if (signal.type === 'player_info') {
		const next = apply(
			ctx,
			logger,
			nk,
			dispatcher,
			state,
			setPlayerInfo(state.lobby, signal.userId, signal.info),
		)
		return { state: next || state, data: 'ok' }
	}
	if (signal.type === 'admin_remove') {
		const member = state.lobby.players.some((p) => p.id === signal.userId)
		const next = apply(
			ctx,
			logger,
			nk,
			dispatcher,
			state,
			adminRemove(state.lobby, signal.userId, signal.reason, signal.onlyIfStarted === true),
		)
		return {
			state: next || { ...state, lobby: { ...state.lobby, closed: true } },
			data: member ? 'ok' : 'not_member',
		}
	}
	if (signal.type === 'report_evidence') {
		const check = reportEvidence(state.lobby, signal.reporterId, signal.reportedId)
		return { state, data: JSON.stringify(check.ok ? check.evidence : { error: check.reason }) }
	}
	if (signal.type === 'admin_view') return { state, data: JSON.stringify(adminView(state.lobby)) }
	if (signal.type === 'admin_close') {
		const next = apply(ctx, logger, nk, dispatcher, state, close(state.lobby))
		return {
			state: next || { ...state, lobby: { ...state.lobby, closed: true } },
			data: 'ok',
		}
	}
	if (signal.type === 'leave') {
		const next = apply(
			ctx,
			logger,
			nk,
			dispatcher,
			state,
			leave(state.lobby, signal.userId),
		)
		// A closed lobby's match ends at its next loop, which finds it closed.
		return {
			state: next || { ...state, lobby: { ...state.lobby, closed: true } },
			data: 'ok',
		}
	}
	return { state, data: 'bad_signal' }
}

export function lobbyMatchTerminate(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	dispatcher: nkruntime.MatchDispatcher,
	tickNumber: number,
	state: LobbyMatchState,
	graceSeconds: number,
) {
	// A server shutdown (shutdown_grace_sec > 0): keep the lobby for the
	// server that comes back (lobby/checkpoint.ts) rather than closing it,
	// so a running game isn't ended as abandoned.
	if (graceSeconds > 0) {
		const checkpoint = checkpointOf(state.lobby, Date.now())
		if (checkpoint) {
			try {
				saveCheckpoint(nk, checkpoint)
				const targets = Object.keys(state.presences).map((id) => state.presences[id])
				if (targets.length > 0)
					dispatcher.broadcastMessage(
						ServerOp.SERVER_RESTARTING,
						JSON.stringify({ graceSeconds }),
						targets,
						null,
						true,
					)
				logger.info('Lobby %s checkpointed for the restart', state.lobby.code)
				return { state: { ...state, stopping: true } }
			} catch (e) {
				logger.error('Lobby %s: could not checkpoint: %v', state.lobby.code, e)
			}
		}
	}
	apply(ctx, logger, nk, dispatcher, state, close(state.lobby))
	return { state }
}
