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
} from './elo.service.js'
import {
	updateMatchLobbyState,
} from '../../infrastructure/gateways/matchmaking.gateway.js'
import type { StoredLobbyState } from '../../shared/types/index.js'
import type { IMessageBus } from '../../contracts/IMessageBus.js'
import type { IBanRepository } from '../../contracts/IBanRepository.js'
import type { IMatchRepository } from '../../contracts/IMatchRepository.js'
import {
	isRanked,
	leaveAllQueues,
	addToPlayerQueues,
	removeFromPlayerQueues,
	getPlayerIdsFromEntries,
	getHostFromEntries,
	runCasualQueue,
	runRankedQueue,
	totalPlayerCount,
} from './queue.js'

export {
	leaveQueue,
	leaveAllQueues,
	getQueueStatus,
	runCasualQueue,
	runRankedQueue,
} from './queue.js'

export {
	getLeaderboard,
	getOwnRating,
	resolveSeasonId,
	runDecay,
	checkSeasonRollover,
} from '../../infrastructure/gateways/matchmaking.gateway.js'

interface MatchmakingServiceDeps {
	messageBus: IMessageBus
	matchRepository: IMatchRepository
	banRepository: IBanRepository
}

export type MatchmakingService = ReturnType<typeof createMatchmakingService>

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

// --- Daily jobs (use gateway directly via dynamic import — no factory deps needed) ---

let dailyJobInterval: ReturnType<typeof setInterval> | null = null

export function startDailyJob(): void {
	if (dailyJobInterval) return
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
	import('../../infrastructure/gateways/matchmaking.gateway.js')
		.then(({ runDecay, checkSeasonRollover }) => {
			runDecay().catch((err) => console.error('[matchmaking] runDecay error:', err))
			checkSeasonRollover().catch((err) =>
				console.error('[matchmaking] checkSeasonRollover error:', err),
			)
		})
		.catch((err) => console.error('[matchmaking] runDailyTasks import error:', err))
}

export function stopDailyJob(): void {
	if (dailyJobInterval) {
		clearInterval(dailyJobInterval)
		dailyJobInterval = null
	}
}

// --- Factory for infra-dependent operations ---

export function createMatchmakingService(deps: MatchmakingServiceDeps) {
	const { messageBus, matchRepository, banRepository } = deps

	async function joinQueue(
		session: PlayerSession,
		opts: QueueOpts,
	): Promise<{ position: number }> {
		const { modId, gameMode, minPlayers, maxPlayers } = opts

		if (minPlayers < 2) throw new AppError('minPlayers must be at least 2', 400)
		if (maxPlayers < minPlayers) throw new AppError('maxPlayers must be >= minPlayers', 400)

		if (await banRepository.hasActiveBan(session.playerId, 'queue')) {
			throw new AppError('You are banned from matchmaking', 403)
		}

		if (session.lobbyCode) {
			const existingLobby = getLobby(session.lobbyCode)
			if (existingLobby?.type === 'public') {
				throw new AppError('Cannot queue while in a matchmade lobby', 409)
			}
		}

		const key = queueKey(modId, gameMode)
		const existingQueue = queues.get(key)

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

			for (const pid of groupPlayerIds) {
				const existing = playerQueues.get(pid)
				if (existing && existing.size > 0) {
					throw new AppError(`Player ${pid} is already queued`, 409)
				}
			}

			let totalRating = 0
			for (const pid of groupPlayerIds) {
				const rating = isRanked(gameMode)
					? await matchRepository.getPlayerCurrentRating(pid, modId, gameMode)
					: INITIAL_HIDDEN_RATING
				totalRating += rating
			}
			const avgRating =
				groupPlayerIds.length > 0 ? totalRating / groupPlayerIds.length : INITIAL_HIDDEN_RATING

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
			const existingForPlayer = playerQueues.get(session.playerId)
			if (existingForPlayer?.has(key)) {
				throw new AppError('Already queued for this mode', 409)
			}

			const rating = isRanked(gameMode)
				? await matchRepository.getPlayerCurrentRating(session.playerId, modId, gameMode)
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

	async function updateGroupQueueOnLobbyJoin(
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

			if (entry.playerIds.length + 1 >= entry.maxPlayers) return

			const rating = isRanked(entry.gameMode)
				? await matchRepository.getPlayerCurrentRating(newPlayerId, entry.modId, entry.gameMode)
				: INITIAL_HIDDEN_RATING

			const updatedPlayerIds = [...entry.playerIds, newPlayerId]
			const avgRating =
				(entry.avgRating * entry.playerIds.length + rating) / updatedPlayerIds.length

			queue[idx] = { ...entry, playerIds: updatedPlayerIds, avgRating }
			addToPlayerQueues([newPlayerId], key)
			return
		}
	}

	function removeGroupQueueForLobby(lobbyCode: string): void {
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

	async function createMatch(
		entries: QueueEntry[],
		modId: string,
		gameMode: string,
	): Promise<void> {
		const playerIds = getPlayerIdsFromEntries(entries)
		const hostPlayerId = getHostFromEntries(entries)
		const maxPlayers = entries[0].maxPlayers

		for (const pid of playerIds) {
			leaveAllQueues(pid)
		}

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

		const lobby = new Lobby(code, modId, hostPlayerId, maxPlayers, 'public')

		const baseGameModeKey = gameMode.startsWith('ranked:')
			? gameMode.slice('ranked:'.length)
			: gameMode
		lobby.metadata = { gamemode: baseGameModeKey }

		for (const pid of playerIds) {
			const session = getSession(pid)
			if (session) {
				session.lobbyCode = code
				lobby.players.set(pid, session)
			}
		}
		lobbies.set(code, lobby)

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

		for (const [pid, info] of Object.entries(playerInfos)) {
			await messageBus.publishPlayerInfo(code, pid, info)
		}
		await messageBus.publishMetadata(code, lobby.metadata)

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

		await matchRepository.insertMatch(matchId, code, modId, gameMode, playerIds, lobbyState)

		matches.set(matchId, matchRecord)
		matchByLobby.set(code, matchRecord)

		const timestamp = new Date().toISOString()
		for (const pid of playerIds) {
			await messageBus.publishToPlayer(pid, 'matchmaking', {
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
		for (const [, queue] of queues) {
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

	async function runMatchmakingCycle(): Promise<void> {
		const promises: Promise<void>[] = []
		for (const [, queue] of queues) {
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

	function startMatchmaking(): void {
		if (matchmakingInterval) return
		matchmakingInterval = setInterval(runMatchmaking, MATCHING_INTERVAL_MS)
		matchmakingInterval.unref()
		console.log('[matchmaking] Matching loop started')
	}

	function stopMatchmaking(): void {
		if (matchmakingInterval) {
			clearInterval(matchmakingInterval)
			matchmakingInterval = null
		}
	}

	async function restoreMatchesFromDb(): Promise<void> {
		const activeMatches = await matchRepository.loadActiveMatches()

		for (const row of activeMatches) {
			const state = row.lobbyState as StoredLobbyState
			const playerIds = row.players as string[]

			const lobby = new Lobby(
				row.lobbyCode,
				row.modId,
				state.hostId,
				state.maxPlayers ?? 16,
				'public',
			)
			lobby.metadata = state.metadata ?? {}
			lobbies.set(row.lobbyCode, lobby)

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

			for (const [pid, info] of Object.entries(state.playerInfos ?? {})) {
				await messageBus.publishPlayerInfo(row.lobbyCode, pid, info)
			}
		}

		if (activeMatches.length > 0) {
			console.log(`[matchmaking] Restored ${activeMatches.length} active matches from DB`)
		}
	}

	async function restorePlayerMatchSession(session: PlayerSession): Promise<void> {
		const activeMatch = await matchRepository.loadActiveMatches()

		for (const row of activeMatch) {
			const playerIds = row.players as string[]
			if (!playerIds.includes(session.playerId)) continue

			const lobby = getLobby(row.lobbyCode)
			if (!lobby) continue

			if (!lobby.players.has(session.playerId)) {
				lobby.players.set(session.playerId, session)
			}
			session.lobbyCode = row.lobbyCode

			const state = row.lobbyState as StoredLobbyState

			await messageBus.publishToPlayer(session.playerId, 'matchmaking', {
				type: 'match_reconnect',
				matchId: row.matchId,
				lobbyCode: row.lobbyCode,
				modId: row.modId,
				gameMode: row.gameMode,
				timestamp: new Date().toISOString(),
			})

			const info = state.playerInfos?.[session.playerId]
			if (info) {
				await messageBus.publishPlayerInfo(row.lobbyCode, session.playerId, info)
			}

			return
		}
	}

	async function markRunStart(
		session: PlayerSession,
		matchId: string,
	): Promise<void> {
		const match = matches.get(matchId)
		if (!match) throw new AppError('Match not found', 404)

		const lobby = getLobby(match.lobbyCode)
		if (!lobby) throw new AppError('Lobby not found', 404)

		if (lobby.hostId !== session.playerId) {
			throw new AppError('Only the match host can start the run', 403)
		}

		if (match.gameStartedAt) return

		const now = new Date()
		match.gameStartedAt = now
		await matchRepository.setMatchGameStarted(matchId, now)
	}

	async function reportResult(
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
			await matchRepository.updateMatchStatus(matchId, 'resolved')
			matches.delete(matchId)
			matchByLobby.delete(match.lobbyCode)
			return
		}

		const season = await matchRepository.getCurrentSeason()
		if (!season) throw new AppError('No active season', 500)

		const ratingResults = await matchRepository.applyRatingTransaction(
			matchId,
			match,
			season.id,
			placements,
		)

		matches.delete(matchId)
		matchByLobby.delete(match.lobbyCode)

		const timestamp = new Date().toISOString()
		for (const pid of match.playerIds) {
			await messageBus.publishToPlayer(pid, 'matchmaking', {
				type: 'match_resolved',
				matchId,
				ratings: ratingResults,
				timestamp,
			})
		}
	}

	return {
		joinQueue,
		updateGroupQueueOnLobbyJoin,
		removeGroupQueueForLobby,
		syncMatchLobbyState,
		runMatchmakingCycle,
		startMatchmaking,
		stopMatchmaking,
		restoreMatchesFromDb,
		restorePlayerMatchSession,
		markRunStart,
		reportResult,
	}
}
