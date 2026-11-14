// Sweeps lobby checkpoints (lobby/checkpoint.ts) nobody came back for. A
// checkpoint is only deleted when a player asks for its code after it
// expires, so rows piled up, and a started game whose players all stayed away
// never got a result. The sweep deletes each expired row. A row that holds a
// started game first records it as "no contest": an `abandoned` run (no
// placements, so no Elo change: see rating/apply.ts) and a log line for
// moderators. The API's hourly job calls admin_checkpoints_sweep.
import { finishGame } from '../actions/results'
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { enqueue } from '../mirror/outbox'
import { parsePayload, requireServer } from '../rpc'
import { CLAIM_TIMEOUT_MS, type Checkpoint, hasCurrentSchema, isExpired } from './checkpoint'
import { LOBBY_CHECKPOINT_COLLECTION, SYSTEM_USER_ID } from './protocol'
import { saveRun } from './storage'

const LIST_PAGE = 100
// Rows swept per call at most, so one call stays short; the caller repeats
// while `more` is set.
export const SWEEP_MAX = 200

export interface SweepResult {
	deleted: number
	noContest: number
	more: boolean
}

// Whether the sweep may drop `checkpoint`: it expired, and no resume claimed
// it a moment ago (that resume is still creating its match). `ttlMs` replaces
// the row's own expiry (a test hook for the live check, see the RPC).
export function isSweepable(checkpoint: Checkpoint, now: number, ttlMs?: number): boolean {
	const expired = ttlMs === undefined ? isExpired(checkpoint, now) : now >= checkpoint.at + ttlMs
	if (!expired) return false
	return checkpoint.claimedAt === null || now - checkpoint.claimedAt >= CLAIM_TIMEOUT_MS
}

// Stores the checkpoint's started game as no contest. Throws if it can't be
// stored, so the row stays for the next sweep.
function recordNoContest(nk: nkruntime.Nakama, logger: nkruntime.Logger, checkpoint: Checkpoint, now: number) {
	const lobby = checkpoint.lobby
	const finished = finishGame(lobby, now, { status: 'abandoned', announce: false })
	for (const effect of finished.out) {
		if (effect.kind !== 'saveRun') continue
		saveRun(nk, effect.run, effect.logs)
		try {
			enqueue(nk, { kind: 'run', at: now, runId: effect.run.runId, rating: null })
		} catch (e) {
			logger.warn('Checkpoint %s: could not queue run %s for the mirror: %v', lobby.code, effect.run.runId, e)
		}
		logger.warn(
			'Lobby %s: run %s ended as no contest: every player stayed away past the checkpoint time limit (%d players, no Elo change)',
			lobby.code,
			effect.run.runId,
			effect.run.players.length,
		)
	}
}

// Deletes up to `max` expired checkpoints.
export function sweepCheckpoints(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger,
	now: number,
	max: number,
	ttlMs?: number,
): SweepResult {
	const result: SweepResult = { deleted: 0, noContest: 0, more: false }
	let cursor = ''
	do {
		const page = nk.storageList(SYSTEM_USER_ID, LOBBY_CHECKPOINT_COLLECTION, LIST_PAGE, cursor)
		for (const o of page.objects || []) {
			const checkpoint = o.value as unknown as Checkpoint
			// Another build's shape cannot be read, so it is deleted with no run
			// record (as resumeLobby does), expired or not.
			const readable = hasCurrentSchema(checkpoint)
			if (readable && !isSweepable(checkpoint, now, ttlMs)) continue
			if (result.deleted >= max) {
				result.more = true
				return result
			}
			try {
				if (readable && checkpoint.lobby.game.started) {
					recordNoContest(nk, logger, checkpoint, now)
					result.noContest++
				}
				nk.storageDelete([{ collection: LOBBY_CHECKPOINT_COLLECTION, key: o.key, userId: SYSTEM_USER_ID }])
				result.deleted++
			} catch (e) {
				logger.error('Checkpoint %s: could not sweep: %v', o.key, e)
			}
		}
		cursor = page.cursor || ''
	} while (cursor)
	return result
}

// {max?, ttlMs?} -> {deleted, noContest, more}. ttlMs is for tests: it treats
// a checkpoint written more than ttlMs ago as expired (a live check with a
// short TTL). Only the server may call this RPC.
export function rpcAdminCheckpointsSweep(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const max = parsePayload(payload).max ?? SWEEP_MAX
	if (typeof max !== 'number' || !Number.isInteger(max) || max < 1)
		throw runtimeError(INVALID_ARGUMENT, 'max must be a positive whole number')
	const ttlMs = parsePayload(payload).ttlMs
	if (ttlMs !== undefined && (typeof ttlMs !== 'number' || !Number.isInteger(ttlMs) || ttlMs < 0))
		throw runtimeError(INVALID_ARGUMENT, 'ttlMs must be a whole number of 0 or more')
	const result = sweepCheckpoints(nk, logger, Date.now(), max, ttlMs)
	if (result.deleted > 0) logger.info('Swept %d expired checkpoints (%d no contest)', result.deleted, result.noContest)
	return JSON.stringify(result)
}
