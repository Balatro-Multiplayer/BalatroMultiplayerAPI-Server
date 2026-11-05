// Account deletion (Notice decision 17), before the account goes. The same
// three kinds of data as Postgres (the API's player-anonymization gateway):
// - own data goes: the player's own objects (with the account), their logs,
//   runs only they played, pending mirror entries of their own (normal chat,
//   Notice acceptance), their legacy rating claim, lobby checkpoints and group
//   parties that name them.
// - a shared run (one other players played too) names DELETED_PLAYER_ID, one
//   standard id every deleted player shares, so the other players' history
//   stays whole.
// - moderation data names a random anonymous id, which the API also gives
//   the Postgres rows: runs an open report or ban uses (with the player's
//   log), flagged chat and forfeits on their way to Postgres, network bans,
//   and the ban index when the player has a ban record.
import {
	BINDING_COLLECTION,
	type GroupBinding,
	deleteBinding,
} from '../matchmaking/group/binding'
import {
	LOBBY_CHECKPOINT_COLLECTION,
	LOGS_COLLECTION,
	MY_RUNS_COLLECTION,
	RUNS_COLLECTION,
	type RunRecord,
	SYSTEM_USER_ID,
} from '../lobby/protocol'
import { logKey } from '../lobby/storage'
import { MIRROR_COLLECTION, type MirrorEntry } from '../mirror/outbox'
import { BAN_INDEX_COLLECTION, loginKeys } from '../moderation/enforce'
import {
	IP_HASHES_COLLECTION,
	IP_HASHES_KEY,
	NETWORK_BANS_COLLECTION,
} from '../moderation/network'
import { LEGACY_RATINGS_COLLECTION, type LegacyPlayer } from '../rating/legacy'
import { forEachStored } from '../shared/storage'
import { steamIdHashOf } from './steam_id'

// The same values as the API's shared/deleted-player.ts (a test checks).
export const DELETED_PLAYER_ID = '00000000-0000-4000-8000-000000000000'
export const DELETED_PLAYER_NAME = '[deleted player]'

// value with every string equal to `from`, and every object key equal to it,
// replaced by `to`. Pure.
export function replaceId<T>(value: T, from: string, to: string): T {
	if (value === from) return to as unknown as T
	if (Array.isArray(value))
		return value.map((v) => replaceId(v, from, to)) as unknown as T
	if (value !== null && typeof value === 'object') {
		const next: { [key: string]: unknown } = {}
		for (const key of Object.keys(value))
			next[key === from ? to : key] = replaceId(
				(value as { [key: string]: unknown })[key],
				from,
				to,
			)
		return next as T
	}
	return value
}

// The run with the player replaced by `to`, their display name dropped.
export function anonymizedRun(
	run: RunRecord,
	userId: string,
	to: string,
): RunRecord {
	const next = replaceId(run, userId, to)
	return {
		...next,
		players: next.players.map((p) =>
			p.id === to ? { ...p, displayName: DELETED_PLAYER_NAME } : p,
		),
	}
}

const SERVER_ONLY = { permissionRead: 0, permissionWrite: 0 } as const

function listAll(
	nk: nkruntime.Nakama,
	owner: string,
	collection: string,
): nkruntime.StorageObject[] {
	const all: nkruntime.StorageObject[] = []
	forEachStored(nk, owner, collection, (o) => {
		all.push(o)
	})
	return all
}

// What a deletion keeps as moderation data (the API decides, with the same
// rules as Postgres): the runs an open report or ban uses, and the ban index
// entries when the player has a ban record.
export interface DeletionKeep {
	keptRunIds: string[]
	keepSteamIdHash: boolean
}

// The player's runs (found by their own run pointers) and each one's log.
function anonymizeRuns(
	nk: nkruntime.Nakama,
	userId: string,
	anonymousId: string,
	keptRunIds: string[],
) {
	for (const pointer of listAll(nk, userId, MY_RUNS_COLLECTION)) {
		const runId = (pointer.value as { runId?: unknown }).runId
		if (typeof runId !== 'string') continue
		const runKey = {
			collection: RUNS_COLLECTION,
			key: runId,
			userId: SYSTEM_USER_ID,
		}
		const ownLog = {
			collection: LOGS_COLLECTION,
			key: logKey(runId, userId),
			userId: SYSTEM_USER_ID,
		}
		const [object] = nk.storageRead([runKey])
		if (!object) continue
		const run = object.value as unknown as RunRecord
		const kept = keptRunIds.indexOf(runId) !== -1
		const shared = run.players.some((p) => p.id !== userId)
		if (!kept && !shared) {
			nk.storageDelete([runKey, ownLog])
			continue
		}
		const to = kept ? anonymousId : DELETED_PLAYER_ID
		const writes: nkruntime.StorageWriteRequest[] = [
			{
				...runKey,
				value: anonymizedRun(run, userId, to) as unknown as {
					[key: string]: unknown
				},
				permissionRead: 2,
				permissionWrite: 0,
			},
		]
		const [log] = kept ? nk.storageRead([ownLog]) : []
		if (log)
			writes.push({
				collection: LOGS_COLLECTION,
				key: logKey(runId, anonymousId),
				userId: SYSTEM_USER_ID,
				value: log.value,
				...SERVER_ONLY,
			})
		nk.storageWrite(writes)
		nk.storageDelete([ownLog])
	}
}

// Pending mirror entries: the player's own ones (normal chat, a Notice
// acceptance) go; flagged chat, forfeits and Contests are moderation data and
// name the anonymous id. A run entry names only its run, handled above.
function anonymizeMirror(
	nk: nkruntime.Nakama,
	userId: string,
	anonymousId: string,
) {
	const writes: nkruntime.StorageWriteRequest[] = []
	const deletes: nkruntime.StorageReadRequest[] = []
	for (const o of listAll(nk, SYSTEM_USER_ID, MIRROR_COLLECTION)) {
		const entry = o.value as unknown as MirrorEntry
		const owner =
			entry.kind === 'chat'
				? entry.line.userId
				: entry.kind === 'run'
					? null
					: entry.kind === 'contest'
						? entry.by === userId || entry.against === userId
							? userId
							: null
						: entry.userId
		if (owner !== userId) continue
		const own =
			entry.kind === 'notice' || (entry.kind === 'chat' && !entry.line.flagged)
		if (own) {
			deletes.push({
				collection: MIRROR_COLLECTION,
				key: o.key,
				userId: SYSTEM_USER_ID,
			})
			continue
		}
		writes.push({
			collection: MIRROR_COLLECTION,
			key: o.key,
			userId: SYSTEM_USER_ID,
			value: replaceId(o.value, userId, anonymousId),
			...SERVER_ONLY,
		})
	}
	if (writes.length > 0) nk.storageWrite(writes)
	if (deletes.length > 0) nk.storageDelete(deletes)
}

const namesPlayer = (value: unknown, userId: string) =>
	JSON.stringify(value).indexOf(userId) !== -1

// Lobby checkpoints and group parties that name the player go.
function deleteLobbyState(nk: nkruntime.Nakama, userId: string) {
	const checkpoints = listAll(
		nk,
		SYSTEM_USER_ID,
		LOBBY_CHECKPOINT_COLLECTION,
	).filter((o) => namesPlayer(o.value, userId))
	if (checkpoints.length > 0)
		nk.storageDelete(
			checkpoints.map((o) => ({
				collection: LOBBY_CHECKPOINT_COLLECTION,
				key: o.key,
				userId: SYSTEM_USER_ID,
			})),
		)
	for (const o of listAll(nk, SYSTEM_USER_ID, BINDING_COLLECTION)) {
		const binding = o.value as unknown as GroupBinding
		if (namesPlayer(binding, userId))
			deleteBinding(nk, binding.partyId, binding.memberIds)
	}
}

// Every system-owned object of a collection whose value names the player,
// naming anonymousId instead.
function rewriteSystemObjects(
	nk: nkruntime.Nakama,
	collection: string,
	userId: string,
	anonymousId: string,
) {
	const writes: nkruntime.StorageWriteRequest[] = []
	for (const o of listAll(nk, SYSTEM_USER_ID, collection)) {
		const next = replaceId(o.value, userId, anonymousId)
		if (JSON.stringify(next) === JSON.stringify(o.value)) continue
		writes.push({
			collection,
			key: o.key,
			userId: SYSTEM_USER_ID,
			value: next,
			...SERVER_ONLY,
		})
	}
	if (writes.length > 0) nk.storageWrite(writes)
}

// The account-ban index entries for the player's login ids, keyed by their
// Steam id hash (or device id hash). Kept, naming the anonymous id, when the
// player has a ban record: they refuse a new account on the same login id
// while the ban is in force. The API's hourly job drops them when Postgres
// drops the hash (admin_ban_index_forget). Otherwise they go now.
function anonymizeBanIndex(
	nk: nkruntime.Nakama,
	userId: string,
	anonymousId: string,
	keep: boolean,
) {
	const objects = nk.storageRead(
		loginKeys(nk, userId).map((key) => ({
			collection: BAN_INDEX_COLLECTION,
			key,
			userId: SYSTEM_USER_ID,
		})),
	)
	if (objects.length === 0) return
	if (!keep) {
		nk.storageDelete(
			objects.map((o) => ({
				collection: BAN_INDEX_COLLECTION,
				key: o.key,
				userId: SYSTEM_USER_ID,
			})),
		)
		return
	}
	nk.storageWrite(
		objects.map((o) => ({
			collection: BAN_INDEX_COLLECTION,
			key: o.key,
			userId: SYSTEM_USER_ID,
			value: replaceId(o.value, userId, anonymousId),
			...SERVER_ONLY,
		})),
	)
}

// The legacy ratings the player claimed (rating/legacy.ts), keyed by their
// Steam id hash: own data.
function deleteLegacyRatings(nk: nkruntime.Nakama, userId: string) {
	const hash = steamIdHashOf(nk, userId)
	if (!hash) return
	const [parked] = nk.storageRead([
		{
			collection: LEGACY_RATINGS_COLLECTION,
			key: hash,
			userId: SYSTEM_USER_ID,
		},
	])
	if (!parked || (parked.value as unknown as LegacyPlayer).claimedBy !== userId)
		return
	nk.storageDelete([
		{
			collection: LEGACY_RATINGS_COLLECTION,
			key: hash,
			userId: SYSTEM_USER_ID,
		},
	])
}

// Handles everything system-owned that names userId (see the top). Call
// while the account still exists (its login ids and run pointers are read
// from it).
export function anonymizeAccount(
	nk: nkruntime.Nakama,
	userId: string,
	anonymousId: string,
	keep: DeletionKeep,
) {
	anonymizeRuns(nk, userId, anonymousId, keep.keptRunIds)
	deleteLegacyRatings(nk, userId)
	anonymizeMirror(nk, userId, anonymousId)
	deleteLobbyState(nk, userId)
	rewriteSystemObjects(nk, NETWORK_BANS_COLLECTION, userId, anonymousId)
	anonymizeBanIndex(nk, userId, anonymousId, keep.keepSteamIdHash)
	// A network ban keeps its own copy of the hashes until it is lifted.
	nk.storageDelete([
		{ collection: IP_HASHES_COLLECTION, key: IP_HASHES_KEY, userId },
	])
}
