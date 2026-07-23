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
import { insertMatchConflict } from '../../infrastructure/gateways/match-conflict.gateway.js'
import type { StoredLobbyState } from '../../shared/types/index.js'
import type { IMessageBus } from '../../contracts/IMessageBus.js'
import type { IBanRepository } from '../../contracts/IBanRepository.js'
import type { IMatchRepository } from '../../contracts/IMatchRepository.js'
import { replayLogService } from '../replay-log/replay-log.service.js'
import type { FlagReason } from '../../contracts/IReplayLogRepository.js'
import { MIN_MS_PER_HAND } from './anti-cheat.config.js'
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

// Pure: order-independent comparison by playerId+place only (a "conflicting"
// report per §11.6/§21.5 means a different outcome, not a metric/tiebreak
// discrepancy). Used by reportResult to decide whether a later report for an
// already-resolved match is a no-op or needs flagging.
function placementsMatch(a: PlacementEntry[], b: PlacementEntry[]): boolean {
	if (a.length !== b.length) return false
	const aByPlayer = new Map(a.map((p) => [p.playerId, p.place]))
	return b.every((p) => aByPlayer.get(p.playerId) === p.place)
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

	// Phase 8: hash-mismatch and elapsed-time-gate checks, evaluated per player
	// against replayLogService's live buffer -- must run BEFORE finalizeRun
	// clears it. Flags, doesn't reject: a flagged result still applies ELO
	// normally (see resolveRankedResult) -- rejecting outright would strand the
	// match with no moderator remediation path (cross-validation/conflict
	// review is a separate, out-of-scope piece of work). This mirrors
	// matchmaking.gateway.ts's applySecondaryMetric, which already warns and
	// skips rather than rejecting on an implausible metric.
	function evaluateAntiCheat(
		match: Match,
		placements: PlacementEntry[],
	): Map<string, FlagReason> {
		const flags = new Map<string, FlagReason>()
		const elapsedMs = Date.now() - match.createdAt.getTime()
		for (const p of placements) {
			if (replayLogService.verifyPlayerHash(match.lobbyCode, p.playerId) === 'mismatch') {
				flags.set(p.playerId, 'hash_mismatch')
				continue
			}
			const minExpectedMs =
				replayLogService.countHandResultEvents(match.lobbyCode, p.playerId) * MIN_MS_PER_HAND
			if (elapsedMs < minExpectedMs) flags.set(p.playerId, 'elapsed_time_gate')
		}
		return flags
	}

	// The ranked resolution path -- shared by a normal host-submitted
	// reportResult and Phase 8.4's autoForfeitMatch (a disconnected player is
	// simply placed last in the same placements shape). Anti-cheat is
	// evaluated here, before matches/matchByLobby are cleared and before
	// finalizeRun clears replayLogService's buffer, since both reads depend on
	// that buffer still being live.
	async function resolveRankedResult(
		matchId: string,
		match: Match,
		placements: PlacementEntry[],
		reportedBy: string,
	): Promise<void> {
		const season = await matchRepository.getCurrentSeason()
		if (!season) throw new AppError('No active season', 500)

		const flags = evaluateAntiCheat(match, placements)

		const ratingResults = await matchRepository.applyRatingTransaction(
			matchId,
			match,
			season.id,
			placements,
		)
		// Persisted so a later report for this matchId (§11.6 "first report
		// wins") has something to compare against once the in-memory match
		// below is gone, instead of just 404ing.
		await matchRepository.recordMatchResult(matchId, placements, reportedBy)

		matches.delete(matchId)
		matchByLobby.delete(match.lobbyCode)
		await replayLogService.finalizeRun(match.lobbyCode, 'completed', flags)

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

	// §11.6: any player in the match may report (not just the host), and the
	// FIRST report received is authoritative. If the match already resolved
	// (this is a later report for the same matchId), compare against the
	// persisted result instead of 404ing: a matching report is a silent no-op,
	// a differing one is flagged for manual moderator review (§21.5) without
	// altering the already-applied outcome.
	async function reportResult(
		session: PlayerSession,
		matchId: string,
		placements: PlacementEntry[],
	): Promise<void> {
		const match = matches.get(matchId)

		if (!match) {
			const resolved = await matchRepository.getResolvedMatchResult(matchId)
			if (!resolved) throw new AppError('Match not found', 404)

			const reporterWasParticipant = resolved.placements.some(
				(p) => p.playerId === session.playerId,
			)
			if (!reporterWasParticipant) {
				throw new AppError('Not a participant in this match', 403)
			}

			if (placementsMatch(resolved.placements, placements)) {
				return
			}

			await insertMatchConflict({
				matchId,
				lobbyCode: resolved.lobbyCode,
				firstReporterId: resolved.reportedBy,
				firstPlacements: resolved.placements,
				conflictingReporterId: session.playerId,
				conflictingPlacements: placements,
			})
			return
		}

		if (!match.playerIds.includes(session.playerId)) {
			throw new AppError('Not a participant in this match', 403)
		}

		const lobby = getLobby(match.lobbyCode)
		if (!lobby) throw new AppError('Lobby not found', 404)

		if (!isRanked(match.gameMode)) {
			await matchRepository.recordMatchResult(matchId, placements, session.playerId)
			await matchRepository.updateMatchStatus(matchId, 'resolved')
			matches.delete(matchId)
			matchByLobby.delete(match.lobbyCode)
			await replayLogService.finalizeRun(match.lobbyCode, 'completed')
			return
		}

		await resolveRankedResult(matchId, match, placements, session.playerId)
	}

	// Phase 8.4: the ranked-match counterpart of a host-submitted reportResult,
	// triggered by grace-period.service.ts's expireGracePeriod when a
	// disconnected player's 2-minute grace period runs out mid-match. Not
	// exposed over HTTP -- there's no player action here, just the server
	// resolving a match nobody is left to report.
	async function autoForfeitMatch(
		matchId: string,
		disconnectedPlayerId: string,
		remainingConnectedPlayerIds: string[],
	): Promise<void> {
		const match = matches.get(matchId)
		if (!match) return // already resolved (e.g. the other player's grace expired first) -- no-op

		if (remainingConnectedPlayerIds.length === 0) {
			// Both players disconnected -- no legitimate winner to forfeit to.
			// Cancel with no ELO applied to either side (§9.8).
			await matchRepository.updateMatchStatus(matchId, 'resolved')
			matches.delete(matchId)
			matchByLobby.delete(match.lobbyCode)
			await replayLogService.finalizeRun(match.lobbyCode, 'abandoned')
			return
		}

		// place=1 for every remaining player, last place for the disconnected one
		// -- correct for ranked's current 1v1-only shape (see gameMode strings
		// like "ranked:1v1"); would tie multiple remaining players for first in
		// a hypothetical >2-player ranked match, which doesn't exist today.
		const placements: PlacementEntry[] = match.playerIds.map((id) => ({
			playerId: id,
			place: id === disconnectedPlayerId ? match.playerIds.length : 1,
		}))
		await resolveRankedResult(matchId, match, placements, 'system')
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
		autoForfeitMatch,
	}
}
