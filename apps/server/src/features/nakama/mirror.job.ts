import { callNakamaRpc } from '../../infrastructure/nakama/admin-client.js'
import type { NakamaRpcError } from '../../infrastructure/nakama/admin-client.js'
import { insertContest } from '../../infrastructure/gateways/contest.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { storeMirroredChat, storeMirroredForfeit, storeMirroredRun } from '../../infrastructure/gateways/nakama-mirror.gateway.js'
import type { Result } from '../../shared/utils/result.js'
import { type MirrorPull, type MirrorService, createMirrorService } from './mirror.service.js'

// Drains Nakama's mirror outbox into Postgres: pull a page, store it, ack
// what was stored, and pull again straight away while pages come back full.

export const MIRROR_POLL_MS = 5000
export const MIRROR_PAGE = 10

type Rpc = <T>(id: string, body: Record<string, unknown>) => Promise<Result<T, NakamaRpcError>>

// One drain: pages until the outbox is empty (or a page fails). Returns how
// many entries were stored.
export async function drainMirror(rpc: Rpc, mirror: MirrorService): Promise<number> {
	let total = 0
	for (;;) {
		const pulled = await rpc<MirrorPull>('admin_mirror_pull', { limit: MIRROR_PAGE })
		if (!pulled.ok) {
			if (pulled.error !== 'disabled') console.warn(`[mirror] pull failed: ${pulled.error}`)
			return total
		}
		const { stored, failed } = await mirror.storePull(pulled.value)
		if (stored.length > 0) {
			const acked = await rpc('admin_mirror_ack', { keys: stored })
			if (!acked.ok) {
				// Stored but not acked: the next pull stores them again, harmlessly.
				console.warn(`[mirror] ack failed: ${acked.error}`)
				return total
			}
			total += stored.length
		}
		// A short page is the end; a page with failures waits for the next tick
		// rather than spinning on the same entries.
		if (pulled.value.entries.length < MIRROR_PAGE || failed.length > 0) return total
	}
}

export function startMirrorJob(): () => void {
	const mirror = createMirrorService({
		players: playerGateway,
		store: {
			storeRun: storeMirroredRun,
			storeChat: storeMirroredChat,
			storeForfeit: storeMirroredForfeit,
			storeContest: (row) =>
				insertContest({
					runId: row.runId,
					kind: 'in_game',
					contesterId: row.contesterId,
					againstId: row.againstId,
					createdAt: row.madeAt,
				}),
			storeNoticeAcceptance: (row) => playerGateway.recordNoticeAcceptance(row.playerId, row.version, row.acceptedAt),
		},
	})
	let running = false
	const tick = async () => {
		if (running) return
		running = true
		try {
			await drainMirror(callNakamaRpc, mirror)
		} catch (err) {
			console.error('[mirror] drain failed:', err)
		} finally {
			running = false
		}
	}
	void tick()
	const timer = setInterval(() => void tick(), MIRROR_POLL_MS)
	timer.unref()
	return () => clearInterval(timer)
}
