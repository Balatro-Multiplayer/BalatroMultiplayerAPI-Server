import {
	playerQueues,
	queues,
	queueKey,
} from '../../state/matchmaking.js'
import type {
	GroupQueueEntry,
	QueueEntry,
} from '../../shared/types/index.js'
import {
	RANKED_SPREAD_CAP,
	RANKED_SPREAD_EXPAND_RATE,
	RANKED_SPREAD_INITIAL,
} from './elo.service.js'

export function isRanked(gameMode: string): boolean {
	return gameMode.startsWith('ranked:')
}

export function entryPlayerCount(entry: QueueEntry): number {
	return entry.type === 'solo' ? 1 : entry.playerIds.length
}

export function entryRating(entry: QueueEntry): number {
	return entry.type === 'solo' ? entry.rating : entry.avgRating
}

export function totalPlayerCount(entries: QueueEntry[]): number {
	return entries.reduce((sum, e) => sum + entryPlayerCount(e), 0)
}

export function getPlayerIdsFromEntries(entries: QueueEntry[]): string[] {
	return entries.flatMap((e) => (e.type === 'solo' ? [e.playerId] : e.playerIds))
}

export function getHostFromEntries(entries: QueueEntry[]): string {
	const first = entries[0]
	return first.type === 'solo' ? first.playerId : first.hostPlayerId
}

export function addToPlayerQueues(playerIds: string[], key: string): void {
	for (const pid of playerIds) {
		let set = playerQueues.get(pid)
		if (!set) {
			set = new Set()
			playerQueues.set(pid, set)
		}
		set.add(key)
	}
}

export function removeFromPlayerQueues(playerIds: string[], key: string): void {
	for (const pid of playerIds) {
		const set = playerQueues.get(pid)
		if (set) {
			set.delete(key)
			if (set.size === 0) playerQueues.delete(pid)
		}
	}
}

export function leaveQueue(playerId: string, modId: string, gameMode: string): void {
	const key = queueKey(modId, gameMode)
	const queue = queues.get(key)
	if (!queue) return

	const idx = queue.findIndex((e) =>
		e.type === 'solo' ? e.playerId === playerId : e.playerIds.includes(playerId),
	)
	if (idx === -1) return

	const entry = queue[idx]
	const affectedPlayers =
		entry.type === 'solo' ? [entry.playerId] : entry.playerIds

	queue.splice(idx, 1)
	if (queue.length === 0) queues.delete(key)

	removeFromPlayerQueues(affectedPlayers, key)
}

export function leaveAllQueues(playerId: string): void {
	const keys = playerQueues.get(playerId)
	if (!keys) return

	for (const key of Array.from(keys)) {
		const queue = queues.get(key)
		if (!queue) continue

		const idx = queue.findIndex((e) =>
			e.type === 'solo' ? e.playerId === playerId : e.playerIds.includes(playerId),
		)
		if (idx === -1) continue

		const entry = queue[idx]
		const affectedPlayers =
			entry.type === 'solo' ? [entry.playerId] : entry.playerIds

		queue.splice(idx, 1)
		if (queue.length === 0) queues.delete(key)

		removeFromPlayerQueues(affectedPlayers, key)
	}
}

// Ranked queueing is always solo (see matchmaking.service.ts::joinQueue's
// own group+ranked rejection), so a player has at most one Ranked entry
// across whichever keys they're currently queued under - used by
// matchmaking.service.ts's ranked_readiness failure handler to find which
// queue to actually cancel, since that challenge is issued per-player, not
// per-queue-entry.
export function findActiveRankedQueueEntry(
	playerId: string,
): { modId: string; gameMode: string } | null {
	const keys = playerQueues.get(playerId)
	if (!keys) return null

	for (const key of keys) {
		const queue = queues.get(key)
		if (!queue) continue
		const entry = queue.find((e) =>
			e.type === 'solo' ? e.playerId === playerId : e.playerIds.includes(playerId),
		)
		if (entry && isRanked(entry.gameMode)) {
			return { modId: entry.modId, gameMode: entry.gameMode }
		}
	}
	return null
}

export function getQueueStatus(playerId: string): QueueEntry[] {
	const keys = playerQueues.get(playerId)
	if (!keys || keys.size === 0) return []

	const result: QueueEntry[] = []
	for (const key of keys) {
		const queue = queues.get(key)
		if (!queue) continue
		const entry = queue.find((e) =>
			e.type === 'solo' ? e.playerId === playerId : e.playerIds.includes(playerId),
		)
		if (entry) result.push(entry)
	}
	return result
}

export function runCasualQueue(
	entries: QueueEntry[],
	minPlayers: number,
	maxPlayers: number,
	now: number = Date.now(),
	graceMs = 0,
): QueueEntry[][] {
	const remaining = [...entries]
	const formed: QueueEntry[][] = []

	while (totalPlayerCount(remaining) >= minPlayers) {
		const collected: QueueEntry[] = []
		let slots = 0
		const toRemove: number[] = []

		for (let i = 0; i < remaining.length; i++) {
			const entry = remaining[i]
			const size = entryPlayerCount(entry)
			if (slots + size <= maxPlayers) {
				collected.push(entry)
				toRemove.push(i)
				slots += size
			}
			if (slots >= maxPlayers) break
		}

		if (slots < minPlayers) break

		// Under a full lobby: hold this group open so late joiners can still
		// fill it, unless the oldest entry in it has already waited out the
		// grace period -- at which point commit at whatever size is available.
		if (slots < maxPlayers) {
			const oldestQueuedAt = Math.min(...collected.map((e) => e.queuedAt.getTime()))
			if (now - oldestQueuedAt < graceMs) break
		}

		formed.push(collected)
		for (let i = toRemove.length - 1; i >= 0; i--) {
			remaining.splice(toRemove[i], 1)
		}
	}

	return formed
}

export function runRankedQueue(
	entries: QueueEntry[],
	minPlayers: number,
	maxPlayers: number,
	now: number = Date.now(),
	graceMs = 0,
): QueueEntry[][] {
	const remaining = [...entries].sort((a, b) => entryRating(a) - entryRating(b))
	const formed: QueueEntry[][] = []

	while (totalPlayerCount(remaining) >= minPlayers) {
		let oldestIdx = 0
		let oldestTime = remaining[0].queuedAt.getTime()
		for (let i = 1; i < remaining.length; i++) {
			if (remaining[i].queuedAt.getTime() < oldestTime) {
				oldestTime = remaining[i].queuedAt.getTime()
				oldestIdx = i
			}
		}

		const anchor = remaining[oldestIdx]
		const anchorRating = entryRating(anchor)
		const anchorWaitSecs = (now - anchor.queuedAt.getTime()) / 1000
		const spread = Math.min(
			RANKED_SPREAD_INITIAL +
				Math.floor(anchorWaitSecs / 30) * RANKED_SPREAD_EXPAND_RATE,
			RANKED_SPREAD_CAP,
		)

		const collected: QueueEntry[] = []
		let slots = 0
		const toRemove: number[] = []

		for (let i = 0; i < remaining.length; i++) {
			const entry = remaining[i]
			const rating = entryRating(entry)
			const size = entryPlayerCount(entry)
			if (Math.abs(rating - anchorRating) <= spread && slots + size <= maxPlayers) {
				collected.push(entry)
				toRemove.push(i)
				slots += size
			}
		}

		if (slots < minPlayers) break

		// Same fill-grace behavior as runCasualQueue: give a not-yet-full
		// lobby a chance to grow before committing at less than maxPlayers.
		if (slots < maxPlayers && anchorWaitSecs * 1000 < graceMs) break

		formed.push(collected)
		for (let i = toRemove.length - 1; i >= 0; i--) {
			remaining.splice(toRemove[i], 1)
		}
	}

	return formed
}
