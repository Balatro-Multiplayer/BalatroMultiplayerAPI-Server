// Graceful restart: a lobby outlives a Nakama restart. On shutdown (Nakama's
// shutdown_grace_sec) each lobby match writes a checkpoint instead of closing;
// the first lobby_current or lobby_find that finds the match gone but the
// checkpoint there claims it and starts a new match from it, under the same
// code. Every player comes back away, with a fresh grace period to rejoin in.
import { bindCode } from './codes'
import { setupAfterDowntime } from '../actions/setup'
import {
	CHECKPOINT_TTL_MS,
	CURRENT_LOBBY_COLLECTION,
	checkpointExpiry,
	CURRENT_LOBBY_KEY,
	LOBBY_CHECKPOINT_COLLECTION,
	LOBBY_MATCH,
	SYSTEM_USER_ID,
} from './protocol'
import type { Lobby } from './state'

export { CHECKPOINT_TTL_MS }
// A claim whose resume never finished (the claimer failed midway) can be
// taken over after this long.
export const CLAIM_TIMEOUT_MS = 30_000

export interface Checkpoint {
	lobby: Lobby
	// When the lobby stopped.
	at: number
	// When a resume claimed it, or null.
	claimedAt: number | null
	// When it is dropped unclaimed. Absent on checkpoints written before it
	// was kept: at + CHECKPOINT_TTL_MS.
	expiresAt?: number
}

function withoutPendingRunSaves(lobby: Lobby): Lobby {
	if (!lobby.game.runSavePending) return lobby
	const { runSavePending, ...game } = lobby.game
	return { ...lobby, game }
}

// What a lobby is worth keeping across a restart: one with players in it.
// A lobby whose group is away (lobby/group_queue.ts) waits for its players as
// long as their seats are parked, not just the usual ten minutes.
// Each player's latest complete Run save rides along in lobby.game.runSaves;
// parts of a save still arriving (runSavePending) are left out, since the
// client resends a whole new save at its next Blind Select screen.
export function checkpointOf(lobby: Lobby, now: number): Checkpoint | null {
	if (lobby.closed || lobby.players.length === 0) return null
	const gq = lobby.groupQueue
	const parkedUntil = gq && gq.phase === 'away' ? gq.until : 0
	return {
		lobby: withoutPendingRunSaves(lobby),
		at: now,
		claimedAt: null,
		expiresAt: Math.max(now + CHECKPOINT_TTL_MS, parkedUntil),
	}
}

export function isExpired(checkpoint: Checkpoint, now: number): boolean {
	return now >= checkpointExpiry(checkpoint as unknown as { [key: string]: unknown })
}

export function isClaimable(checkpoint: Checkpoint, now: number): boolean {
	return (
		!isExpired(checkpoint, now) &&
		(checkpoint.claimedAt === null || now - checkpoint.claimedAt >= CLAIM_TIMEOUT_MS)
	)
}

// The lobby a resumed match starts with. Every player is away (nobody is
// attached yet) from now, so each gets the whole grace period; the result
// clock moves on by the time the server was down, so the restart doesn't eat
// into it. Spectators and rate-limit buckets don't carry over, nor does a
// group queue still forming or queued: its party went with the server. (Its
// index is left to go stale: matchmaking/group/binding.ts asks the lobby.)
export function resumeFrom(checkpoint: Checkpoint, now: number): Lobby {
	const lobby = checkpoint.lobby
	const downtime = Math.max(0, now - checkpoint.at)
	const settleFrom = lobby.game.settleFrom
	const gq = lobby.groupQueue
	return {
		...lobby,
		groupQueue: gq && gq.phase === 'away' ? gq : null,
		createdAt: now,
		players: lobby.players.map((p) => ({ ...p, sessionId: '', awaySince: now })),
		spectators: [],
		actionBudget: {},
		game: {
			...lobby.game,
			settleFrom: settleFrom === null ? null : settleFrom + downtime,
			setup: setupAfterDowntime(lobby.game, downtime),
		},
	}
}

// Whose current-lobby record a resumed lobby takes back: everyone's but its
// away group's, whose records name the public game they are in.
export function seatHoldersOf(lobby: Lobby): string[] {
	const gq = lobby.groupQueue
	const away = gq && gq.phase === 'away' ? gq.memberIds : []
	return lobby.players.map((p) => p.id).filter((id) => away.indexOf(id) === -1)
}

function keyOf(code: string) {
	return { collection: LOBBY_CHECKPOINT_COLLECTION, key: code, userId: SYSTEM_USER_ID }
}

function write(nk: nkruntime.Nakama, code: string, checkpoint: Checkpoint, version?: string) {
	nk.storageWrite([
		{
			...keyOf(code),
			value: checkpoint as unknown as { [key: string]: unknown },
			permissionRead: 0,
			permissionWrite: 0,
			version,
		},
	])
}

export function saveCheckpoint(nk: nkruntime.Nakama, checkpoint: Checkpoint) {
	write(nk, checkpoint.lobby.code, checkpoint)
}

export function readCheckpoint(
	nk: nkruntime.Nakama,
	code: string,
): { checkpoint: Checkpoint; version: string } | null {
	const objects = nk.storageRead([keyOf(code)])
	if (objects.length === 0) return null
	return { checkpoint: objects[0].value as unknown as Checkpoint, version: objects[0].version || "" }
}

export function deleteCheckpoint(nk: nkruntime.Nakama, code: string) {
	nk.storageDelete([keyOf(code)])
}

export type ResumeResult =
	| { kind: 'none' }
	// Another caller is resuming it right now: ask again in a moment.
	| { kind: 'resuming' }
	| { kind: 'resumed'; matchId: string; modId: string }

// Brings back the lobby behind `code` from its checkpoint, if there is one.
// The claim is a version-checked write, so only one caller creates the match.
export function resumeLobby(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger | null,
	code: string,
	now: number,
): ResumeResult {
	const found = readCheckpoint(nk, code)
	if (!found) return { kind: 'none' }
	const checkpoint = found.checkpoint
	if (isExpired(checkpoint, now)) {
		deleteCheckpoint(nk, code)
		return { kind: 'none' }
	}
	if (!isClaimable(checkpoint, now)) return { kind: 'resuming' }
	try {
		write(nk, code, { ...checkpoint, claimedAt: now }, found.version)
	} catch (e) {
		return { kind: 'resuming' }
	}

	const lobby = checkpoint.lobby
	const matchId = nk.matchCreate(LOBBY_MATCH, { resumeCode: code })
	bindCode(nk, code, matchId, lobby.modId)
	for (const id of seatHoldersOf(lobby)) {
		nk.storageWrite([
			{
				collection: CURRENT_LOBBY_COLLECTION,
				key: CURRENT_LOBBY_KEY,
				userId: id,
				value: { matchId, code, modId: lobby.modId },
				permissionRead: 0,
				permissionWrite: 0,
			},
		])
	}
	deleteCheckpoint(nk, code)
	if (logger) logger.info('Lobby %s resumed from its checkpoint as %s', code, matchId)
	return { kind: 'resumed', matchId, modId: lobby.modId }
}
