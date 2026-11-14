// The lobby code registry (see LOBBY_CODE_COLLECTION). A code is reserved
// before its match exists (matchId ''), bound once matchCreate returns, and
// released by the match when the lobby closes.
import {
	checkpointExpired,
	LOBBY_CHECKPOINT_COLLECTION,
	LOBBY_CODE_COLLECTION,
	SYSTEM_USER_ID,
} from './protocol'

interface CodeEntry {
	matchId: string
	modId: string
}

function keyOf(code: string): nkruntime.StorageReadRequest {
	return {
		collection: LOBBY_CODE_COLLECTION,
		key: code,
		userId: SYSTEM_USER_ID,
	}
}

function write(
	nk: nkruntime.Nakama,
	code: string,
	entry: CodeEntry,
	version?: string,
) {
	nk.storageWrite([
		{
			...keyOf(code),
			value: { ...entry },
			permissionRead: 0,
			permissionWrite: 0,
			version,
		},
	])
}

function read(nk: nkruntime.Nakama, code: string): CodeEntry | null {
	const objects = nk.storageRead([keyOf(code)])
	if (objects.length === 0) return null
	const value = objects[0].value
	return {
		matchId: String(value.matchId || ''),
		modId: String(value.modId || ''),
	}
}

// True while the code belongs to a lobby stopped by a restart that may still
// be resumed (lobby/checkpoint.ts).
function heldByCheckpoint(nk: nkruntime.Nakama, code: string): boolean {
	const objects = nk.storageRead([
		{ collection: LOBBY_CHECKPOINT_COLLECTION, key: code, userId: SYSTEM_USER_ID },
	])
	return objects.length > 0 && !checkpointExpired(objects[0].value, Date.now())
}

// Claims a free code; false if it's taken. An entry left behind by a match
// that no longer exists counts as free, unless a restart checkpoint still
// holds it.
export function reserveCode(
	nk: nkruntime.Nakama,
	code: string,
	modId: string,
): boolean {
	if (heldByCheckpoint(nk, code)) return false
	const existing = read(nk, code)
	if (existing) {
		if (!existing.matchId || nk.matchGet(existing.matchId)) return false
		nk.storageDelete([keyOf(code)])
	}
	try {
		write(nk, code, { matchId: '', modId }, '*')
		return true
	} catch (e) {
		// Someone else claimed it between the read and the write.
		return false
	}
}

export function bindCode(
	nk: nkruntime.Nakama,
	code: string,
	matchId: string,
	modId: string,
) {
	write(nk, code, { matchId, modId })
}

// The live lobby behind a code, or null.
export function lookupCode(
	nk: nkruntime.Nakama,
	code: string,
): CodeEntry | null {
	const entry = read(nk, code)
	if (!entry || !entry.matchId || !nk.matchGet(entry.matchId)) return null
	return entry
}

// Frees the code, unless it has since been handed to another match.
export function releaseCode(
	nk: nkruntime.Nakama,
	code: string,
	matchId: string,
) {
	const entry = read(nk, code)
	if (entry && entry.matchId === matchId) {
		nk.storageDelete([keyOf(code)])
	}
}
