// Finished games in Nakama storage: the run record and each player's replay
// log (owned by the system user), plus a pointer per participant so players
// can list their own runs. Written by the bmp_lobby match; read by the run
// RPCs below.
import { INVALID_ARGUMENT, NOT_FOUND, UNAUTHENTICATED, runtimeError } from '../errors'
import { parsePayload, requireUser } from '../rpc'
import { tuplesOfStored } from '../shared/replay/events'
import { checkLog, logGapsOf, logHeldOf } from './log_check'
import {
	type LogCheck,
	LOGS_COLLECTION,
	MY_RUNS_COLLECTION,
	type PlayerLog,
	RUNS_COLLECTION,
	type RunRecord,
	SYSTEM_USER_ID,
} from './protocol'

// Newest-first key order, so a player's first storageList page is their most
// recent games (listing is in key order, and a run id is a random uuid).
export function myRunKey(run: RunRecord): string {
	const reversed = String(9_999_999_999_999 - run.endedAt).padStart(13, '0')
	return `${reversed}:${run.runId}`
}

export function logKey(runId: string, playerId: string): string {
	return `${runId}:${playerId}`
}

// Each player's replay log checked against the hash they sent.
export function logChecksOf(
	run: RunRecord,
	logs: { [userId: string]: PlayerLog },
	sha256: (input: string) => string,
): { [userId: string]: LogCheck } {
	const checks: { [userId: string]: LogCheck } = {}
	for (const player of run.players)
		checks[player.id] = checkLog(logs[player.id], sha256).check
	return checks
}

// The storage writes for a finished run: the record (with each player's
// log check, gap count and held count), a log per player and a pointer per player. Pure, so it can be
// tested; sha256 returns a hex digest.
export function runWrites(
	run: RunRecord,
	logs: { [userId: string]: PlayerLog },
	sha256: (input: string) => string,
): nkruntime.StorageWriteRequest[] {
	const checks: { [userId: string]: ReturnType<typeof checkLog> } = {}
	const logChecks: { [userId: string]: LogCheck } = {}
	const logGaps: { [userId: string]: number } = {}
	const logHeld: { [userId: string]: number } = {}
	for (const player of run.players) {
		checks[player.id] = checkLog(logs[player.id], sha256)
		logChecks[player.id] = checks[player.id].check
		logGaps[player.id] = logGapsOf(logs[player.id])
		logHeld[player.id] = logHeldOf(logs[player.id])
	}
	const writes: nkruntime.StorageWriteRequest[] = [
		{
			collection: RUNS_COLLECTION,
			key: run.runId,
			userId: SYSTEM_USER_ID,
			value: { ...run, logChecks, logGaps, logHeld },
			permissionRead: 2,
			permissionWrite: 0,
		},
	]
	for (const player of run.players) {
		const log = logs[player.id]
		writes.push({
			collection: LOGS_COLLECTION,
			key: logKey(run.runId, player.id),
			userId: SYSTEM_USER_ID,
			value: {
				lines: log ? log.lines : [],
				eventCount: log ? log.lines.length : 0,
				truncated: log ? log.truncated : false,
				gaps: logGaps[player.id],
				carbonHash: checks[player.id].carbonHash,
				check: checks[player.id].check,
			},
			permissionRead: 0,
			permissionWrite: 0,
		})
		const placement = run.placements.filter((p) => p.playerId === player.id)[0]
		writes.push({
			collection: MY_RUNS_COLLECTION,
			key: myRunKey(run),
			userId: player.id,
			value: {
				runId: run.runId,
				code: run.code,
				modId: run.modId,
				startedAt: run.startedAt,
				endedAt: run.endedAt,
				status: run.status,
				place: placement ? placement.place : null,
				rating: (run.ratings && run.ratings[player.id]) || null,
			},
			permissionRead: 1,
			permissionWrite: 0,
		})
	}
	return writes
}

export function saveRun(
	nk: nkruntime.Nakama,
	run: RunRecord,
	logs: { [userId: string]: PlayerLog },
) {
	const writes = runWrites(run, logs, (input) => nk.sha256Hash(input))
	nk.storageWrite(writes)
	return writes[0].value as { logChecks: { [userId: string]: LogCheck } }
}

export function readRun(nk: nkruntime.Nakama, runId: unknown): RunRecord {
	if (typeof runId !== 'string' || runId === '')
		throw runtimeError(INVALID_ARGUMENT, 'runId is required')
	const objects = nk.storageRead([
		{ collection: RUNS_COLLECTION, key: runId, userId: SYSTEM_USER_ID },
	])
	if (objects.length === 0) throw runtimeError(NOT_FOUND, 'Run not found')
	return objects[0].value as unknown as RunRecord
}

// {runId} -> the run record. Only the run's participants may read it: the
// record carries every player's reports, anti-cheat flags and log checks.
export function rpcRunGet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const run = readRun(nk, parsePayload(payload).runId)
	if (!run.players.some((p) => p.id === userId))
		throw runtimeError(NOT_FOUND, 'Run not found')
	return JSON.stringify(run)
}

// {runId, playerId?} -> {logs: {playerId: {events, eventCount, truncated}}}.
// Only the run's participants may read its logs.
export function rpcRunLogs(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	const run = readRun(nk, input.runId)
	if (!run.players.some((p) => p.id === userId))
		throw runtimeError(NOT_FOUND, 'Run not found')
	const wanted = run.players.filter(
		(p) => typeof input.playerId !== 'string' || p.id === input.playerId,
	)
	const objects = nk.storageRead(
		wanted.map((p) => ({
			collection: LOGS_COLLECTION,
			key: logKey(run.runId, p.id),
			userId: SYSTEM_USER_ID,
		})),
	)
	const logs: { [playerId: string]: unknown } = {}
	for (const object of objects) {
		const { lines, ...rest } = object.value as { lines?: unknown; [key: string]: unknown }
		logs[object.key.slice(run.runId.length + 1)] = { ...rest, events: tuplesOfStored(object.value) }
	}
	return JSON.stringify({ logs })
}

const RUNS_PAGE = 20

// {cursor?} -> {runs: [{runId, code, modId, startedAt, endedAt, status,
// place}], cursor}.
export function rpcRunsMine(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	const cursor = typeof input.cursor === 'string' ? input.cursor : ''
	let page: ReturnType<nkruntime.Nakama['storageList']>
	try {
		page = nk.storageList(userId, MY_RUNS_COLLECTION, RUNS_PAGE, cursor)
	} catch (e) {
		// Nakama throws "Malformed cursor was used" for a cursor it didn't
		// hand out: the caller's mistake, not an uncaught 500.
		if (cursor !== '') throw runtimeError(INVALID_ARGUMENT, 'Invalid cursor')
		throw e
	}
	return JSON.stringify({
		runs: (page.objects || []).map((o) => o.value),
		cursor: page.cursor || '',
	})
}
