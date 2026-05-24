import { and, eq, gt, lt, isNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
	leaderboardCache,
	matchmakingMatches,
	matchmakingRatings,
	players,
	seasons,
} from '../db/schema.js'
import { Lobby, getLobby, getSession, lobbies } from '../state/index.js'
import {
	matchByLobby,
	matches,
	playerQueues,
	queues,
	queueKey,
} from '../state/matchmaking.js'
import type { PlayerSession } from '../state/player.js'
import type {
	GroupQueueEntry,
	Match,
	PlacementEntry,
	QueueEntry,
	QueueOpts,
	SoloQueueEntry,
} from '../types/index.js'
import { AppError } from '../utils/errors.js'
import { generateLobbyCode } from '../utils/lobby-code.js'
import {
	DECAY_INACTIVE_THRESHOLD_DAYS,
	DECAY_RATE_PER_DAY,
	INITIAL_HIDDEN_RATING,
	LEADERBOARD_TOP_N,
	MATCHING_INTERVAL_MS,
	PLACEMENT_GAMES,
	RANKED_SPREAD_CAP,
	RANKED_SPREAD_EXPAND_RATE,
	RANKED_SPREAD_INITIAL,
	RATING_FLOOR,
	applySoftReset,
	compute1v1,
	computeFFA,
	computeTeam,
} from './elo.service.js'
import { mqttService } from './mqtt.service.js'

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

async function getCurrentSeason(): Promise<
	{ id: number; name: string; startedAt: Date; endsAt: Date } | undefined
> {
	const rows = await db
		.select()
		.from(seasons)
		.where(isNull(seasons.endedAt))
		.limit(1)
	return rows[0]
}

interface RatingRow {
	rating: number
	wins: number
	losses: number
	gamesPlayed: number
	lastMatchAt: Date | null
}

async function getOrCreateRating(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	playerId: string,
	modId: string,
	gameMode: string,
	seasonId: number,
): Promise<RatingRow> {
	const existing = await tx
		.select()
		.from(matchmakingRatings)
		.where(
			and(
				eq(matchmakingRatings.playerId, playerId),
				eq(matchmakingRatings.modId, modId),
				eq(matchmakingRatings.gameMode, gameMode),
				eq(matchmakingRatings.season, seasonId),
			),
		)
		.limit(1)

	if (existing[0]) return existing[0]

	await tx.insert(matchmakingRatings).values({
		playerId,
		modId,
		gameMode,
		season: seasonId,
		rating: INITIAL_HIDDEN_RATING,
		wins: 0,
		losses: 0,
		gamesPlayed: 0,
		lastMatchAt: null,
		decayAppliedAt: null,
	})

	return {
		rating: INITIAL_HIDDEN_RATING,
		wins: 0,
		losses: 0,
		gamesPlayed: 0,
		lastMatchAt: null,
	}
}

async function recomputeLeaderboard(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	modId: string,
	gameMode: string,
	seasonId: number,
): Promise<void> {
	await tx
		.delete(leaderboardCache)
		.where(
			and(
				eq(leaderboardCache.modId, modId),
				eq(leaderboardCache.gameMode, gameMode),
				eq(leaderboardCache.season, seasonId),
			),
		)

	await tx.execute(sql`
		INSERT INTO leaderboard_cache
			(mod_id, game_mode, season, rank, player_id, display_name, rating, wins, losses, games_played, updated_at)
		SELECT
			${modId}, ${gameMode}, ${seasonId},
			ROW_NUMBER() OVER (ORDER BY r.rating DESC, r.wins DESC) AS rank,
			r.player_id,
			CASE WHEN p.use_discord_name AND p.discord_username IS NOT NULL
				 THEN p.discord_username ELSE p.steam_name END,
			r.rating,
			r.wins,
			r.losses,
			r.games_played,
			NOW()
		FROM matchmaking_ratings r
		JOIN players p ON p.id = r.player_id
		WHERE r.mod_id = ${modId}
		  AND r.game_mode = ${gameMode}
		  AND r.season = ${seasonId}
		  AND r.games_played >= ${PLACEMENT_GAMES}
		ORDER BY r.rating DESC, r.wins DESC
		LIMIT ${LEADERBOARD_TOP_N}
	`)
}

async function getPlayerRating(playerId: string): Promise<number> {
	const session = getSession(playerId)
	if (session) return INITIAL_HIDDEN_RATING
	return INITIAL_HIDDEN_RATING
}

async function getPlayerCurrentRating(
	playerId: string,
	modId: string,
	gameMode: string,
): Promise<number> {
	const season = await getCurrentSeason()
	if (!season) return INITIAL_HIDDEN_RATING

	const rows = await db
		.select({ rating: matchmakingRatings.rating })
		.from(matchmakingRatings)
		.where(
			and(
				eq(matchmakingRatings.playerId, playerId),
				eq(matchmakingRatings.modId, modId),
				eq(matchmakingRatings.gameMode, gameMode),
				eq(matchmakingRatings.season, season.id),
			),
		)
		.limit(1)

	return rows[0]?.rating ?? INITIAL_HIDDEN_RATING
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

	const lobbyState = {
		hostId: hostPlayerId,
		metadata: lobby.metadata,
		maxPlayers,
		playerInfos,
	}

	await db.insert(matchmakingMatches).values({
		matchId,
		lobbyCode: code,
		modId,
		gameMode,
		players: JSON.stringify(playerIds),
		lobbyState: JSON.stringify(lobbyState),
		status: 'active',
	})

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

interface StoredLobbyState {
	hostId: string
	metadata: Record<string, unknown>
	maxPlayers: number
	playerInfos: Record<string, { displayName: string; preferredJoker: string }>
}

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

	await db
		.update(matchmakingMatches)
		.set({
			lobbyState: JSON.stringify(lobbyState),
			updatedAt: new Date(),
		})
		.where(eq(matchmakingMatches.lobbyCode, lobbyCode))
}

export async function restoreMatchesFromDb(): Promise<void> {
	const activeMatches = await db
		.select()
		.from(matchmakingMatches)
		.where(eq(matchmakingMatches.status, 'active'))

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
	const activeMatch = await db
		.select()
		.from(matchmakingMatches)
		.where(eq(matchmakingMatches.status, 'active'))

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

function detectMode(placements: PlacementEntry[]): 'solo' | 'ffa' | 'team' {
	if (placements.some((p) => p.teamId)) return 'team'
	if (placements.length === 2) return 'solo'
	return 'ffa'
}

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
		await db
			.update(matchmakingMatches)
			.set({ status: 'resolved', updatedAt: new Date() })
			.where(eq(matchmakingMatches.matchId, matchId))

		matches.delete(matchId)
		matchByLobby.delete(match.lobbyCode)
		return
	}

	const season = await getCurrentSeason()
	if (!season) throw new AppError('No active season', 500)

	const mode = detectMode(placements)

	const ratingResults = await db.transaction(async (tx) => {
		const ratingMap = new Map<
			string,
			RatingRow & { playerId: string }
		>()

		for (const p of placements) {
			const r = await getOrCreateRating(tx, p.playerId, match.modId, match.gameMode, season.id)
			ratingMap.set(p.playerId, { ...r, playerId: p.playerId })
		}

		// Compute deltas
		let deltas: Map<string, number>

		if (mode === 'solo') {
			const [a, b] = placements
			const ra = ratingMap.get(a.playerId)!
			const rb = ratingMap.get(b.playerId)!
			const outcome = a.place < b.place ? 'a_wins' : b.place < a.place ? 'b_wins' : 'draw'
			const { deltaA, deltaB } = compute1v1(
				{ rating: ra.rating, gamesPlayed: ra.gamesPlayed, performance: a.performance ?? 0 },
				{ rating: rb.rating, gamesPlayed: rb.gamesPlayed, performance: b.performance ?? 0 },
				outcome,
			)
			deltas = new Map([
				[a.playerId, deltaA],
				[b.playerId, deltaB],
			])
		} else if (mode === 'ffa') {
			const winnerPlace = Math.min(...placements.map((p) => p.place))
			deltas = computeFFA(
				placements.map((p) => {
					const r = ratingMap.get(p.playerId)!
					return {
						playerId: p.playerId,
						rating: r.rating,
						gamesPlayed: r.gamesPlayed,
						performance: p.performance ?? 0,
						isWinner: p.place === winnerPlace,
					}
				}),
			)
		} else {
			// Team mode: group by teamId, winner team has lowest place
			const teamMap = new Map<string, PlacementEntry[]>()
			for (const p of placements) {
				const tid = p.teamId!
				if (!teamMap.has(tid)) teamMap.set(tid, [])
				teamMap.get(tid)!.push(p)
			}
			const teamEntries = Array.from(teamMap.entries())
			const winnerTeamPlace = Math.min(
				...teamEntries.map(([, members]) =>
					Math.min(...members.map((m) => m.place)),
				),
			)
			const winnerTeamId = teamEntries.find(
				([, members]) => Math.min(...members.map((m) => m.place)) === winnerTeamPlace,
			)![0]
			const winnerTeamIdx = teamEntries.findIndex(([tid]) => tid === winnerTeamId)

			const teams = teamEntries.map(([, members]) =>
				members.map((m) => {
					const r = ratingMap.get(m.playerId)!
					return {
						playerId: m.playerId,
						rating: r.rating,
						gamesPlayed: r.gamesPlayed,
						performance: m.performance ?? 0,
					}
				}),
			)
			deltas = computeTeam(teams, winnerTeamIdx)
		}

		// Apply rating updates
		const now = new Date()
		const updatedRatings: Array<{
			playerId: string
			newRating: number | null
			delta: number | null
			gamesPlayed: number
			isPlacement: boolean
		}> = []

		for (const p of placements) {
			const r = ratingMap.get(p.playerId)!
			const delta = deltas.get(p.playerId) ?? 0
			const isWin = p.place === Math.min(...placements.map((pl) => pl.place))
			const newRating = Math.max(RATING_FLOOR, r.rating + delta)
			const newGamesPlayed = r.gamesPlayed + 1
			const newWins = r.wins + (isWin ? 1 : 0)
			const newLosses = r.losses + (isWin ? 0 : 1)

			await tx
				.update(matchmakingRatings)
				.set({
					rating: newRating,
					wins: newWins,
					losses: newLosses,
					gamesPlayed: newGamesPlayed,
					lastMatchAt: now,
					updatedAt: now,
				})
				.where(
					and(
						eq(matchmakingRatings.playerId, p.playerId),
						eq(matchmakingRatings.modId, match.modId),
						eq(matchmakingRatings.gameMode, match.gameMode),
						eq(matchmakingRatings.season, season.id),
					),
				)

			const isPlacement = newGamesPlayed < PLACEMENT_GAMES

			updatedRatings.push({
				playerId: p.playerId,
				newRating: isPlacement ? null : newRating,
				delta: isPlacement ? null : delta,
				gamesPlayed: newGamesPlayed,
				isPlacement,
			})
		}

		// Mark match resolved
		await tx
			.update(matchmakingMatches)
			.set({ status: 'resolved', updatedAt: now })
			.where(eq(matchmakingMatches.matchId, matchId))

		// Recompute leaderboard
		await recomputeLeaderboard(tx, match.modId, match.gameMode, season.id)

		return updatedRatings
	})

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

// ---- Leaderboard & ratings ----

export async function getLeaderboard(
	modId: string,
	gameMode: string,
	seasonId: number,
	playerId: string,
): Promise<{
	season: number
	modId: string
	gameMode: string
	entries: Array<{
		rank: number
		playerId: string
		displayName: string
		rating: number
		wins: number
		losses: number
	}>
	playerEntry: {
		rank: number
		rating: number
		wins: number
		losses: number
	} | null
}> {
	const entries = await db
		.select({
			rank: leaderboardCache.rank,
			playerId: leaderboardCache.playerId,
			displayName: leaderboardCache.displayName,
			rating: leaderboardCache.rating,
			wins: leaderboardCache.wins,
			losses: leaderboardCache.losses,
		})
		.from(leaderboardCache)
		.where(
			and(
				eq(leaderboardCache.modId, modId),
				eq(leaderboardCache.gameMode, gameMode),
				eq(leaderboardCache.season, seasonId),
			),
		)
		.orderBy(leaderboardCache.rank)

	// Player's own entry
	let playerEntry: { rank: number; rating: number; wins: number; losses: number } | null = null

	const cachedEntry = entries.find((e) => e.playerId === playerId)
	if (cachedEntry) {
		playerEntry = {
			rank: cachedEntry.rank,
			rating: cachedEntry.rating,
			wins: cachedEntry.wins,
			losses: cachedEntry.losses,
		}
	} else {
		// Not in top 100 — compute rank on demand
		const ownRating = await db
			.select({
				rating: matchmakingRatings.rating,
				wins: matchmakingRatings.wins,
				losses: matchmakingRatings.losses,
				gamesPlayed: matchmakingRatings.gamesPlayed,
			})
			.from(matchmakingRatings)
			.where(
				and(
					eq(matchmakingRatings.playerId, playerId),
					eq(matchmakingRatings.modId, modId),
					eq(matchmakingRatings.gameMode, gameMode),
					eq(matchmakingRatings.season, seasonId),
				),
			)
			.limit(1)

		if (ownRating[0] && ownRating[0].gamesPlayed >= PLACEMENT_GAMES) {
			const rankResult = await db.execute<{ count: string }>(sql`
				SELECT COUNT(*) + 1 AS count
				FROM matchmaking_ratings
				WHERE mod_id = ${modId}
				  AND game_mode = ${gameMode}
				  AND season = ${seasonId}
				  AND games_played >= ${PLACEMENT_GAMES}
				  AND rating > ${ownRating[0].rating}
			`)
			const rank = Number(rankResult.rows[0]?.count ?? 1)
			playerEntry = {
				rank,
				rating: ownRating[0].rating,
				wins: ownRating[0].wins,
				losses: ownRating[0].losses,
			}
		}
	}

	return { season: seasonId, modId, gameMode, entries, playerEntry }
}

export async function getOwnRating(
	playerId: string,
	modId: string,
	gameMode: string,
	seasonId: number,
): Promise<{
	rating: number | null
	wins: number
	losses: number
	gamesPlayed: number
	isPlacement: boolean
	placementGamesLeft: number
} | null> {
	const rows = await db
		.select()
		.from(matchmakingRatings)
		.where(
			and(
				eq(matchmakingRatings.playerId, playerId),
				eq(matchmakingRatings.modId, modId),
				eq(matchmakingRatings.gameMode, gameMode),
				eq(matchmakingRatings.season, seasonId),
			),
		)
		.limit(1)

	if (!rows[0]) return null

	const r = rows[0]
	const isPlacement = r.gamesPlayed < PLACEMENT_GAMES
	return {
		rating: isPlacement ? null : r.rating,
		wins: r.wins,
		losses: r.losses,
		gamesPlayed: r.gamesPlayed,
		isPlacement,
		placementGamesLeft: Math.max(0, PLACEMENT_GAMES - r.gamesPlayed),
	}
}

// ---- Decay & season rollover ----

export async function runDecay(): Promise<void> {
	const season = await getCurrentSeason()
	if (!season) return

	// Get all modId/gameMode combos that have a leaderboard
	const combos = await db
		.selectDistinct({
			modId: leaderboardCache.modId,
			gameMode: leaderboardCache.gameMode,
		})
		.from(leaderboardCache)
		.where(eq(leaderboardCache.season, season.id))

	const now = new Date()
	const thresholdMs = DECAY_INACTIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
	const affectedCombos = new Set<string>()

	for (const combo of combos) {
		const top100 = await db
			.select({ playerId: leaderboardCache.playerId })
			.from(leaderboardCache)
			.where(
				and(
					eq(leaderboardCache.modId, combo.modId),
					eq(leaderboardCache.gameMode, combo.gameMode),
					eq(leaderboardCache.season, season.id),
				),
			)

		const playerIds = top100.map((r) => r.playerId)

		for (const playerId of playerIds) {
			const ratingRow = await db
				.select()
				.from(matchmakingRatings)
				.where(
					and(
						eq(matchmakingRatings.playerId, playerId),
						eq(matchmakingRatings.modId, combo.modId),
						eq(matchmakingRatings.gameMode, combo.gameMode),
						eq(matchmakingRatings.season, season.id),
					),
				)
				.limit(1)

			if (!ratingRow[0]) continue

			const r = ratingRow[0]

			// Skip if decay already ran for this player today (UTC calendar day)
			if (r.decayAppliedAt) {
				const applied = r.decayAppliedAt
				if (
					applied.getUTCFullYear() === now.getUTCFullYear() &&
					applied.getUTCMonth() === now.getUTCMonth() &&
					applied.getUTCDate() === now.getUTCDate()
				) {
					continue
				}
			}

			const lastActivity = r.lastMatchAt ?? r.updatedAt
			const inactiveDays =
				(now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000)

			if (inactiveDays > DECAY_INACTIVE_THRESHOLD_DAYS) {
				const decayAmount = Math.floor(inactiveDays - DECAY_INACTIVE_THRESHOLD_DAYS) * DECAY_RATE_PER_DAY
				const newRating = Math.max(RATING_FLOOR, r.rating - decayAmount)

				if (newRating !== r.rating) {
					await db
						.update(matchmakingRatings)
						.set({ rating: newRating, decayAppliedAt: now, updatedAt: now })
						.where(
							and(
								eq(matchmakingRatings.playerId, playerId),
								eq(matchmakingRatings.modId, combo.modId),
								eq(matchmakingRatings.gameMode, combo.gameMode),
								eq(matchmakingRatings.season, season.id),
							),
						)

					affectedCombos.add(`${combo.modId}:${combo.gameMode}`)
				}
			}
		}
	}

	// Recompute leaderboard for affected combos
	if (affectedCombos.size > 0) {
		await db.transaction(async (tx) => {
			for (const combo of affectedCombos) {
				const [modId, ...gameModeParts] = combo.split(':')
				const gameMode = gameModeParts.join(':')
				await recomputeLeaderboard(tx, modId, gameMode, season.id)
			}
		})
	}
}

export async function checkSeasonRollover(): Promise<void> {
	const now = new Date()

	const expiredSeasons = await db
		.select()
		.from(seasons)
		.where(and(lt(seasons.endsAt, now), isNull(seasons.endedAt)))

	for (const expiredSeason of expiredSeasons) {
		console.log(`[matchmaking] Rolling over season ${expiredSeason.id} (${expiredSeason.name})`)

		await db.transaction(async (tx) => {
			// Get all ratings for this season
			const allRatings = await tx
				.select()
				.from(matchmakingRatings)
				.where(
					and(
						eq(matchmakingRatings.season, expiredSeason.id),
						// Only established players get soft reset
					),
				)

			// Insert next season row
			const nextSeasonName = `Season ${expiredSeason.id + 1}`
			const nextStartedAt = now
			const nextEndsAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

			const newSeasonRows = await tx
				.insert(seasons)
				.values({
					name: nextSeasonName,
					startedAt: nextStartedAt,
					endsAt: nextEndsAt,
				})
				.returning({ id: seasons.id })

			const newSeasonId = newSeasonRows[0].id

			// Apply soft reset and insert new season rows
			for (const r of allRatings) {
				if (r.gamesPlayed < PLACEMENT_GAMES) continue // skip placement players
				const newRating = applySoftReset(r.rating)
				await tx.insert(matchmakingRatings).values({
					playerId: r.playerId,
					modId: r.modId,
					gameMode: r.gameMode,
					season: newSeasonId,
					rating: newRating,
					wins: 0,
					losses: 0,
					gamesPlayed: 0,
				})
			}

			// Mark season as ended
			await tx
				.update(seasons)
				.set({ endedAt: now })
				.where(eq(seasons.id, expiredSeason.id))

			// Recompute empty leaderboard for new season (no-op since no established players yet)
		})

		console.log(`[matchmaking] Season ${expiredSeason.id} rolled over`)
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
	runDecay().catch((err) => console.error('[matchmaking] runDecay error:', err))
	checkSeasonRollover().catch((err) =>
		console.error('[matchmaking] checkSeasonRollover error:', err),
	)
}

export function stopDailyJob(): void {
	if (dailyJobInterval) {
		clearInterval(dailyJobInterval)
		dailyJobInterval = null
	}
}
