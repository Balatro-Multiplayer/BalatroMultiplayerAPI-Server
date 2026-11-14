// Graceful restart: a lobby outlives a Nakama restart. On shutdown (Nakama's
// shutdown_grace_sec) each lobby match writes a checkpoint instead of closing;
// the first lobby_current or lobby_find that finds the match gone but the
// checkpoint there claims it and starts a new match from it, under the same
// code. Every player comes back away, with a fresh grace period to rejoin in.
import { bindCode } from './codes'
import { setupAfterDowntime } from '../actions/setup'
import type { Deadline } from './pvp/types'
import { gameAfterResume } from './pvp/ready'
import {
	CHECKPOINT_TTL_MS,
	CURRENT_LOBBY_COLLECTION,
	checkpointExpired,
	CURRENT_LOBBY_KEY,
	LOBBY_CHECKPOINT_COLLECTION,
	LOBBY_MATCH,
	SYSTEM_USER_ID,
} from './protocol'
import type { Lobby } from './state'
import {
	PVP_MODES,
	type PersonalClock,
	type StoredPvp,
	refereeOf,
} from './pvp/state'

export { CHECKPOINT_TTL_MS }
// A claim whose resume never finished (the claimer failed midway) can be
// taken over after this long.
export const CLAIM_TIMEOUT_MS = 30_000

// The checkpoint's shape version. Bump it on any change to what a checkpoint
// holds (checkpoint.test.ts keeps the key paths next to it and fails on a
// change without a bump): a checkpoint of another version is deleted at its
// one boundary, resumeLobby (and the sweep), never read with defaults filled in.
export const CHECKPOINT_SCHEMA = 3

export interface Checkpoint {
	schema: number
	lobby: Lobby
	// When the lobby stopped.
	at: number
	// When a resume claimed it, or null.
	claimedAt: number | null
	// When it is dropped unclaimed.
	expiresAt: number
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
		schema: CHECKPOINT_SCHEMA,
		lobby: withoutPendingRunSaves(lobby),
		at: now,
		claimedAt: null,
		expiresAt: Math.max(now + CHECKPOINT_TTL_MS, parkedUntil),
	}
}

// The modes a frozen referee can hold. A checkpoint written before the freeze
// refused an unknown queue_mode may hold 'standard' (the old default): the key
// paths are the same, so it is refused here, at restore, not by a schema bump.
const FROZEN_MODES: ReadonlyArray<string | null> = [null, ...PVP_MODES]

// Whether a checkpoint was written by this build's shape and holds only values this
// build can produce (read from storage, so the value is whatever was stored).
export function hasCurrentSchema(checkpoint: Checkpoint): boolean {
	if (checkpoint.schema !== CHECKPOINT_SCHEMA) return false
	const mode = refereeOf(checkpoint.lobby)?.rules.mode ?? null
	return FROZEN_MODES.includes(mode)
}

// A checkpoint with no numeric expiresAt is not one this build wrote: expired.
export function isExpired(checkpoint: Checkpoint, now: number): boolean {
	return checkpointExpired(checkpoint as unknown as { [key: string]: unknown }, now)
}

export function isClaimable(checkpoint: Checkpoint, now: number): boolean {
	return (
		!isExpired(checkpoint, now) &&
		(checkpoint.claimedAt === null || now - checkpoint.claimedAt >= CLAIM_TIMEOUT_MS)
	)
}

// The PvP referee's server times, moved on by the time the server was down: a
// running deadline's end, and each personal clock's `since` and `graceUntil`, so
// the PvP timer and the clocks show what they showed when the server stopped.
// A paused deadline stands still and is copied as it is. An Ante deadline is marked
// `resumed`: the restart voided the starter's Ready (gameAfterResume), and without the
// mark the first tick would end the timer as "unready". Nothing else the
// referee stores is an absolute time (checkpoint.test.ts lists them).
function carriedOver(deadline: Deadline, startId: number): Deadline {
	return deadline.kind === 'ante' ? { ...deadline, resumed: startId } : deadline
}

function pvpAfterDowntime(pvp: StoredPvp, downtime: number): StoredPvp {
	const referee = pvp.referee
	if (!referee) return pvp
	const facts = referee.facts
	const deadline = facts.deadline
	const clocks: { [userId: string]: PersonalClock } = {}
	for (const id of Object.keys(facts.clocks)) {
		const clock = facts.clocks[id]
		clocks[id] = {
			...clock,
			since: clock.since + downtime,
			graceUntil: clock.graceUntil === null ? null : clock.graceUntil + downtime,
		}
	}
	return {
		...pvp,
		referee: {
			...referee,
			facts: {
				...facts,
				deadline: deadline
					? carriedOver(
							typeof deadline.endsAt === 'number' && deadline.pausedMs === undefined
								? { ...deadline, endsAt: deadline.endsAt + downtime }
								: deadline,
							pvp.lastStart?.roundId ?? 0,
						)
					: deadline,
				clocks,
			},
		},
	}
}

// The lobby a resumed match starts with. Every player is away (nobody is
// attached yet) from now, so each gets the whole grace period; the result
// clock, the PvP deadline and the personal clocks move on by the time the
// server was down, so the restart doesn't eat into them. Spectators and
// rate-limit buckets don't carry over, nor does a group queue still forming or
// queued: its party went with the server. (Its index is left to go stale:
// matchmaking/group/binding.ts asks the lobby.)
export function resumeFrom(checkpoint: Checkpoint, now: number): Lobby {
	const lobby = checkpoint.lobby
	const downtime = Math.max(0, now - checkpoint.at)
	const settleFrom = lobby.game.settleFrom
	const gq = lobby.groupQueue
	const game = gameAfterResume(lobby.game)
	return {
		...lobby,
		groupQueue: gq && gq.phase === 'away' ? gq : null,
		createdAt: now,
		players: lobby.players.map((p) => ({ ...p, sessionId: '', awaySince: now })),
		spectators: [],
		actionBudget: {},
		game: {
			...game,
			...(game.pvp ? { pvp: pvpAfterDowntime(game.pvp, downtime) } : {}),
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

function write(nk: nkruntime.Nakama, code: string, checkpoint: Checkpoint, version?: string): string {
	const acks = nk.storageWrite([
		{
			...keyOf(code),
			value: checkpoint as unknown as { [key: string]: unknown },
			permissionRead: 0,
			permissionWrite: 0,
			// Left out when there is none: real Nakama rejects a version key that is not a string.
			...(version === undefined ? {} : { version }),
		},
	])
	return acks[0].version
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

// With a version, deletes only the checkpoint that is still at it (throws if
// another caller has since changed or removed it).
export function deleteCheckpoint(nk: nkruntime.Nakama, code: string, version?: string) {
	// No version key at all without one: real Nakama throws a TypeError on `version: undefined`.
	nk.storageDelete([version === undefined ? keyOf(code) : { ...keyOf(code), version }])
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
	logger: nkruntime.Logger,
	code: string,
	now: number,
): ResumeResult {
	const found = readCheckpoint(nk, code)
	if (!found) return { kind: 'none' }
	const checkpoint = found.checkpoint
	// Another build's shape is never resumed or patched: gone, as if expired.
	if (!hasCurrentSchema(checkpoint) || isExpired(checkpoint, now)) {
		deleteCheckpoint(nk, code)
		return { kind: 'none' }
	}
	if (!isClaimable(checkpoint, now)) return { kind: 'resuming' }
	let claim: string
	try {
		claim = write(nk, code, { ...checkpoint, claimedAt: now }, found.version)
	} catch (e) {
		return { kind: 'resuming' }
	}

	const lobby = checkpoint.lobby
	// A checkpoint the lobby cannot be rebuilt from fails every retry: gone. The
	// delete only takes our own claim, so a caller that re-claimed after the
	// claim timed out keeps its checkpoint.
	try {
		resumeFrom(checkpoint, now)
	} catch (e) {
		logger.error('Lobby %s could not resume from its checkpoint: %s', code, String(e))
		try {
			deleteCheckpoint(nk, code, claim)
		} catch (_) {
			// Someone else holds it now; theirs to settle.
		}
		return { kind: 'none' }
	}
	let matchId: string
	try {
		matchId = nk.matchCreate(LOBBY_MATCH, { resumeCode: code })
	} catch (e) {
		// Not known to repeat (storage or the runtime can fail for a moment, as
		// every seated player rejoins at once after a restart): keep the
		// checkpoint and let go of the claim so the next rejoin tries again. The
		// release only takes our own claim, so it cannot bring back a checkpoint
		// that was deleted meanwhile; and if the release itself fails, the claim
		// times out (CLAIM_TIMEOUT_MS).
		logger.error('Lobby %s could not resume from its checkpoint: %s', code, String(e))
		try {
			write(nk, code, { ...checkpoint, claimedAt: null }, claim)
		} catch (_) {
			// Left to time out.
		}
		return { kind: 'resuming' }
	}
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
	logger.info('Lobby %s resumed from its checkpoint as %s', code, matchId)
	return { kind: 'resumed', matchId, modId: lobby.modId }
}
