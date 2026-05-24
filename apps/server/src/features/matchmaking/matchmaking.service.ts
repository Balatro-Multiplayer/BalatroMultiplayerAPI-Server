import { Lobby, getLobby, getSession, lobbies } from '../../state/index.js'
import {
	matchByLobby,
	matches,
	playerQueues,
	queues,
	queueKey,
} from '../../state/matchmaking.js'
import type { PlayerSession } from '../../state/player.js'
import type {
	GroupQueueEntry,
	Match,
	PlacementEntry,
	QueueEntry,
	QueueOpts,
	SoloQueueEntry,
} from '../../shared/types/index.js'
import { AppError } from '../../shared/utils/errors.js'
import { generateLobbyCode } from '../../shared/utils/lobby-code.js'
import {
	INITIAL_HIDDEN_RATING,
	MATCHING_INTERVAL_MS,
	RANKED_SPREAD_CAP,
	RANKED_SPREAD_EXPAND_RATE,
	RANKED_SPREAD_INITIAL,
} from './elo.service.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import {
	insertMatch,
	updateMatchLobbyState,
	loadActiveMatches,
	updateMatchStatus,
	applyRatingTransaction,
	getCurrentSeason,
	getPlayerCurrentRating,
} from '../../infrastructure/gateways/matchmaking.gateway.js'
import type { StoredLobbyState } from '../../infrastructure/gateways/matchmaking.gateway.js'

export {
	getLeaderboard,
	getOwnRating,
	runDecay,
	checkSeasonRollover,
} from '../../infrastructure/gateways/matchmaking.gateway.js'

// ---- Helpers ----

function isRanked(gameMode: string): boolean {
	return gameMode.startsWith('ranked:')
}

function entryPlayerCount(entry: QueueEntry): number {
	return entry.type === 'solo' ? 1 : entry.playerIds.length
}

function entryRating(entry: QueueEntry): number {
	return entry.type === 'solo' ? entry.rating : entry.avgRating
}

function totalPlayerCount(entries: QueueEntry[]): number {
	return entries.reduce((sum, e) => sum + entryPlayerCount(e), 0)
}

function getPlayerIdsFromEntries(entries: QueueEntry[]): string[] {
	return entries.flatMap((e) => (e.type === 'solo' ? [e.playerId] : e.playerIds))
}

function getHostFromEntries(entries: QueueEntry[]): string {
	const first = entries[0]
	return first.type === 'solo' ? first.playerId : first.hostPlayerId
}

// ---- Queue operations ----

function addToPlayerQueues(playerIds: string[], key: string): void {
	for (const pid of playerIds) {
		let set = playerQueues.get(pid)
		if (!set) {
			set = new Set()
			playerQueues.set(pid, set)
		}
		set.add(key)
	}
}

function removeFromPlayerQueues(playerIds: string[], key: string): void {
	for (const pid of playerIds) {
		const set = playerQueues.get(pid)
		if (set) {
			set.delete(key)
			if (set.size === 0) playerQueues.delete(pid)
		}
	}
}

export async function joinQueue(
	session: PlayerSession,
	opts: QueueOpts,
): Promise<{ position: number }> {
	const { modId, gameMode, minPlayers, maxPlayers } = opts

	if (minPlayers < 2) throw new AppError('minPlayers must be at least 2', 400)
	if (maxPlayers < minPlayers) throw new AppError('maxPlayers must be >= minPlayers', 400)

	// Block queueing from inside a matchmade (public) lobby
	if (session.lobbyCode) {
		const existingLobby = getLobby(session.lobbyCode)
		if (existingLobby?.type === 'public') {
			throw new AppError('Cannot queue while in a matchmade lobby', 409)
		}
	}

	const key = queueKey(modId, gameMode)
	const existingQueue = queues.get(key)

	// Validate min/max consistency with existing queue
	if (existingQueue && existingQueue.length > 0) {
		const first = existingQueue[0]
		if (first.minPlayers !== minPlayers || first.maxPlayers !== maxPlayers) {
			throw new AppError(
				'minPlayers/maxPlayers must match existing queue for this modId:gameMode',
				409,
			)
		}
	}

	const isGroupQueue = !!session.lobbyCode
	const lobby = isGroupQueue ? getLobby(session.lobbyCode!) : undefined

	if (isGroupQueue) {
		if (!lobby) throw new AppError('Lobby not found', 404)
		if (lobby.hostId !== session.playerId) {
			throw new AppError('Only the lobby host can initiate group queue', 403)
		}
		if (lobby.type === 'public') {
			throw new AppError('Cannot queue from a matchmade lobby', 409)
		}

		const groupPlayerIds = Array.from(lobby.players.keys())
		if (groupPlayerIds.length >= maxPlayers) {
			throw new AppError('Group size must leave room for at least one other player', 400)
		}

		// Check no group member is individually queued
		for (const pid of groupPlayerIds) {
			const existing = playerQueues.get(pid)
			if (existing && existing.size > 0) {
				throw new AppError(`Player ${pid} is already queued`, 409)
			}
		}

		// Compute average rating for the group
		let totalRating = 0
		for (const pid of groupPlayerIds) {
			const rating = isRanked(gameMode)
				? await getPlayerCurrentRating(pid, modId, gameMode)
				: INITIAL_HIDDEN_RATING
			totalRating += rating
		}
		const avgRating = groupPlayerIds.length > 0 ? totalRating / groupPlayerIds.length : INITIAL_HIDDEN_RATING

		const entry: GroupQueueEntry = {
			type: 'group',
			lobbyCode: session.lobbyCode!,
			hostPlayerId: session.playerId,
			playerIds: groupPlayerIds,
			modId,
			gameMode,
			minPlayers,
			maxPlayers,
			avgRating,
			queuedAt: new Date(),
		}

		if (!queues.has(key)) queues.set(key, [])
		queues.get(key)!.push(entry)
		addToPlayerQueues(groupPlayerIds, key)
	} else {
		// Solo queue
		const existingForPlayer = playerQueues.get(session.playerId)
		if (existingForPlayer?.has(key)) {
			throw new AppError('Already queued for this mode', 409)
		}

		const rating = isRanked(gameMode)
			? await getPlayerCurrentRating(session.playerId, modId, gameMode)
			: INITIAL_HIDDEN_RATING

		const entry: SoloQueueEntry = {
			type: 'solo',
			playerId: session.playerId,
			modId,
			gameMode,
			minPlayers,
			maxPlayers,
			rating,
			queuedAt: new Date(),
		}

		if (!queues.has(key)) queues.set(key, [])
		queues.get(key)!.push(entry)
		addToPlayerQueues([session.playerId], key)
	}

	const position = totalPlayerCount(queues.get(key) ?? [])
	return { position }
}

export function leaveQueue(playerId: string, modId: string, gameMode: string): void {
	const key = queueKey(modId, gameMode)
	const queue = queues.get(key)
	if (!queue) return

	const idx = queue.findIndex((e) =>
		e.type === 'solo' ? e.playerId === playerId : e.playerIds.includes(playerId),
	)
	if (idx === -1) return

	const entry = queue[idx]
	const affectedPlayers =
		entry.type === 'solo' ? [entry.playerId] : entry.playerIds

	queue.splice(idx, 1)
	if (queue.length === 0) queues.delete(key)

	removeFromPlayerQueues(affectedPlayers, key)
}

export function leaveAllQueues(playerId: string): void {
	const keys = playerQueues.get(playerId)
	if (!keys) return

	for (const key of Array.from(keys)) {
		const queue = queues.get(key)
		if (!queue) continue

		const idx = queue.findIndex((e) =>
			e.type === 'solo' ? e.playerId === playerId : e.playerIds.includes(playerId),
		)
		if (idx === -1) continue

		const entry = queue[idx]
		const affectedPlayers =
			entry.type === 'solo' ? [entry.playerId] : entry.playerIds

		queue.splice(idx, 1)
		if (queue.length === 0) queues.delete(key)

		removeFromPlayerQueues(affectedPlayers, key)
	}
}

export function getQueueStatus(playerId: string): QueueEntry[] {
	const keys = playerQueues.get(playerId)
	if (!keys || keys.size === 0) return []

	const result: QueueEntry[] = []
	for (const key of keys) {
		const queue = queues.get(key)
		if (!queue) continue
		const entry = queue.find((e) =>
			e.type === 'solo' ? e.playerId === playerId : e.playerIds.includes(playerId),
		)
		if (entry) result.push(entry)
	}
	return result
}

// Update a group queue entry when a player joins the private lobby
export async function updateGroupQueueOnLobbyJoin(
	lobbyCode: string,
	newPlayerId: string,
): Promise<void> {
	for (const [key, queue] of queues) {
		const idx = queue.findIndex(
			(e) => e.type === 'group' && e.lobbyCode === lobbyCode,
		)
		if (idx === -1) continue

		const entry = queue[idx] as GroupQueueEntry
		if (entry.playerIds.includes(newPlayerId)) return

		// Leave room for at least one other player
		if (entry.playerIds.length + 1 >= entry.maxPlayers) return

		const rating = isRanked(entry.gameMode)
			? await getPlayerCurrentRating(newPlayerId, entry.modId, entry.gameMode)
			: INITIAL_HIDDEN_RATING

		const updatedPlayerIds = [...entry.playerIds, newPlayerId]
		const avgRating =
			(entry.avgRating * entry.playerIds.length + rating) / updatedPlayerIds.length

		queue[idx] = { ...entry, playerIds: updatedPlayerIds, avgRating }
		addToPlayerQueues([newPlayerId], key)
		return
	}
}

// Remove all queue entries for a private lobby (e.g. player left the lobby)
export function removeGroupQueueForLobby(lobbyCode: string): void {
	for (const [key, queue] of queues) {
		const idx = queue.findIndex(
			(e) => e.type === 'group' && e.lobbyCode === lobbyCode,
		)
		if (idx === -1) continue

		const entry = queue[idx] as GroupQueueEntry
		queue.splice(idx, 1)
		if (queue.length === 0) queues.delete(key)
		removeFromPlayerQueues(entry.playerIds, key)
		break
	}
}

// ---- Matching algorithm ----

export function runCasualQueue(
	entries: QueueEntry[],
	minPlayers: number,
	maxPlayers: number,
): QueueEntry[][] {
	const remaining = [...entries]
	const formed: QueueEntry[][] = []

	while (totalPlayerCount(remaining) >= minPlayers) {
		const collected: QueueEntry[] = []
		let slots = 0
		const toRemove: number[] = []

		for (let i = 0; i < remaining.length; i++) {
			const entry = remaining[i]
			const size = entryPlayerCount(entry)
			if (slots + size <= maxPlayers) {
				collected.push(entry)
				toRemove.push(i)
				slots += size
			}
			if (slots >= maxPlayers) break
		}

		if (slots < minPlayers) break

		formed.push(collected)
		for (let i = toRemove.length - 1; i >= 0; i--) {
			remaining.splice(toRemove[i], 1)
		}
	}

	return formed
}

export function runRankedQueue(
	entries: QueueEntry[],
	minPlayers: number,
	maxPlayers: number,
): QueueEntry[][] {
	const remaining = [...entries].sort((a, b) => entryRating(a) - entryRating(b))
	const formed: QueueEntry[][] = []

	while (totalPlayerCount(remaining) >= minPlayers) {
		// Find oldest-waiting entry
		let oldestIdx = 0
		let oldestTime = remaining[0].queuedAt.getTime()
		for (let i = 1; i < remaining.length; i++) {
			if (remaining[i].queuedAt.getTime() < oldestTime) {
				oldestTime = remaining[i].queuedAt.getTime()
				oldestIdx = i
			}
		}

		const anchor = remaining[oldestIdx]
		const anchorRating = entryRating(anchor)
		const anchorWaitSecs = (Date.now() - anchor.queuedAt.getTime()) / 1000
		const spread = Math.min(
			RANKED_SPREAD_INITIAL +
				Math.floor(anchorWaitSecs / 30) * RANKED_SPREAD_EXPAND_RATE,
			RANKED_SPREAD_CAP,
		)

		const collected: QueueEntry[] = []
		let slots = 0
		const toRemove: number[] = []

		for (let i = 0; i < remaining.length; i++) {
			const entry = remaining[i]
			const rating = entryRating(entry)
			const size = entryPlayerCount(entry)
			if (Math.abs(rating - anchorRating) <= spread && slots + size <= maxPlayers) {
				collected.push(entry)
				toRemove.push(i)
				slots += size
			}
		}

		if (slots >= minPlayers) {
			formed.push(collected)
			for (let i = toRemove.length - 1; i >= 0; i--) {
				remaining.splice(toRemove[i], 1)
			}
		} else {
			// Can't form match for this anchor this interval; stop
			break
		}
	}

	return formed
}

async function createMatch(
	entries: QueueEntry[],
	modId: string,
	gameMode: string,
): Promise<void> {
	const playerIds = getPlayerIdsFromEntries(entries)
	const hostPlayerId = getHostFromEntries(entries)
	const maxPlayers = entries[0].maxPlayers

	// Remove all matched players from all their queues
	for (const pid of playerIds) {
		leaveAllQueues(pid)
	}

	// Generate unique lobby code (5-char for matchmade lobbies)
	let code: string
	let attempts = 0
	do {
		code = generateLobbyCode(5)
		attempts++
	} while (lobbies.has(code) && attempts < 10)

	if (attempts >= 10) {
		console.error('[matchmaking] Failed to generate unique lobby code')
		return
	}

	// Create public lobby
	const lobby = new Lobby(code, modId, hostPlayerId, maxPlayers, 'public')

	// Seed lobby metadata with the base game mode key so clients can look it up
	const baseGameModeKey = gameMode.startsWith('ranked:') ? gameMode.slice('ranked:'.length) : gameMode
	lobby.metadata = { gamemode: baseGameModeKey }

	// Add player sessions to lobby (for players currently connected)
	for (const pid of playerIds) {
		const session = getSession(pid)
		if (session) {
			session.lobbyCode = code
			lobby.players.set(pid, session)
		}
	}
	lobbies.set(code, lobby)

	// Build playerInfos for DB storage and MQTT
	const playerInfos: Record<string, { displayName: string; preferredJoker: string }> = {}
	for (const pid of playerIds) {
		const session = getSession(pid)
		if (session) {
			playerInfos[pid] = {
				displayName: session.getDisplayName(),
				preferredJoker: session.preferredJoker,
			}
		}
	}

	// Publish retained player info and metadata MQTT
	for (const [pid, info] of Object.entries(playerInfos)) {
		await mqttService.publishPlayerInfo(code, pid, info)
	}
	await mqttService.publishMetadata(code, lobby.metadata)

	// Create match record
	const matchId = crypto.randomUUID()
	const matchRecord: Match = {
		matchId,
		lobbyCode: code,
		modId,
		gameMode,
		playerIds,
		createdAt: new Date(),
	}

	const lobbyState: StoredLobbyState = {
		hostId: hostPlayerId,
		metadata: lobby.metadata,
		maxPlayers,
		playerInfos,
	}

	await insertMatch(matchId, code, modId, gameMode, playerIds, lobbyState)

	matches.set(matchId, matchRecord)
	matchByLobby.set(code, matchRecord)

	// Notify all matched players
	const timestamp = new Date().toISOString()
	for (const pid of playerIds) {
		await mqttService.publishToPlayer(pid, 'matchmaking', {
			type: 'match_found',
			matchId,
			lobbyCode: code,
			modId,
			gameMode,
			players: playerIds,
			timestamp,
		})
	}

	console.log(
		`[matchmaking] Match created: ${matchId} (${modId}:${gameMode}) — ${playerIds.length} players`,
	)
}

function runMatchmaking(): void {
	for (const [key, queue] of queues) {
		if (queue.length === 0) continue

		const first = queue[0]
		const { modId, gameMode, minPlayers, maxPlayers } = first

		const formed = isRanked(gameMode)
			? runRankedQueue(queue, minPlayers, maxPlayers)
			: runCasualQueue(queue, minPlayers, maxPlayers)

		for (const entries of formed) {
			createMatch(entries, modId, gameMode).catch((err) =>
				console.error('[matchmaking] createMatch error:', err),
			)
		}
	}
}

export async function runMatchmakingCycle(): Promise<void> {
	const promises: Promise<void>[] = []
	for (const [_key, queue] of queues) {
		if (queue.length === 0) continue

		const first = queue[0]
		const { modId, gameMode, minPlayers, maxPlayers } = first

		const formed = isRanked(gameMode)
			? runRankedQueue(queue, minPlayers, maxPlayers)
			: runCasualQueue(queue, minPlayers, maxPlayers)

		for (const entries of formed) {
			promises.push(createMatch(entries, modId, gameMode))
		}
	}
	await Promise.all(promises)
}

let matchmakingInterval: ReturnType<typeof setInterval> | null = null

export function startMatchmaking(): void {
	if (matchmakingInterval) return
	matchmakingInterval = setInterval(runMatchmaking, MATCHING_INTERVAL_MS)
	matchmakingInterval.unref()
	console.log('[matchmaking] Matching loop started')
}

export function stopMatchmaking(): void {
	if (matchmakingInterval) {
		clearInterval(matchmakingInterval)
		matchmakingInterval = null
	}
}

// ---- Persistence ----

export async function syncMatchLobbyState(lobbyCode: string): Promise<void> {
	const lobby = getLobby(lobbyCode)
	if (!lobby || lobby.type !== 'public') return

	const playerInfos: Record<string, { displayName: string; preferredJoker: string }> = {}
	for (const [pid, session] of lobby.players) {
		playerInfos[pid] = {
			displayName: session.getDisplayName(),
			preferredJoker: session.preferredJoker,
		}
	}

	const lobbyState: StoredLobbyState = {
		hostId: lobby.hostId,
		metadata: lobby.metadata,
		maxPlayers: lobby.maxPlayers,
		playerInfos,
	}

	await updateMatchLobbyState(lobbyCode, lobbyState)
}

export async function restoreMatchesFromDb(): Promise<void> {
	const activeMatches = await loadActiveMatches()

	for (const row of activeMatches) {
		const state = row.lobbyState as StoredLobbyState
		const playerIds = row.players as string[]

		// Reconstruct lobby
		const lobby = new Lobby(
			row.lobbyCode,
			row.modId,
			state.hostId,
			state.maxPlayers ?? 16,
			'public',
		)
		lobby.metadata = state.metadata ?? {}
		lobbies.set(row.lobbyCode, lobby)

		// Reconstruct match
		const matchRecord: Match = {
			matchId: row.matchId,
			lobbyCode: row.lobbyCode,
			modId: row.modId,
			gameMode: row.gameMode,
			playerIds,
			createdAt: row.createdAt,
		}
		matches.set(row.matchId, matchRecord)
		matchByLobby.set(row.lobbyCode, matchRecord)

		// Re-publish retained player info MQTT (idempotent)
		for (const [pid, info] of Object.entries(state.playerInfos ?? {})) {
			await mqttService.publishPlayerInfo(row.lobbyCode, pid, info)
		}
	}

	if (activeMatches.length > 0) {
		console.log(`[matchmaking] Restored ${activeMatches.length} active matches from DB`)
	}
}

// Called from auth route after player session is created/restored
export async function restorePlayerMatchSession(session: PlayerSession): Promise<void> {
	// Find active match containing this player
	const activeMatch = await loadActiveMatches()

	for (const row of activeMatch) {
		const playerIds = row.players as string[]
		if (!playerIds.includes(session.playerId)) continue

		const lobby = getLobby(row.lobbyCode)
		if (!lobby) continue

		// Add session to lobby if not already there
		if (!lobby.players.has(session.playerId)) {
			lobby.players.set(session.playerId, session)
		}
		session.lobbyCode = row.lobbyCode

		const state = row.lobbyState as StoredLobbyState

		await mqttService.publishToPlayer(session.playerId, 'matchmaking', {
			type: 'match_reconnect',
			matchId: row.matchId,
			lobbyCode: row.lobbyCode,
			modId: row.modId,
			gameMode: row.gameMode,
			timestamp: new Date().toISOString(),
		})

		// Re-publish this player's retained info
		const info = state.playerInfos?.[session.playerId]
		if (info) {
			await mqttService.publishPlayerInfo(row.lobbyCode, session.playerId, info)
		}

		return
	}
}

// ---- Result reporting ----

export async function reportResult(
	session: PlayerSession,
	matchId: string,
	placements: PlacementEntry[],
): Promise<void> {
	const match = matches.get(matchId)
	if (!match) throw new AppError('Match not found', 404)

	const lobby = getLobby(match.lobbyCode)
	if (!lobby) throw new AppError('Lobby not found', 404)

	if (lobby.hostId !== session.playerId) {
		throw new AppError('Only the match host can report results', 403)
	}

	if (!isRanked(match.gameMode)) {
		// Casual match: just mark resolved, no Elo update
		await updateMatchStatus(matchId, 'resolved')

		matches.delete(matchId)
		matchByLobby.delete(match.lobbyCode)
		return
	}

	const season = await getCurrentSeason()
	if (!season) throw new AppError('No active season', 500)

	const ratingResults = await applyRatingTransaction(matchId, match, season.id, placements)

	// Clean up in-memory state
	matches.delete(matchId)
	matchByLobby.delete(match.lobbyCode)

	// Publish match_resolved to all players
	const timestamp = new Date().toISOString()
	for (const pid of match.playerIds) {
		await mqttService.publishToPlayer(pid, 'matchmaking', {
			type: 'match_resolved',
			matchId,
			ratings: ratingResults,
			timestamp,
		})
	}
}

let dailyJobInterval: ReturnType<typeof setInterval> | null = null

export function startDailyJob(): void {
	if (dailyJobInterval) return
	// Run at startup then every 24h
	runDailyTasks()

	const msUntilMidnight = (() => {
		const now = new Date()
		const midnight = new Date(now)
		midnight.setUTCHours(24, 0, 0, 0)
		return midnight.getTime() - now.getTime()
	})()

	setTimeout(() => {
		runDailyTasks()
		dailyJobInterval = setInterval(runDailyTasks, 24 * 60 * 60 * 1000)
		if (dailyJobInterval) dailyJobInterval.unref()
	}, msUntilMidnight)
}

function runDailyTasks(): void {
	// Import from gateway to avoid circular dependency issues at runtime
	import('../../infrastructure/gateways/matchmaking.gateway.js').then(({ runDecay, checkSeasonRollover }) => {
		runDecay().catch((err) => console.error('[matchmaking] runDecay error:', err))
		checkSeasonRollover().catch((err) =>
			console.error('[matchmaking] checkSeasonRollover error:', err),
		)
	}).catch((err) => console.error('[matchmaking] runDailyTasks import error:', err))
}

export function stopDailyJob(): void {
	if (dailyJobInterval) {
		clearInterval(dailyJobInterval)
		dailyJobInterval = null
	}
}
