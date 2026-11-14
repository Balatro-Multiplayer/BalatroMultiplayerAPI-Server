// Admin RPCs behind the API's moderator service queue: a run's full record
// for its evidence, a moderator's overturn of a run's result, and the
// moderation context of a player (admin_player_get's extension). Server to
// server only, like admin.ts.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { readIntegrity } from '../integrity'
import { liveRecordsOf } from '../matchmaking/queue'
import { LOGS_COLLECTION, MY_RUNS_COLLECTION, RUNS_COLLECTION, type RunRecord, SYSTEM_USER_ID } from '../lobby/protocol'
import { currentLobby } from '../lobby/rpc'
import { logKey, myRunKey, readRun } from '../lobby/storage'
import { tuplesOfStored } from '../shared/replay/events'
import { parsePayload, requireServer } from '../rpc'
import { standingFor } from '../standing/current'
import { readModReport } from '../standing/storage'
import { rankedContextOf } from './ranked'
import { overturnRun, parseResultPlacements } from './result'
import type { ServerSettings } from '../server_kind'

interface StoredLog {
	lines?: string[]
	events?: unknown[]
	eventCount?: number
	truncated?: boolean
	carbonHash?: string | null
	check?: string
	gaps?: number
}

// Each player's log, summarised (events only when asked for).
function logsOf(nk: nkruntime.Nakama, run: RunRecord, withEvents: boolean) {
	const objects = nk.storageRead(
		run.players.map((p) => ({ collection: LOGS_COLLECTION, key: logKey(run.runId, p.id), userId: SYSTEM_USER_ID })),
	)
	const logs: { [userId: string]: unknown } = {}
	for (const object of objects) {
		const log = object.value as StoredLog
		const userId = object.key.slice(run.runId.length + 1)
		logs[userId] = {
			eventCount: log.eventCount || 0,
			truncated: log.truncated === true,
			carbonHash: log.carbonHash ?? null,
			check: log.check || 'unavailable',
			gaps: log.gaps || 0,
			...(withEvents ? { events: tuplesOfStored(log) } : {}),
		}
	}
	return logs
}

// {runId, events?} -> {run, logs: {userId: {eventCount, truncated,
// carbonHash, check, gaps, events?}}}: the stored record, with every player's
// reports, flags and log checks.
export function rpcAdminRunGet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const run = readRun(nk, input.runId)
	return JSON.stringify({ run, logs: logsOf(nk, run, input.events === true) })
}

// {runId, placements: [{playerId, place}]} -> {run}: replaces the recorded
// result, and each participant's my_runs place with it. Ratings are the
// caller's to rebuild (admin_ratings_set).
export function rpcAdminRunSetResult(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const run = readRun(nk, input.runId)
	const placements = parseResultPlacements(input.placements)
	if (!placements) throw runtimeError(INVALID_ARGUMENT, 'placements must be a list of {playerId, place}')
	const overturn = overturnRun(run, placements, Date.now())
	if (!overturn.ok) {
		const message =
			overturn.refusal.kind === 'players_differ'
				? 'placements must place exactly the run\'s players'
				: overturn.refusal.kind === 'unchanged'
					? 'That is already the recorded result'
					: 'placements must be a list of {playerId, place}'
		throw runtimeError(INVALID_ARGUMENT, message)
	}
	const next = overturn.run
	const key = myRunKey(next)
	const pointers = nk.storageRead(run.players.map((p) => ({ collection: MY_RUNS_COLLECTION, key, userId: p.id })))
	const writes: nkruntime.StorageWriteRequest[] = [
		{
			collection: RUNS_COLLECTION,
			key: next.runId,
			userId: SYSTEM_USER_ID,
			value: next as unknown as { [key: string]: unknown },
			permissionRead: 2,
			permissionWrite: 0,
		},
	]
	for (const pointer of pointers) {
		writes.push({
			collection: MY_RUNS_COLLECTION,
			key,
			userId: pointer.userId,
			value: { ...pointer.value, place: overturn.places[pointer.userId] ?? null },
			permissionRead: 1,
			permissionWrite: 0,
		})
	}
	nk.storageWrite(writes)
	logger.info('Run %s result overturned by the service queue', next.runId)
	return JSON.stringify({ run: next })
}

// What admin_player_get adds for a moderator: the last mod report, standing,
// the launcher verdict and whether they are in ranked play right now.
export function moderationContextOf(nk: nkruntime.Nakama, logger: nkruntime.Logger, settings: ServerSettings, userId: string, now: number) {
	const seat = currentLobby(nk, logger, userId)
	const match = seat ? nk.matchGet(seat.matchId) : null
	return {
		mods: readModReport(nk, userId),
		standing: standingFor(nk, settings, userId, now),
		integrity: readIntegrity(nk, userId),
		ranked: rankedContextOf(liveRecordsOf(nk, userId), match ? match.label : null),
	}
}
