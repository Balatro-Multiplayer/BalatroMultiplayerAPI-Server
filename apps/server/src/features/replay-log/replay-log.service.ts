import type {
	IReplayLogRepository,
	LobbyRunStatus,
	RunWithLogs,
} from '../../contracts/IReplayLogRepository.js'
import * as replayLogGateway from '../../infrastructure/gateways/replay-log.gateway.js'
import { compressToBase64 } from '../../shared/utils/compression.js'
import { AppError } from '../../shared/utils/errors.js'
import { getLobby } from '../../state/index.js'

// Indefinite (NULL expiresAt) is reserved for flagged/disputed runs -- Phase 8's
// job to set, mirroring the existing reports/flaggedMessages pattern.
const RUN_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface LogEvent {
	t: number
	opcode: string
	args?: unknown
}

interface PlayerBuffer {
	events: LogEvent[]
	carbonHash: string | null
}

interface RunBuffer {
	runId: string
	players: Map<string, PlayerBuffer>
}

export interface SpectatorSnapshotEntry {
	playerId: string
	ante: string | null
	score: string | null
	handsRemaining: number | null
}

interface ReplayLogServiceDeps {
	repository: IReplayLogRepository
}

export type ReplayLogService = ReturnType<typeof createReplayLogService>

// Buffers every player's `game_log_event` stream (see BalatroMultiplayerPvP's
// lib/replay_log.lua / pvp_api/replay_log_actions.lua) in memory, keyed by
// lobby code, and flushes it to matchRunLogs once the run ends -- whether that
// end is a clean result report or an abandoned/terminated lobby. This is the
// server-side half of Phase 3's transport; nothing else in this repo ever
// subscribed to MQTT before this.
export function createReplayLogService(deps: ReplayLogServiceDeps) {
	const { repository } = deps
	const runs = new Map<string, RunBuffer>()

	async function handleActionLogEvent(
		lobbyCode: string,
		playerId: string,
		params: Record<string, unknown>,
	): Promise<void> {
		if (typeof params.t !== 'number' || typeof params.opcode !== 'string')
			return
		const event: LogEvent = {
			t: params.t,
			opcode: params.opcode,
			args: params.args,
		}

		let run = runs.get(lobbyCode)
		if (!run) {
			const lobby = getLobby(lobbyCode)
			if (!lobby) return // lobby already gone -- nothing to anchor this run to

			const runId = await repository.insertRun({
				lobbyCode,
				modId: lobby.modId,
				lobbyType: lobby.type,
				matchmakingMatchId: null,
			})
			run = { runId, players: new Map() }
			runs.set(lobbyCode, run)
		}

		let playerBuf = run.players.get(playerId)
		if (!playerBuf) {
			playerBuf = { events: [], carbonHash: null }
			run.players.set(playerId, playerBuf)
		}
		playerBuf.events.push(event)

		if (
			event.opcode === 'chk' &&
			event.args &&
			typeof event.args === 'object'
		) {
			const carbon = (event.args as { carbon?: unknown }).carbon
			if (typeof carbon === 'string') playerBuf.carbonHash = carbon
		}
	}

	// Idempotent: a run already flushed (buffer cleared) is a no-op, so both a
	// clean "reportResult" hook and a later lobby-closed cleanup hook can call
	// this for the same lobby without double-writing.
	async function finalizeRun(
		lobbyCode: string,
		status: LobbyRunStatus,
	): Promise<void> {
		const run = runs.get(lobbyCode)
		if (!run) return
		runs.delete(lobbyCode)

		const expiresAt = new Date(Date.now() + RUN_TTL_MS)
		const playerStatus = status === 'completed' ? 'complete' : 'partial'

		for (const [playerId, buf] of run.players) {
			await repository.upsertPlayerLog({
				runId: run.runId,
				playerId,
				compressedEvents: compressToBase64(JSON.stringify(buf.events)),
				carbonHash: buf.carbonHash,
				eventCount: buf.events.length,
				status: playerStatus,
				expiresAt,
			})
		}

		await repository.updateRunStatus(run.runId, status)
	}

	function hasBufferedRun(lobbyCode: string): boolean {
		return runs.has(lobbyCode)
	}

	// Phase 6: GET /api/runs/:runId/replay. Restricted to the run's own
	// participants -- there's no broader "public replay" access tier designed
	// yet, so this is the conservative default.
	async function getReplay(
		runId: string,
		requesterId: string,
	): Promise<RunWithLogs> {
		const result = await repository.getRunWithLogs(runId)
		if (!result) throw new AppError('Run not found', 404)
		if (!result.logs.some((log) => log.playerId === requesterId)) {
			throw new AppError('Not a participant in this run', 403)
		}
		return result
	}

	// Phase 7: best-effort one-time state snapshot for a spectator joining a
	// live match, derived from whatever the in-memory buffer has observed so
	// far for each player (their most recent ante marker and hand result).
	// Returns [] for a lobby with no buffered run yet (e.g. still in the menu).
	function getSpectatorSnapshot(lobbyCode: string): SpectatorSnapshotEntry[] {
		const run = runs.get(lobbyCode)
		if (!run) return []

		const snapshot: SpectatorSnapshotEntry[] = []
		for (const [playerId, buf] of run.players) {
			let ante: string | null = null
			let score: string | null = null
			let handsRemaining: number | null = null

			for (const event of buf.events) {
				if (event.opcode === 'set_ante_key' && typeof event.args === 'string') {
					ante = event.args
				} else if (
					event.opcode === 'hand_result' &&
					Array.isArray(event.args)
				) {
					const [s, h] = event.args
					if (typeof s === 'string') score = s
					if (typeof h === 'number') handsRemaining = h
				}
			}

			snapshot.push({ playerId, ante, score, handsRemaining })
		}
		return snapshot
	}

	return {
		handleActionLogEvent,
		finalizeRun,
		hasBufferedRun,
		getReplay,
		getSpectatorSnapshot,
	}
}

// Module-level singleton, matching mqttService/gracePeriodService -- the
// lobby lifecycle hooks (grace-period expiry, explicit leave) and
// matchmaking's reportResult all need to reach the same buffer without being
// threaded through DI at every call site.
export const replayLogService = createReplayLogService({
	repository: replayLogGateway,
})
