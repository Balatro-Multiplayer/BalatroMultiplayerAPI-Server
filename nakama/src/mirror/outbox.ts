// The Nakama -> Postgres mirror. Postgres (the BMP API) still backs the
// website, webadmin and the moderators' service queue, so what Nakama games
// produce -- finished runs with their logs and ratings, chat lines, Notice
// acceptances -- is
// copied there. Nakama never pushes it: a finished game is stored from the
// match loop, where an HTTP call would block the VM, and the API may be down.
// Instead each fact is written to a system-owned outbox, and the API pulls
// it (admin_mirror_pull) and deletes what it has stored (admin_mirror_ack).
// An entry stays until it is acked, so nothing is lost while the API is away.
import { readProfile } from '../player/profile'
import type { LobbyKind } from '../review/ranked'
import { steamIdHashOf } from '../player/steam_id'
import { LOGS_COLLECTION, RATINGS_COLLECTION, RUNS_COLLECTION, type RunRecord, SYSTEM_USER_ID } from '../lobby/protocol'

export const MIRROR_COLLECTION = 'mirror_outbox'

// A finished run (its record, logs and ratings are read at pull time), or one
// chat line.
export type MirrorEntry =
	| { kind: 'run'; at: number; runId: string; rating: RatingBoard | null }
	| { kind: 'chat'; at: number; line: ChatLogLine }
	// A player back right after timing out of a matchmade game (lobby/forfeits.ts).
	| {
			kind: 'forfeit'
			at: number
			userId: string
			runId: string
			code: string
			forfeitedAt: number
			lobbyKind?: LobbyKind
	  }
	// A player accepted the Notice (player/session.ts rpcTosAccept); at is when.
	| { kind: 'notice'; at: number; userId: string; version: number }
	// A player contested the started game (mpapi_contest); the run is not over yet.
	| {
			kind: 'contest'
			at: number
			runId: string
			code: string
			by: string
			against: string
			lobbyKind: LobbyKind
	  }

// The rating board a ranked run counted on.
export interface RatingBoard {
	modId: string
	mode: string
	season: number
}

export interface ChatLogLine {
	lobbyCode: string
	// The lobby instance (its match id without the node), as reports carry it:
	// lobby codes are reused, this is not.
	lobbyId: string
	// Null when the lobby's label could not be read.
	lobbyKind: LobbyKind | null
	userId: string
	message: string
	flagged: boolean
	// Why a line was flagged (blocked, or published for review); null for a
	// line posted with no flag.
	verdict: ChatVerdict | null
}

export type ChatVerdict =
	| {
			source: 'remote'
			band: string
			// Only on a message the guard judged. Older lines have none.
			guardSafety?: string
			guardScore?: number
			guardContextUsed?: boolean
	  }
	| { source: 'local'; matches: { word: string; startIndex: number; endIndex: number }[] }

// Key order is pull order: the time, zero-padded, then a uuid for entries
// written in the same millisecond.
export function entryKey(at: number, unique: string): string {
	return `${String(at).padStart(15, '0')}-${unique}`
}

export function enqueue(nk: nkruntime.Nakama, entry: MirrorEntry) {
	nk.storageWrite([
		{
			collection: MIRROR_COLLECTION,
			key: entryKey(entry.at, nk.uuidv4()),
			userId: SYSTEM_USER_ID,
			value: entry as unknown as { [key: string]: unknown },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
}

// Who a Nakama user is in Postgres terms: the player row the API linked at
// their first login (legacyPlayerId), else their Steam id hash for the API
// to find or create the row by.
export interface MirrorPlayer {
	steamIdHash: string | null
	legacyPlayerId: string | null
	displayName: string
	// The account was deleted: the API must not link this id to a row.
	deleted: boolean
}

export interface PulledRun {
	key: string
	kind: 'run'
	at: number
	run: RunRecord & { logChecks?: { [userId: string]: string }; logGaps?: { [userId: string]: number } }
	// userId -> the stored log ({lines or legacy events, eventCount, truncated, carbonHash, check}).
	logs: { [userId: string]: unknown }
	rating: RatingBoard | null
	// userId -> their rating on that board as it stands now.
	ratings: { [userId: string]: unknown }
}

export interface PulledChat {
	key: string
	kind: 'chat'
	at: number
	line: ChatLogLine
}

export interface PulledForfeit {
	key: string
	kind: 'forfeit'
	at: number
	userId: string
	runId: string
	code: string
	forfeitedAt: number
}

export interface PulledNotice {
	key: string
	kind: 'notice'
	at: number
	userId: string
	version: number
}

export interface PulledContest {
	key: string
	kind: 'contest'
	at: number
	runId: string
	code: string
	by: string
	against: string
	lobbyKind: LobbyKind
}

export type PulledEntry = PulledRun | PulledChat | PulledForfeit | PulledNotice | PulledContest

function expandRun(nk: nkruntime.Nakama, key: string, entry: Extract<MirrorEntry, { kind: 'run' }>): PulledRun | null {
	const runs = nk.storageRead([{ collection: RUNS_COLLECTION, key: entry.runId, userId: SYSTEM_USER_ID }])
	if (runs.length === 0) return null
	const run = runs[0].value as unknown as PulledRun['run']
	const logs: { [userId: string]: unknown } = {}
	const stored = nk.storageRead(
		run.players.map((p) => ({ collection: LOGS_COLLECTION, key: `${run.runId}:${p.id}`, userId: SYSTEM_USER_ID })),
	)
	for (const object of stored) logs[object.key.slice(run.runId.length + 1)] = object.value
	const ratings: { [userId: string]: unknown } = {}
	if (entry.rating) {
		const board = `${entry.rating.modId}:${entry.rating.mode}:${entry.rating.season}`
		for (const object of nk.storageRead(
			run.players.map((p) => ({ collection: RATINGS_COLLECTION, key: board, userId: p.id })),
		))
			ratings[object.userId] = object.value
	}
	return { key, kind: 'run', at: entry.at, run, logs, rating: entry.rating, ratings }
}

function mirrorPlayer(nk: nkruntime.Nakama, userId: string): MirrorPlayer {
	let steamIdHash: string | null = null
	let deleted = false
	try {
		steamIdHash = steamIdHashOf(nk, userId)
	} catch (e) {
		// The account is gone; the API keeps whatever row it already has.
		deleted = true
	}
	const stored = readProfile(nk, userId)
	const profile = stored ? stored.profile : null
	return {
		steamIdHash,
		legacyPlayerId: profile ? profile.legacyPlayerId : null,
		displayName: profile ? profile.steamName : '',
		deleted,
	}
}

// The oldest `limit` entries, expanded, and every player they name. A run
// whose record is gone (it can't be, short of manual deletion) comes back as
// a bare key, so it is acked and dropped rather than blocking the outbox.
export function pullEntries(
	nk: nkruntime.Nakama,
	limit: number,
): { entries: PulledEntry[]; dropped: string[]; players: { [userId: string]: MirrorPlayer } } {
	const page = nk.storageList(SYSTEM_USER_ID, MIRROR_COLLECTION, limit, '')
	const entries: PulledEntry[] = []
	const dropped: string[] = []
	const userIds: { [userId: string]: boolean } = {}
	for (const object of page.objects || []) {
		const entry = object.value as unknown as MirrorEntry
		if (entry.kind === 'run') {
			const pulled = expandRun(nk, object.key, entry)
			if (!pulled) {
				dropped.push(object.key)
				continue
			}
			for (const p of pulled.run.players) userIds[p.id] = true
			entries.push(pulled)
		} else if (entry.kind === 'chat') {
			userIds[entry.line.userId] = true
			entries.push({ key: object.key, kind: 'chat', at: entry.at, line: entry.line })
		} else if (entry.kind === 'forfeit' || entry.kind === 'notice') {
			userIds[entry.userId] = true
			entries.push({ key: object.key, ...entry })
		} else if (entry.kind === 'contest') {
			userIds[entry.by] = true
			userIds[entry.against] = true
			entries.push({ key: object.key, ...entry })
		} else {
			dropped.push(object.key)
		}
	}
	const players: { [userId: string]: MirrorPlayer } = {}
	for (const userId in userIds) players[userId] = mirrorPlayer(nk, userId)
	return { entries, dropped, players }
}

export function ackEntries(nk: nkruntime.Nakama, keys: string[]) {
	if (keys.length === 0) return
	nk.storageDelete(keys.map((key) => ({ collection: MIRROR_COLLECTION, key, userId: SYSTEM_USER_ID })))
}
