import type { IModeratorLookup } from '../../contracts/IModeratorLookup.js'
import type {
	IReplayLogRepository,
	ReplayResponse,
	ReplayRun,
	ReplaySide,
	ReplayViewerRole,
	RunRow,
} from '../../contracts/IReplayLogRepository.js'
import { decompressFromBase64 } from '../../shared/utils/compression.js'
import { AppError } from '../../shared/utils/errors.js'
import { reduceToResultOnly } from './hidden-side.js'

function countEvents(block: string): number {
	return (JSON.parse(decompressFromBase64(block)) as unknown[]).length
}

// Finished runs and their replay logs, as the Nakama mirror stored them
// (features/nakama/mirror.service.ts), for the website and webadmin.

interface ReplayLogServiceDeps {
	repository: IReplayLogRepository
	moderators: IModeratorLookup
}

export type ReplayLogService = ReturnType<typeof createReplayLogService>

export function createReplayLogService(deps: ReplayLogServiceDeps) {
	const { repository, moderators } = deps

	// The viewer's role, resolved once: a moderator (from the DB-stored
	// privileges), else a player in the run, else public.
	async function viewerRole(
		playerId: string | null,
		logs: readonly { playerId: string }[],
	): Promise<ReplayViewerRole> {
		if (playerId !== null && (await moderators.isModerator(playerId))) {
			return 'moderator'
		}
		if (playerId !== null && logs.some((log) => log.playerId === playerId)) {
			return 'participant'
		}
		return 'public'
	}

	// GET /api/runs/:runId/replay. Players in the run and moderators get every
	// side in full. Anyone else gets a 404 unless at least one side is shared;
	// then shared sides come in full and the others are reduced to the result,
	// lives lost and PvP blind scores. A public viewer gets no lobby code.
	async function getReplay(
		runId: string,
		viewerPlayerId: string | null,
	): Promise<ReplayResponse> {
		const result = await repository.getRunWithLogs(runId)
		if (!result) throw new AppError('Run not found', 404)

		const role = await viewerRole(viewerPlayerId, result.logs)
		if (role === 'public' && !result.logs.some((log) => log.sharedAt)) {
			throw new AppError('Run not found', 404)
		}

		const names = await repository.getDisplayNames(
			result.logs.map((log) => log.playerId),
		)
		const logs = result.logs.map((log): ReplaySide => {
			const shared = log.sharedAt !== null
			const hidden = role === 'public' && !shared
			const { sharedAt: _sharedAt, ...rest } = log
			const side = {
				...rest,
				displayName: names.get(log.playerId) ?? 'Unknown player',
				shared,
				hidden,
			}
			if (hidden) {
				const compressedEvents = reduceToResultOnly(log.compressedEvents)
				return {
					...side,
					compressedEvents,
					eventCount: countEvents(compressedEvents),
					carbonHash: null,
					flagReason: null,
				}
			}
			// Anti-cheat details are for the match's own players and moderators.
			return role === 'public'
				? { ...side, carbonHash: null, flagReason: null }
				: side
		})

		const run: ReplayRun =
			role === 'public' ? { ...result.run, lobbyCode: null } : result.run
		return {
			run,
			logs,
			viewer:
				viewerPlayerId === null ? { role } : { role, playerId: viewerPlayerId },
		}
	}

	// Share or unshare the caller's own side. 404 when they have no row.
	async function setShared(
		runId: string,
		playerId: string,
		shared: boolean,
	): Promise<void> {
		const found = await repository.setShared(runId, playerId, shared)
		if (!found) throw new AppError('Run not found', 404)
	}

	// A player's own past runs, newest first ("My Matches").
	async function listMyRuns(
		playerId: string,
		page = 1,
		pageSize = 20,
	): Promise<{
		runs: RunRow[]
		total: number
		page: number
		pageSize: number
	}> {
		const { runs, total } = await repository.getRunsForPlayer(
			playerId,
			page,
			pageSize,
		)
		return { runs, total, page, pageSize }
	}

	return { getReplay, setShared, listMyRuns }
}
