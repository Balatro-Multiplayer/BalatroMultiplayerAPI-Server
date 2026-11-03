import type {
	IReplayLogRepository,
	ReplayResponse,
	ReplaySide,
	ReplayViewerRole,
	RunRow,
} from '../../contracts/IReplayLogRepository.js'
import * as replayLogGateway from '../../infrastructure/gateways/replay-log.gateway.js'
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
}

export type ReplayLogService = ReturnType<typeof createReplayLogService>

export function createReplayLogService(deps: ReplayLogServiceDeps) {
	const { repository } = deps

	// GET /api/runs/:runId/replay. Players in the run and moderators get every
	// side in full. Anyone else gets a 404 unless at least one side is shared;
	// then shared sides come in full and the others are reduced to the result,
	// lives lost and PvP blind scores. isModerator is resolved by the route from
	// the requester's DB-stored privileges, same check webAdmin's middleware uses.
	async function getReplay(
		runId: string,
		viewer: { playerId: string | null; isModerator: boolean },
	): Promise<ReplayResponse> {
		const result = await repository.getRunWithLogs(runId)
		if (!result) throw new AppError('Run not found', 404)

		const isParticipant =
			viewer.playerId !== null &&
			result.logs.some((log) => log.playerId === viewer.playerId)
		const role: ReplayViewerRole = viewer.isModerator
			? 'moderator'
			: isParticipant
				? 'participant'
				: 'public'
		const seesEverything = role !== 'public'
		if (!seesEverything && !result.logs.some((log) => log.sharedAt)) {
			throw new AppError('Run not found', 404)
		}

		const names = await repository.getDisplayNames(
			result.logs.map((log) => log.playerId),
		)
		const logs = result.logs.map((log): ReplaySide => {
			const shared = log.sharedAt !== null
			const hidden = !seesEverything && !shared
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
			return seesEverything
				? side
				: { ...side, carbonHash: null, flagReason: null }
		})

		return {
			run: result.run,
			logs,
			viewer:
				viewer.playerId === null
					? { role }
					: { role, playerId: viewer.playerId },
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

	// Admin Match History's "View Log" button: resolves a page of matchIds to
	// their run ids in one query.
	async function getRunIdsForMatchIds(
		matchIds: string[],
	): Promise<Map<string, string>> {
		return repository.getRunIdsForMatchIds(matchIds)
	}

	return { getReplay, setShared, listMyRuns, getRunIdsForMatchIds }
}

export const replayLogService = createReplayLogService({
	repository: replayLogGateway,
})
