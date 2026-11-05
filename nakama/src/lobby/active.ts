// The game a player is still in, for rejoining after a crash or a dropped
// connection. Pure.
import { hashInput } from './log_check'
import type { ActiveRun, ReplayEvent, ReplayTail } from './protocol'
import { type Lobby, isParticipant } from './state'

// null unless a game is running and userId is one of its participants still
// seated in the lobby. The events are the player's own log so far, parsed
// from the JSON text they arrived as into {t, opcode, args}.
//
// The owner's Run save is checked (checkedRunSave) against the log as it
// arrived: it is given only if the log holds its position and the log up to
// there hashes to the save's hash. (The client cannot redo that hash from the
// parsed events: it would have to re-encode objects in the order they
// arrived.)
export function activeRunOf(
	lobby: Lobby,
	userId: string,
	sha256: (input: string) => string,
): ActiveRun | null {
	const started = lobby.game.started
	if (!started || lobby.closed) return null
	if (!isParticipant(lobby, userId)) return null
	if (!lobby.players.some((p) => p.id === userId)) return null
	const lines = lobby.game.logs[userId]?.lines ?? []
	const { runSave, runSaveSkipped } = checkedRunSave(
		lobby,
		userId,
		lines,
		sha256,
	)
	return {
		runId: started.runId,
		code: lobby.code,
		modId: lobby.modId,
		events: eventsOf(lines),
		requiredStanding: lobby.requiredStanding || null,
		runSave,
		runSaveSkipped,
		logText: hashInput(lines),
	}
}

// What a participant rejoining a running game missed of the others (the
// API's replay-tail push): every other participant's log that has anything
// in it, or null when there's nothing to send.
export function replayTailOf(lobby: Lobby, userId: string): ReplayTail | null {
	const started = lobby.game.started
	if (!started || lobby.closed) return null
	if (!started.players.some((p) => p.id === userId)) return null
	const tails = started.players
		.filter((p) => p.id !== userId)
		.map((p) => ({
			playerId: p.id,
			events: eventsOf(lobby.game.logs[p.id]?.lines ?? []),
		}))
		.filter((tail) => tail.events.length > 0)
	return tails.length > 0 ? { runId: started.runId, tails } : null
}

export function eventsOf(lines: string[]): ReplayEvent[] {
	return lines.map((line) => {
		const [t, opcode, args] = JSON.parse(line) as unknown[]
		return { t, opcode, args }
	})
}

// userId's latest Run save if the log holds its position and the log up to
// there hashes to the save's hash; otherwise null, and why when a save was
// held back. Callers decide who may be given it.
export function checkedRunSave(
	lobby: Lobby,
	userId: string,
	lines: string[],
	sha256: (input: string) => string,
): {
	runSave: ActiveRun['runSave']
	runSaveSkipped: ActiveRun['runSaveSkipped']
} {
	const save = lobby.game.runSaves?.[userId]
	if (!save) return { runSave: null, runSaveSkipped: null }
	if (save.pos > lines.length)
		return { runSave: null, runSaveSkipped: 'beyond_log' }
	if (
		sha256(hashInput(lines.slice(0, save.pos))).toLowerCase() !==
		save.hash.toLowerCase()
	)
		return { runSave: null, runSaveSkipped: 'hash_mismatch' }
	return {
		runSave: { id: save.id, pos: save.pos, hash: save.hash, data: save.data },
		runSaveSkipped: null,
	}
}
