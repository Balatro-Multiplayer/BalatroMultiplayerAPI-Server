import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import {
	claimItem,
	enqueueServiceQueueItem,
	getServiceQueueItemById,
	listServiceQueueItems,
	markServiceQueueItemResolved,
	openCountsByType,
	openSourceIds,
} from '../../infrastructure/gateways/service-queue.gateway.js'

const SAMPLE_ROW = {
	id: 1,
	itemType: 'report',
	sourceId: '42',
	subjectPlayerId: 'player-1',
	status: 'open',
	priority: null,
	summary: 'cheating report — lobby ABCDE',
	createdAt: new Date('2026-01-01T00:00:00Z'),
	resolvedAt: null,
	resolvedBy: null,
	resolutionAction: null,
	resolutionNotes: null,
	claimedBy: null,
	claimedUntil: null,
	context: {},
	updatedAt: new Date('2026-01-01T00:00:00Z'),
}

// A drizzle query builder stand-in: every method chains and records its
// arguments, and awaiting it gives `result`.
function query(result: unknown) {
	const calls: { method: string; args: unknown[] }[] = []
	const proxy: any = new Proxy(
		{},
		{
			get(_, method: string) {
				if (method === 'then') return (resolve: (v: unknown) => void) => resolve(result)
				return (...args: unknown[]) => {
					calls.push({ method, args })
					return proxy
				}
			},
		},
	)
	return { proxy, calls, argsOf: (method: string) => calls.find((c) => c.method === method)?.args }
}

// Each db.select() in turn answers the next result.
function selects(...results: unknown[]) {
	const queries = results.map(query)
	let i = 0
	;(db as any).select = vi.fn(() => (queries[i++] ?? query([])).proxy)
	return queries
}

beforeEach(() => {
	;(db as any).update = vi.fn(() => query([]).proxy)
})

describe('service-queue.gateway', () => {
	describe('enqueueServiceQueueItem', () => {
		it('inserts a row with its context and scores it', async () => {
			const insert = query([SAMPLE_ROW])
			;(db as any).insert = vi.fn(() => insert.proxy)
			// Rescoring: the subject's open items, then the score inputs.
			selects([SAMPLE_ROW], [{ n: 1 }], [{ n: 3 }])

			const result = await enqueueServiceQueueItem({
				itemType: 'report',
				sourceId: '42',
				subjectPlayerId: 'player-1',
				summary: 'cheating report — lobby ABCDE',
				context: { lobbyKind: 'ranked' },
			})

			expect(insert.argsOf('values')?.[0]).toEqual({
				itemType: 'report',
				sourceId: '42',
				subjectPlayerId: 'player-1',
				summary: 'cheating report — lobby ABCDE',
				context: { lobbyKind: 'ranked' },
			})
			expect(result).toEqual(SAMPLE_ROW)
			expect(db.update).toHaveBeenCalled()
		})

		it('is a no-op on a duplicate (itemType, sourceId)', async () => {
			;(db as any).insert = vi.fn(() => query([]).proxy)
			const result = await enqueueServiceQueueItem({
				itemType: 'report',
				sourceId: '42',
				subjectPlayerId: 'player-1',
				summary: 'duplicate',
			})
			expect(result).toBeNull()
			expect(db.update).not.toHaveBeenCalled()
		})
	})

	describe('listServiceQueueItems', () => {
		const base = { page: 1, limit: 50, sort: 'priority' as const, now: new Date('2026-02-01T00:00:00Z') }

		it('filters, joins the subject name and counts their open items', async () => {
			const [total, rows] = selects(
				[{ total: 1 }],
				[{ item: SAMPLE_ROW, subjectName: 'Alice' }],
				[{ subject: 'player-1', n: 3 }],
			)
			const { items, total: n } = await listServiceQueueItems({ ...base, itemType: 'report', status: 'open' })
			expect(n).toBe(1)
			expect(items).toEqual([{ ...SAMPLE_ROW, subjectName: 'Alice', subjectOpenItems: 3 }])
			expect(total.argsOf('where')?.[0]).toBeDefined()
			expect(rows.argsOf('where')?.[0]).toBeDefined()
			expect(rows.argsOf('limit')).toEqual([50])
			expect(rows.argsOf('offset')).toEqual([0])
		})

		it('passes no filter for status all with nothing else set', async () => {
			const [total, rows] = selects([{ total: 0 }], [])
			await listServiceQueueItems({ ...base, status: 'all' })
			expect(total.argsOf('where')).toEqual([undefined])
			expect(rows.argsOf('where')).toEqual([undefined])
		})
	})

	describe('listServiceQueueItems lanes', () => {
		const base = { page: 1, limit: 50, sort: 'priority' as const, status: 'all' as const, now: new Date('2026-02-01T00:00:00Z') }

		it.each(['main', 'automatic'] as const)('filters the %s lane by item type', async (lane) => {
			const [total] = selects([{ total: 0 }], [])
			await listServiceQueueItems({ ...base, lane })
			expect(total.argsOf('where')?.[0]).toBeDefined()
		})
	})

	describe('getServiceQueueItemById', () => {
		it('returns the row when found', async () => {
			selects([SAMPLE_ROW])
			expect(await getServiceQueueItemById(1)).toEqual(SAMPLE_ROW)
		})

		it('returns null when not found', async () => {
			selects([])
			expect(await getServiceQueueItemById(999)).toBeNull()
		})
	})

	describe('markServiceQueueItemResolved', () => {
		it('sets the resolution and clears the claim, on the executor given', async () => {
			const update = query([{ ...SAMPLE_ROW, status: 'resolved' }])
			const tx = { update: vi.fn(() => update.proxy) }
			const now = new Date('2026-02-01T00:00:00Z')
			const result = await markServiceQueueItemResolved(tx as any, 1, 'moderator:mod-1', 'resolve', 'ok', now)
			expect(result?.status).toBe('resolved')
			expect(update.argsOf('set')?.[0]).toMatchObject({
				status: 'resolved',
				resolvedBy: 'moderator:mod-1',
				resolutionAction: 'resolve',
				resolutionNotes: 'ok',
				resolvedAt: now,
				claimedBy: null,
				claimedUntil: null,
			})
		})

		it('returns null when the item was not open', async () => {
			const tx = { update: vi.fn(() => query([]).proxy) }
			expect(await markServiceQueueItemResolved(tx as any, 1, 'admin:a', 'dismiss', null, new Date())).toBeNull()
		})
	})

	describe('claimItem', () => {
		it('returns null when another claim won the race', async () => {
			expect(await claimItem(1, 'moderator:m', 'm', new Date(), new Date())).toBeNull()
		})
	})

	describe('openCountsByType', () => {
		it('fills every type, zero when none are open', async () => {
			selects([{ itemType: 'report', n: 2 }])
			const counts = await openCountsByType()
			expect(counts.report).toBe(2)
			expect(counts.anti_cheat).toBe(0)
			expect(counts.integrity).toBe(0)
		})
	})

	describe('openSourceIds', () => {
		it('skips the query for no ids', async () => {
			selects()
			expect(await openSourceIds('flagged_chat', [])).toEqual(new Set())
			expect(db.select).not.toHaveBeenCalled()
		})

		it('gives the ids with an open item', async () => {
			selects([{ sourceId: '7' }])
			expect(await openSourceIds('flagged_chat', ['7', '8'])).toEqual(new Set(['7']))
		})
	})
})
