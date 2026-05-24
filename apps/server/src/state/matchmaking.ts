import type { Match, QueueEntry } from '../types/index.js'

export const queues = new Map<string, QueueEntry[]>()
export const playerQueues = new Map<string, Set<string>>()
export const matches = new Map<string, Match>()
export const matchByLobby = new Map<string, Match>()

export function queueKey(modId: string, gameMode: string): string {
	return `${modId}:${gameMode}`
}
