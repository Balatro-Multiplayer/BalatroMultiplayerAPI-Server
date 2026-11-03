// Spectators: players watching a lobby's game without a seat. Pure, like
// state.ts. A spectator joins the match with metadata role=spectator, gets a
// SPECTATE_SNAPSHOT to start from, then every participant's replay event as a
// SPECTATE_EVENT. They are never seated, counted, readied or sent the
// participants' own ops.
import {
	ServerOp,
	type SpectateEvent,
	type SpectateRun,
	type SpectateSnapshot,
	type SpectatorManifest,
	type SpectatorSnapshotEntry,
} from './protocol'
import { checkedRunSave, eventsOf } from './active'
import { DIFFERENT_MOD, type Lobby, type Outbound, type Step, findPlayer, isSpectatable } from './state'

export const MAX_SPECTATORS = 16
export const SPECTATOR_ROLE = 'spectator'

export function spectatorsOf(lobby: Lobby): string[] {
	return lobby.spectators || []
}

export function isSpectator(lobby: Lobby, userId: string): boolean {
	return spectatorsOf(lobby).indexOf(userId) !== -1
}

// Why userId may not watch, or null. Watching again (after a reconnect) is
// always let back in while the lobby lasts. modId is the watching mod's, ''
// when the client doesn't say (clients before the mod check).
export function spectateRejection(lobby: Lobby, userId: string, modId: string): string | null {
	if (lobby.closed) return 'Lobby is closed'
	if (modId !== '' && modId !== lobby.modId) return DIFFERENT_MOD
	if (isSpectator(lobby, userId)) return null
	if (lobby.kickedIds.indexOf(userId) !== -1) return 'You have been kicked from this lobby'
	if (!isSpectatable(lobby)) return 'This lobby is not spectatable'
	if (findPlayer(lobby, userId)) return 'You are playing in this lobby'
	if (spectatorsOf(lobby).length >= MAX_SPECTATORS) return 'This lobby has too many spectators'
	return null
}

function isObject(value: unknown): value is { [key: string]: unknown } {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// One player's starting point, from their replay log so far: the latest ante
// and hand result, the first lobby_info and the latest run_info (a multi-run
// match's current run).
export function snapshotEntry(playerId: string, lines: string[]): SpectatorSnapshotEntry {
	let ante: string | null = null
	let score: string | null = null
	let handsRemaining: number | null = null
	let lobbyInfo: Omit<SpectatorManifest, 'seed' | 'deck' | 'stake'> | null = null
	let runInfo: Pick<SpectatorManifest, 'seed' | 'deck' | 'stake'> | null = null
	for (const line of lines) {
		let opcode: unknown, args: unknown
		try {
			;[, opcode, args] = JSON.parse(line) as unknown[]
		} catch (e) {
			continue
		}
		if (opcode === 'set_ante_key' && Array.isArray(args) && typeof args[0] === 'string') {
			ante = args[0]
		} else if (opcode === 'hand_result' && Array.isArray(args)) {
			if (typeof args[0] === 'string') score = args[0]
			if (typeof args[1] === 'number') handsRemaining = args[1]
		} else if (
			opcode === 'lobby_info' &&
			!lobbyInfo &&
			isObject(args) &&
			typeof args.gamemode === 'string' &&
			typeof args.ruleset === 'string'
		) {
			const options = isObject(args.options) ? args.options : {}
			lobbyInfo = {
				gamemode: args.gamemode,
				ruleset: args.ruleset,
				sleeve: typeof options.sleeve === 'string' ? options.sleeve : null,
				challenge: typeof options.challenge === 'string' ? options.challenge : null,
			}
		} else if (
			opcode === 'run_info' &&
			isObject(args) &&
			typeof args.seed === 'string' &&
			typeof args.deck === 'string'
		) {
			runInfo = {
				seed: args.seed,
				deck: args.deck,
				stake: typeof args.stake === 'number' ? args.stake : null,
			}
		}
	}
	const manifest: SpectatorManifest | null =
		lobbyInfo && runInfo
			? {
					seed: runInfo.seed,
					deck: runInfo.deck,
					stake: runInfo.stake,
					ruleset: lobbyInfo.ruleset,
					gamemode: lobbyInfo.gamemode,
					sleeve: lobbyInfo.sleeve,
					challenge: lobbyInfo.challenge,
				}
			: null
	return { playerId, ante, score, handsRemaining, manifest }
}

// The running game's participants in start order (the first is the
// spectator's nominal point of view), each with whatever their log has shown
// so far. Empty before a game starts.
export function spectateSnapshot(lobby: Lobby): SpectateSnapshot {
	const started = lobby.game.started
	const participants = started ? started.players : []
	return {
		code: lobby.code,
		modId: lobby.modId,
		runId: started ? started.runId : null,
		players: participants.map((p) => ({ playerId: p.id, displayName: p.displayName })),
		snapshot: participants
			.filter((p) => lobby.game.logs[p.id])
			.map((p) => snapshotEntry(p.id, lobby.game.logs[p.id].lines)),
	}
}

// Call after spectateRejection returned null.
export function addSpectator(lobby: Lobby, userId: string): Step {
	const next = isSpectator(lobby, userId)
		? lobby
		: { ...lobby, spectators: spectatorsOf(lobby).concat([userId]) }
	return {
		lobby: next,
		out: [{ kind: 'send', op: ServerOp.SPECTATE_SNAPSHOT, payload: spectateSnapshot(next), to: [userId] }],
	}
}

export function removeSpectator(lobby: Lobby, userId: string): Step {
	if (!isSpectator(lobby, userId)) return { lobby, out: [] }
	return {
		lobby: { ...lobby, spectators: spectatorsOf(lobby).filter((id) => id !== userId) },
		out: [],
	}
}

// A participant's replay event, passed on to every spectator.
export function spectateEvent(lobby: Lobby, event: SpectateEvent): Outbound[] {
	const to = spectatorsOf(lobby)
	if (to.length === 0) return []
	return [{ kind: 'send', op: ServerOp.SPECTATE_EVENT, payload: event, to }]
}

// What a spectator needs to show `playerId` as they are now: their Run save
// and the events after it. Only a spectator of the lobby gets it; a player in
// the match never gets another player's Run save. fromStart skips the Run save
// and gives the whole log, for a spectator whose client could not load it.
export function spectateRunOf(
	lobby: Lobby,
	userId: string,
	playerId: string,
	sha256: (input: string) => string,
	fromStart = false,
): Step {
	const started = lobby.game.started
	if (!isSpectator(lobby, userId) || !started || !started.players.some((p) => p.id === playerId))
		return { lobby, out: [] }
	const { runSave, runSaveSkipped } = fromStart
		? { runSave: null, runSaveSkipped: null }
		: checkedRunSave(lobby, playerId, sha256)
	const pos = runSave ? runSave.pos : 0
	const log = lobby.game.logs[playerId]
	const payload: SpectateRun = {
		playerId,
		runSave,
		runSaveSkipped,
		pos,
		events: eventsOf(log ? { ...log, lines: log.lines.slice(pos) } : undefined),
	}
	return { lobby, out: [{ kind: 'send', op: ServerOp.SPECTATE_RUN, payload, to: [userId] }] }
}

export interface SpectatableLobby {
	code: string
	modId: string
	playerCount: number
	started: boolean
	spectators: number
}

// spectate_list's answer from match labels (labelOf): the spectatable lobbies
// still open to watching, as the API's GET /lobbies/spectatable lists them.
export function spectatableLobbies(labels: string[]): SpectatableLobby[] {
	const lobbies: SpectatableLobby[] = []
	for (const raw of labels) {
		let label: { [key: string]: unknown }
		try {
			label = JSON.parse(raw)
		} catch (e) {
			continue
		}
		if (!isObject(label) || label.spectatable !== true || typeof label.code !== 'string') continue
		if (typeof label.spectators === 'number' && label.spectators >= MAX_SPECTATORS) continue
		lobbies.push({
			code: label.code,
			modId: typeof label.modId === 'string' ? label.modId : '',
			playerCount: typeof label.size === 'number' ? label.size : 0,
			started: label.started === true,
			spectators: typeof label.spectators === 'number' ? label.spectators : 0,
		})
	}
	return lobbies
}
