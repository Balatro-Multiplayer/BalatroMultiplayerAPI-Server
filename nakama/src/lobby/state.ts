// The lobby rules, as pure functions over plain data: no Nakama calls, no
// clock (callers pass `now`), and every transition returns a new Lobby
// instead of mutating. Nakama round-trips match state through Go between
// calls, where Set/Map values are lost and in-place nested mutation can
// silently not stick, so the state holds only plain objects and arrays.
import type { TeamPlan } from '../matchmaking/group/teams'
import type { RequiredStanding } from '../standing/standing'
import { type LobbyKind, lobbyKindOf } from '../review/ranked'
import { replayTailOf } from './active'
import { CATCH_UP_LIMIT_REASON } from './catch_up'
import { setupOf, setupView } from '../actions/setup'
import {
	endGroup,
	groupAwayCapped,
	groupReturned,
	isParked,
	memberDisconnected,
	memberGone,
	viewOf,
	type GroupOutbound,
	type GroupQueue,
} from './group_queue'
import {
	type GameState,
	type LobbyEventMessage,
	type GroupEndReason,
	type LobbyEventType,
	type MatchedGroup,
	type PlayerInfo,
	type PlayerLog,
	type RunRecord,
	ServerOp,
	type Snapshot,
} from './protocol'

export const DEFAULT_GRACE_MS = 120_000
// How long a started game waits for the rest of its results once the first
// report is in (or once it's down to fewer than two players).
export const DEFAULT_RESULT_TIMEOUT_MS = 60_000
// A created lobby nobody joins (the creator's client crashed between the
// create RPC and match_join) closes after this long.
export const CREATOR_JOIN_TIMEOUT_MS = 30_000
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 128

export interface ChatLine {
	senderId: string
	text: string
	// Absent on lines kept before reports needed them.
	displayName?: string
	at?: number
}

export interface LobbyPlayer {
	id: string
	// The presence currently attached; a stale session's leave is ignored.
	sessionId: string
	info: PlayerInfo
	awaySince: number | null
	// When the player said it was catching up (ClientOp.CATCHING_UP); null when
	// it is not. A join clears it: the new session reports again. A checkpoint
	// written before this field has none: read it through isCatchingUp.
	catchingUpSince: number | null
	ownState: unknown
}

export interface Lobby {
	code: string
	modId: string
	maxPlayers: number
	creatorId: string
	hostId: string
	// Set when the lobby was created ranked: the rating board its games count on.
	rankedMode?: string
	// Set when the matchmaker made the lobby: only these players may take a
	// seat, and each may do so before the first of them has arrived.
	allowedIds?: string[]
	// The queue a matchmade lobby came from, as the API keys it ('mode' or
	// 'ranked:mode'); queue_counts counts its players as in a match.
	gameMode?: string
	// Watching, not playing (spectate.ts): never seated, counted or ready.
	spectators?: string[]
	metadata: { [key: string]: unknown }
	// In join order: host transfer picks the earliest eligible player.
	players: LobbyPlayer[]
	kickedIds: string[]
	createdAt: number
	graceMs: number
	// How long a seat may stay "catching up" before it is forfeited (lobby/catch_up.ts);
	// null or absent: no limit.
	catchUpLimitMs?: number | null
	resultTimeoutMs: number
	closed: boolean
	// Owned by the authoritative actions (src/actions).
	game: GameState
	// The last few approved chat lines (chat.ts): the moderation context, and
	// a report's evidence.
	chat?: ChatLine[]
	// The last finished game's run, for a report filed after it ended.
	lastRunId?: string
	// userId -> the sender's ACTION rate-limit bucket (relay.ts).
	actionBudget: { [userId: string]: { tokens: number; at: number } }
	// A private lobby queueing as a group (group_queue.ts); absent or null
	// while it isn't.
	groupQueue?: GroupQueue | null
	// A matchmade lobby: the groups it was made with, whose home lobbies are
	// told (once: groupsReleased) when its first game is over.
	groups?: MatchedGroup[]
	groupsReleased?: boolean
	// A matchmade Teams game's teams.
	teamPlan?: TeamPlan | null
	// A matchmade lobby: the standing its players queued with, which a
	// returning player must have again (lobby/match.ts). Fixed when the match
	// is planned, so a config change can't move the bar mid-game; absent on
	// a private lobby (never gated) and on one made before standings existed.
	requiredStanding?: RequiredStanding
	// userId -> the runId of the game whose grace period forfeited their seat.
	// The seat is gone, but the player must not be seated again as a fresh
	// joiner (joinRejection), so the record stays after the game ends.
	forfeitedSeats?: { [userId: string]: string }
}

export type Outbound =
	| { kind: 'send'; op: number; payload: unknown; to: string[] }
	| { kind: 'kick'; userId: string }
	| { kind: 'setCurrent'; userId: string }
	| { kind: 'clearCurrent'; userId: string }
	// A matchmade game's participant timed out (lobby/forfeits.ts).
	| { kind: 'forfeited'; userId: string; runId: string; code: string; at: number; lobbyKind: LobbyKind }
	| {
			kind: 'saveRun'
			run: RunRecord
			logs: { [userId: string]: PlayerLog }
			// Participants no longer seated when a once-pending run settled:
			// they are told the result (lobby/late_result.ts).
			lateResultTo: string[]
	  }
	| GroupOutbound

export interface Step {
	lobby: Lobby
	out: Outbound[]
}

export function newLobby(params: {
	code: string
	modId: string
	maxPlayers: number
	creatorId: string
	rankedMode?: string
	allowedIds?: string[]
	gameMode?: string
	groups?: MatchedGroup[]
	teamPlan?: TeamPlan | null
	requiredStanding?: RequiredStanding
	now: number
	graceMs: number
	catchUpLimitMs?: number | null
	resultTimeoutMs?: number
}): Lobby {
	return {
		code: params.code,
		modId: params.modId,
		maxPlayers: params.maxPlayers,
		creatorId: params.creatorId,
		hostId: params.creatorId,
		rankedMode: params.rankedMode,
		allowedIds: params.allowedIds,
		gameMode: params.gameMode,
		metadata: {},
		players: [],
		kickedIds: [],
		createdAt: params.now,
		graceMs: params.graceMs,
		catchUpLimitMs: params.catchUpLimitMs ?? null,
		resultTimeoutMs: params.resultTimeoutMs ?? DEFAULT_RESULT_TIMEOUT_MS,
		closed: false,
		game: emptyGame(),
		actionBudget: {},
		groups: params.groups,
		teamPlan: params.teamPlan,
		requiredStanding: params.requiredStanding,
	}
}

// No game running: nobody ready, no reports, no logs.
export function emptyGame(): GameState {
	return {
		ready: {},
		started: null,
		reports: {},
		reportOrder: [],
		settleFrom: null,
		logs: {},
	}
}

// Whether userId is one of the players who started the running game.
export function isParticipant(lobby: Lobby, userId: string): boolean {
	const started = lobby.game.started
	return !!started && started.players.some((p) => p.id === userId)
}

// The API's lobby types: the matchmaker makes 'public' lobbies, players make
// 'private' ones by code.
export function lobbyType(lobby: Lobby): 'public' | 'private' {
	return lobby.allowedIds ? 'public' : 'private'
}

// Public lobbies can always be watched; a private one when its host has set
// metadata.spectatable (as the API's /lobbies/spectatable decides).
export function isSpectatable(lobby: Lobby): boolean {
	return lobbyType(lobby) === 'public' || lobby.metadata.spectatable === true
}

// The match label, searchable with matchList queries (e.g.
// +label.modId:X +label.spectatable:T).
export function labelOf(lobby: Lobby): string {
	return JSON.stringify({
		code: lobby.code,
		modId: lobby.modId,
		type: lobbyType(lobby),
		mode: lobby.gameMode || '',
		open:
			!lobby.closed &&
			lobby.game.started === null &&
			lobby.players.length < lobby.maxPlayers,
		started: lobby.game.started !== null,
		size: lobby.players.length,
		max: lobby.maxPlayers,
		spectatable: isSpectatable(lobby),
		spectators: (lobby.spectators || []).length,
	})
}

export function findPlayer(
	lobby: Lobby,
	userId: string,
): LobbyPlayer | undefined {
	for (const p of lobby.players) {
		if (p.id === userId) return p
	}
	return undefined
}

function allIds(lobby: Lobby): string[] {
	return lobby.players.map((p) => p.id)
}

function othersThan(lobby: Lobby, userId: string): string[] {
	return allIds(lobby).filter((id) => id !== userId)
}

function event(
	lobby: Lobby,
	type: LobbyEventType,
	fields: Omit<LobbyEventMessage, 'type' | 'lobbyCode'>,
	to: string[],
): Outbound {
	const payload: LobbyEventMessage = { type, lobbyCode: lobby.code, ...fields }
	return { kind: 'send', op: ServerOp.EVENT, payload, to }
}

function rejectOp(userId: string, message: string): Outbound {
	return {
		kind: 'send',
		op: ServerOp.ERROR,
		payload: { message },
		to: [userId],
	}
}

export const DIFFERENT_MOD = 'Lobby is for a different mod'
// MPAPI matches this text to show the forfeit dialog
// (ui/forfeited_notice_overlay.lua, MPAPI.is_forfeited_refusal): change both
// together.
export const FORFEITED_SEAT = 'You forfeited this match'

// Why userId may not join, or null. A member rejoining (after a disconnect)
// is let back in, but only from the lobby's own mod: one seat per user spans
// every mod, so the seat's mod must not be mistaken for another one's.
export function joinRejection(
	lobby: Lobby,
	userId: string,
	modId: string,
): string | null {
	if (lobby.closed) return 'Lobby is closed'
	if (modId !== lobby.modId) return DIFFERENT_MOD
	if (findPlayer(lobby, userId)) return null
	if ((lobby.spectators || []).indexOf(userId) !== -1)
		return 'You are spectating this lobby'
	if (lobby.kickedIds.indexOf(userId) !== -1)
		return 'You were kicked from this lobby'
	if (forfeitedStill(lobby, userId)) return FORFEITED_SEAT
	if (lobby.game.started) return 'The game has already started'
	if (lobby.groupQueue) return 'This lobby is queueing as a group'
	if (lobby.allowedIds) {
		if (lobby.allowedIds.indexOf(userId) === -1)
			return 'This lobby is reserved for matched players'
	} else if (lobby.players.length === 0 && userId !== lobby.creatorId) {
		return 'Lobby is not open yet'
	}
	if (lobby.players.length >= lobby.maxPlayers) return 'Lobby is full'
	return null
}

// Whether userId lost their seat to the grace period in the game that is
// running or that has just ended. A newer game makes the record stale.
function forfeitedStill(lobby: Lobby, userId: string): boolean {
	const runId = (lobby.forfeitedSeats || {})[userId]
	if (runId === undefined) return false
	const started = lobby.game.started
	return started === null || started.runId === runId
}

export function isCatchingUp(player: LobbyPlayer): boolean {
	return typeof player.catchingUpSince === 'number'
}

// `now` times an open Setup step (its msLeft) and is the snapshot's serverNow.
export function snapshotFor(lobby: Lobby, userId: string, now: number = Date.now()): Snapshot {
	const self = findPlayer(lobby, userId)
	return {
		code: lobby.code,
		modId: lobby.modId,
		hostId: lobby.hostId,
		maxPlayers: lobby.maxPlayers,
		type: lobby.rankedMode ? 'ranked' : lobby.allowedIds ? 'public' : 'private',
		metadata: lobby.metadata,
		players: lobby.players.map((p) => ({
			id: p.id,
			displayName: p.info.displayName,
			preferredJoker: p.info.preferredJoker,
			mods: p.info.mods,
			standing: p.info.standing || null,
			isAway: p.awaySince !== null,
			catchingUp: isCatchingUp(p),
		})),
		ownState: self ? self.ownState : null,
		game: {
			ready: lobby.game.ready,
			started: lobby.game.started,
			reported: Object.keys(lobby.game.reports),
			setup: setupView(setupOf(lobby.game), now),
		},
		groupQueue: viewOf(lobby),
		teamPlan: lobby.teamPlan || null,
		graceSeconds: Math.ceil(lobby.graceMs / 1000),
		serverNow: now,
	}
}

// Call after joinRejection returned null.
export function join(
	lobby: Lobby,
	userId: string,
	sessionId: string,
	info: PlayerInfo,
	now: number = Date.now(),
): Step {
	const existing = findPlayer(lobby, userId)
	if (existing) {
		const wasAway = existing.awaySince !== null
		const wasCatchingUp = isCatchingUp(existing)
		const back: LobbyPlayer = { ...existing, sessionId, awaySince: null, catchingUpSince: null }
		const next = {
			...lobby,
			players: lobby.players.map((p) => (p.id === userId ? back : p)),
		}
		// Back from somewhere else (a group's public game) their current-lobby
		// record names that lobby, so it is written again.
		const out: Outbound[] = [
			{ kind: 'setCurrent', userId },
			{
				kind: 'send',
				op: ServerOp.SNAPSHOT,
				payload: snapshotFor(next, userId, now),
				to: [userId],
			},
		]
		if (wasAway) {
			out.push(
				event(
					next,
					'player_reconnected',
					{ playerId: userId, displayName: back.info.displayName },
					othersThan(next, userId),
				),
			)
			// The others' events it missed while away.
			const tail = replayTailOf(next, userId)
			if (tail) out.push({ kind: 'send', op: ServerOp.REPLAY_TAIL, payload: tail, to: [userId] })
		}
		if (wasCatchingUp) out.push(catchingUpEvent(next, userId, false))
		return then({ lobby: next, out }, groupReturned)
	}

	const player: LobbyPlayer = {
		id: userId,
		sessionId,
		info,
		awaySince: null,
		catchingUpSince: null,
		ownState: null,
	}
	// A matchmade lobby has no creator to wait for: whoever arrives first hosts.
	const next = {
		...lobby,
		hostId:
			lobby.allowedIds && lobby.players.length === 0 ? userId : lobby.hostId,
		players: lobby.players.concat([player]),
	}
	const others = othersThan(next, userId)
	return {
		lobby: next,
		out: [
			{ kind: 'setCurrent', userId },
			{
				kind: 'send',
				op: ServerOp.SNAPSHOT,
				payload: snapshotFor(next, userId, now),
				to: [userId],
			},
			event(
				next,
				'player_joined',
				{ playerId: userId, displayName: info.displayName },
				others,
			),
			{
				kind: 'send',
				op: ServerOp.PLAYER_INFO,
				payload: { playerId: userId, info },
				to: others,
			},
		],
	}
}

function catchingUpEvent(lobby: Lobby, userId: string, catchingUp: boolean): Outbound {
	const player = findPlayer(lobby, userId)
	return event(
		lobby,
		'player_catching_up',
		{ playerId: userId, displayName: player ? player.info.displayName : undefined, data: { catchingUp } },
		othersThan(lobby, userId),
	)
}

// The player says it is replaying its own run after a crash (it has joined, so
// its seat is safe) or that it has caught up. Only the others are told, and
// only on a change: a repeat keeps the first time.
export function setCatchingUp(lobby: Lobby, userId: string, catchingUp: boolean, now: number): Step {
	const player = findPlayer(lobby, userId)
	if (!player || isCatchingUp(player) === catchingUp) return { lobby, out: [] }
	const next = {
		...lobby,
		players: lobby.players.map((p) => (p.id === userId ? { ...p, catchingUpSince: catchingUp ? now : null } : p)),
	}
	return { lobby: next, out: [catchingUpEvent(next, userId, catchingUp)] }
}

// step, then f on its lobby: their effects in order.
function then(step: Step, f: (lobby: Lobby) => Step): Step {
	const next = f(step.lobby)
	return { lobby: next.lobby, out: step.out.concat(next.out) }
}

// The actionBudget key of a player's replay-log bucket (relay.ts), separate
// so a busy log stream can't starve their other actions.
export function logBudgetKey(userId: string): string {
	return `${userId}:log`
}

// Next host after `leavingId`: the earliest-joined player still connected.
// While the lobby's group is away nobody is, so the earliest player at all.
function nextHost(lobby: Lobby, leavingId: string): string | null {
	const parked = isParked(lobby)
	for (const p of lobby.players) {
		if (p.id !== leavingId && (p.awaySince === null || parked)) return p.id
	}
	return null
}

function transferHostFrom(lobby: Lobby, userId: string): Step {
	if (lobby.hostId !== userId) return { lobby, out: [] }
	const hostId = nextHost(lobby, userId)
	if (!hostId) return { lobby, out: [] }
	const next = { ...lobby, hostId }
	return {
		lobby: next,
		out: [event(next, 'host_changed', { playerId: hostId }, allIds(next))],
	}
}

export function close(lobby: Lobby): Step {
	if (lobby.closed) return { lobby, out: [] }
	const ended = endGroup(lobby, 'lobby_closed')
	const next = { ...ended.lobby, closed: true }
	// Spectators hear it too: the match ends with it.
	const out: Outbound[] = [
		event(next, 'lobby_closed', {}, allIds(next).concat(next.spectators || [])),
	]
	for (const id of allIds(next)) out.push({ kind: 'clearCurrent', userId: id })
	return { lobby: next, out: ended.out.concat(out) }
}

// A lobby nobody is connected to any more is closed straight away rather than
// waiting out every player's grace period -- unless its group is away, which
// is everyone gone on purpose.
function closeIfAbandoned(step: Step): Step {
	const lobby = step.lobby
	if (lobby.closed || isParked(lobby)) return step
	const anyoneHere = lobby.players.some((p) => p.awaySince === null)
	if (anyoneHere) return step
	const closed = close(lobby)
	return { lobby: closed.lobby, out: step.out.concat(closed.out) }
}

// Drops userId from the roster: `type` is the event the others get
// (player_left, or none when the caller already announced a kick), `why`
// what it does to the lobby's group queue.
function remove(
	lobby: Lobby,
	userId: string,
	type: 'player_left' | null,
	why: GroupEndReason,
): Step {
	const player = findPlayer(lobby, userId)
	if (!player) return { lobby, out: [] }

	const grouped = memberGone(lobby, userId, why)
	// Host moves on before the player is gone, so the new host is never them.
	const transferred = transferHostFrom(grouped.lobby, userId)
	const ready = { ...transferred.lobby.game.ready }
	delete ready[userId]
	const actionBudget = { ...transferred.lobby.actionBudget }
	delete actionBudget[userId]
	delete actionBudget[logBudgetKey(userId)]
	const next = {
		...transferred.lobby,
		players: transferred.lobby.players.filter((p) => p.id !== userId),
		game: { ...transferred.lobby.game, ready },
		actionBudget,
	}
	const others = allIds(next)
	const out: Outbound[] = grouped.out.concat([{ kind: 'clearCurrent', userId }])
	if (type)
		out.push(
			event(
				next,
				type,
				{ playerId: userId, displayName: player.info.displayName },
				others,
			),
		)
	out.push({
		kind: 'send',
		op: ServerOp.PLAYER_INFO,
		payload: { playerId: userId, info: null },
		to: others,
	})
	out.push(
		...transferred.out.map((o) =>
			o.kind === 'send' ? { ...o, to: others } : o,
		),
	)

	if (next.players.length === 0) {
		const closed = close(next)
		return { lobby: closed.lobby, out: out.concat(closed.out) }
	}
	return closeIfAbandoned({ lobby: next, out })
}

// The player asked to leave (op LEAVE, or the leave RPC): gone for good.
export function leave(lobby: Lobby, userId: string): Step {
	if (!findPlayer(lobby, userId)) return { lobby, out: [] }
	const step = remove(lobby, userId, 'player_left', 'member_left')
	return { lobby: step.lobby, out: step.out.concat([{ kind: 'kick', userId }]) }
}

// The player's socket dropped without a LEAVE: keep their seat for the grace
// period. A leave from an older session of a player who already rejoined is
// stale and ignored. A group can't queue without them; one that is away
// left on purpose, and keeps its host.
export function disconnect(
	lobby: Lobby,
	userId: string,
	sessionId: string,
	now: number,
): Step {
	const player = findPlayer(lobby, userId)
	if (!player || player.sessionId !== sessionId || player.awaySince !== null)
		return { lobby, out: [] }

	const away: LobbyPlayer = { ...player, awaySince: now }
	const grouped = memberDisconnected(lobby, userId)
	const marked = {
		...grouped.lobby,
		players: grouped.lobby.players.map((p) => (p.id === userId ? away : p)),
	}
	const transferred = isParked(marked) ? { lobby: marked, out: [] } : transferHostFrom(marked, userId)
	const out: Outbound[] = grouped.out.concat([
		event(
			transferred.lobby,
			'player_disconnected',
			{ playerId: userId, displayName: player.info.displayName },
			othersThan(transferred.lobby, userId),
		),
	])
	return closeIfAbandoned({
		lobby: transferred.lobby,
		out: out.concat(transferred.out),
	})
}

export function kick(lobby: Lobby, byId: string, targetId: string): Step {
	if (lobby.hostId !== byId)
		return { lobby, out: [rejectOp(byId, 'Only the host can kick players')] }
	// The matchmaker seated these players, so the host has no say over who plays.
	if (lobbyType(lobby) === 'public')
		return { lobby, out: [rejectOp(byId, 'Players cannot be kicked from a matchmade lobby')] }
	if (targetId === byId)
		return { lobby, out: [rejectOp(byId, 'You cannot kick yourself')] }
	if (!findPlayer(lobby, targetId))
		return { lobby, out: [rejectOp(byId, 'Player is not in this lobby')] }
	return removeKicked(lobby, targetId, { kickedBy: byId })
}

// Announced to everyone, the target included, before they are removed; they
// may not come back.
function removeKicked(lobby: Lobby, targetId: string, data: { [key: string]: unknown }): Step {
	const target = findPlayer(lobby, targetId)
	if (!target) return { lobby, out: [] }
	const announced = event(
		lobby,
		'player_kicked',
		{ playerId: targetId, displayName: target.info.displayName, data },
		allIds(lobby),
	)
	const marked = { ...lobby, kickedIds: lobby.kickedIds.concat([targetId]) }
	const step = remove(marked, targetId, null, 'member_kicked')
	return {
		lobby: step.lobby,
		out: [announced as Outbound].concat(step.out, [
			{ kind: 'kick', userId: targetId },
		]),
	}
}

// The server (an admin, or a ban) takes userId out. With onlyIfStarted, only
// out of a running game: a queue ban forfeits the game but leaves an idle
// lobby alone. Leaving a started game is its forfeit: the result clock and
// the others' reports settle it (actions/results.ts).
export function adminRemove(
	lobby: Lobby,
	userId: string,
	reason: string,
	onlyIfStarted = false,
): Step {
	if (onlyIfStarted && lobby.game.started === null) return { lobby, out: [] }
	return removeKicked(lobby, userId, { kickedBy: 'server', reason })
}

// What webadmin shows of a lobby beyond its label.
export function adminView(lobby: Lobby) {
	return {
		code: lobby.code,
		modId: lobby.modId,
		hostId: lobby.hostId,
		maxPlayers: lobby.maxPlayers,
		createdAt: lobby.createdAt,
		metadata: lobby.metadata,
		started: lobby.game.started !== null,
		players: lobby.players.map((p) => ({
			id: p.id,
			displayName: p.info.displayName,
			connected: p.awaySince === null,
		})),
		spectators: lobby.spectators || [],
	}
}

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function setMetadata(lobby: Lobby, byId: string, patch: unknown): Step {
	if (lobby.hostId !== byId)
		return { lobby, out: [rejectOp(byId, 'Only the host can set metadata')] }
	if (!isPlainObject(patch))
		return { lobby, out: [rejectOp(byId, 'Metadata must be an object')] }

	const metadata = { ...lobby.metadata, ...patch }
	const next = { ...lobby, metadata }
	const everyone = allIds(next)
	return {
		lobby: next,
		out: [
			{ kind: 'send', op: ServerOp.METADATA, payload: metadata, to: everyone },
			event(next, 'metadata_changed', { data: metadata }, everyone),
		],
	}
}

export function setOwnState(lobby: Lobby, byId: string, state: unknown): Step {
	if (!findPlayer(lobby, byId)) return { lobby, out: [] }
	return {
		lobby: {
			...lobby,
			players: lobby.players.map((p) =>
				p.id === byId ? { ...p, ownState: state } : p,
			),
		},
		out: [],
	}
}

// A player's info changed outside the match (their profile: display name,
// joker, mods). Everyone, the player included, gets the new info.
export function setPlayerInfo(lobby: Lobby, userId: string, patch: Partial<PlayerInfo>): Step {
	const player = findPlayer(lobby, userId)
	if (!player) return { lobby, out: [] }
	const info: PlayerInfo = { ...player.info, ...patch }
	return {
		lobby: {
			...lobby,
			players: lobby.players.map((p) => (p.id === userId ? { ...p, info } : p)),
		},
		out: [{ kind: 'send', op: ServerOp.PLAYER_INFO, payload: { playerId: userId, info }, to: allIds(lobby) }],
	}
}

// Whether the seat has been catching up for as long as the lobby's mod allows.
function catchUpLimitReached(lobby: Lobby, player: LobbyPlayer, now: number): boolean {
	const limit = lobby.catchUpLimitMs
	return typeof limit === 'number' && typeof player.catchingUpSince === 'number' && now - player.catchingUpSince >= limit
}

// A seat forfeited at the catch-up limit is still connected (it is catching up,
// not away): tell it, then kick its presence, or it plays on alone. A seat
// whose grace ran out has no presence to tell.
function toldAndKicked(lobby: Lobby, player: LobbyPlayer, graceRanOut: boolean): Outbound[] {
	if (graceRanOut || player.awaySince !== null) return []
	return [
		event(
			lobby,
			'player_kicked',
			{
				playerId: player.id,
				displayName: player.info.displayName,
				data: { kickedBy: 'server', reason: CATCH_UP_LIMIT_REASON },
			},
			[player.id],
		),
		{ kind: 'kick', userId: player.id },
	]
}

// Time passing: expire grace periods and catch-up limits, and close a lobby its creator never
// joined.
export function tick(lobby: Lobby, now: number): Step {
	if (lobby.closed) return { lobby, out: [] }
	if (lobby.players.length === 0) {
		return now - lobby.createdAt >= CREATOR_JOIN_TIMEOUT_MS
			? close(lobby)
			: { lobby, out: [] }
	}

	// An away group's members are in their public game, not timing out.
	let step: Step = groupAwayCapped(lobby, now)
	for (const p of lobby.players) {
		if (step.lobby.closed) break
		const parked = isParked(step.lobby) && step.lobby.groupQueue!.memberIds.indexOf(p.id) !== -1
		const current = findPlayer(step.lobby, p.id) || p
		const awaySince = current.awaySince
		const graceRanOut = !parked && awaySince !== null && now - awaySince >= lobby.graceMs
		if (graceRanOut || catchUpLimitReached(lobby, current, now)) {
			const started = step.lobby.game.started
			const forfeited: Outbound[] =
				started && started.players.some((q) => q.id === p.id)
					? [{ kind: 'forfeited', userId: p.id, runId: started.runId, code: lobby.code, at: now, lobbyKind: lobbyKindOf(lobby) }]
					: []
			const removed = remove(step.lobby, p.id, 'player_left', 'member_disconnected')
			const marked =
				forfeited.length > 0 && started
					? { ...removed.lobby, forfeitedSeats: { ...(removed.lobby.forfeitedSeats || {}), [p.id]: started.runId } }
					: removed.lobby
			step = { lobby: marked, out: step.out.concat(forfeited, removed.out, toldAndKicked(step.lobby, current, graceRanOut)) }
		}
	}
	return step
}
