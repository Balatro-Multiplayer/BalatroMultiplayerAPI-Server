import { describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import {
	enqueueServiceQueueItem,
	getServiceQueueItemById,
	listServiceQueueItems,
	markServiceQueueItemResolved,
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
}

describe('service-queue.gateway', () => {
	describe('enqueueServiceQueueItem', () => {
		it('inserts a row and publishes the admin queue event', async () => {
			let captured: unknown
			;(db as any).insert = vi.fn().mockReturnValue({
				values: vi.fn().mockImplementation((row: unknown) => {
					captured = row
					return {
						onConflictDoNothing: vi.fn().mockReturnValue({
							returning: vi.fn().mockResolvedValue([SAMPLE_ROW]),
						}),
					}
				}),
			})

			const result = await enqueueServiceQueueItem({
				itemType: 'report',
				sourceId: '42',
				subjectPlayerId: 'player-1',
				summary: 'cheating report — lobby ABCDE',
			})

			expect(captured).toEqual({
				itemType: 'report',
				sourceId: '42',
				subjectPlayerId: 'player-1',
				summary: 'cheating report — lobby ABCDE',
			})
			expect(result).toEqual(SAMPLE_ROW)
			expect(vi.mocked(mqttService.publishAdminQueueEvent)).toHaveBeenCalledWith(
				'queue_item_created',
				expect.objectContaining({ id: 1, itemType: 'report', sourceId: '42' }),
			)
		})

		it('is a no-op (and does not publish) on a duplicate (itemType, sourceId)', async () => {
			;(db as any).insert = vi.fn().mockReturnValue({
				values: vi.fn().mockReturnValue({
					onConflictDoNothing: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([]),
					}),
				}),
			})

			const result = await enqueueServiceQueueItem({
				itemType: 'report',
				sourceId: '42',
				subjectPlayerId: 'player-1',
				summary: 'duplicate',
			})

			expect(result).toBeNull()
			expect(vi.mocked(mqttService.publishAdminQueueEvent)).not.toHaveBeenCalled()
		})
	})

	describe('listServiceQueueItems', () => {
		it('filters by itemType and status', async () => {
			const whereArgs: unknown[] = []
			const captureWhere = (cond: unknown) => {
				whereArgs.push(cond)
				return cond
			}

			vi.mocked(db.select)
				// 1st call: the `total` count query
				.mockReturnValueOnce({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockImplementation((cond: unknown) => {
							captureWhere(cond)
							return Promise.resolve([{ total: 1 }])
						}),
					}),
				} as any)
				// 2nd call: the paginated rows query
				.mockReturnValueOnce({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockImplementation((cond: unknown) => {
							captureWhere(cond)
							return {
								orderBy: vi.fn().mockReturnValue({
									limit: vi.fn().mockReturnValue({
										offset: vi.fn().mockResolvedValue([SAMPLE_ROW]),
									}),
								}),
							}
						}),
					}),
				} as any)

			const { items, total } = await listServiceQueueItems({
				page: 1,
				limit: 50,
				itemType: 'report',
				status: 'open',
			})

			expect(total).toBe(1)
			expect(items).toEqual([SAMPLE_ROW])
			// Both queries were given a real (non-undefined) filter condition,
			// since itemType/status were both provided.
			expect(whereArgs).toHaveLength(2)
			expect(whereArgs[0]).toBeDefined()
			expect(whereArgs[1]).toBeDefined()
		})

		it('passes an undefined filter when no itemType/status is given', async () => {
			const whereArgs: unknown[] = []
			vi.mocked(db.select)
				.mockReturnValueOnce({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockImplementation((cond: unknown) => {
							whereArgs.push(cond)
							return Promise.resolve([{ total: 0 }])
						}),
					}),
				} as any)
				.mockReturnValueOnce({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockImplementation((cond: unknown) => {
							whereArgs.push(cond)
							return {
								orderBy: vi.fn().mockReturnValue({
									limit: vi.fn().mockReturnValue({
										offset: vi.fn().mockResolvedValue([]),
									}),
								}),
							}
						}),
					}),
				} as any)

			await listServiceQueueItems({ page: 1, limit: 50 })

			expect(whereArgs).toEqual([undefined, undefined])
		})
	})

	describe('getServiceQueueItemById', () => {
		it('returns the row when found', async () => {
			;(db as any).select = vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([SAMPLE_ROW]),
					}),
				}),
			})

			expect(await getServiceQueueItemById(1)).toEqual(SAMPLE_ROW)
		})

		it('returns null when not found', async () => {
			;(db as any).select = vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([]),
					}),
				}),
			})

			expect(await getServiceQueueItemById(999)).toBeNull()
		})
	})

	describe('markServiceQueueItemResolved', () => {
		it('sets status/resolvedAt/resolvedBy/resolutionAction', async () => {
			let captured: unknown
			;(db as any).update = vi.fn().mockReturnValue({
				set: vi.fn().mockImplementation((patch: unknown) => {
					captured = patch
					return {
						where: vi.fn().mockReturnValue({
							returning: vi.fn().mockResolvedValue([{ ...SAMPLE_ROW, status: 'resolved' }]),
						}),
					}
				}),
			})

			const result = await markServiceQueueItemResolved(1, 'moderator:mod-1', 'resolve')

			expect(result?.status).toBe('resolved')
			expect(captured).toMatchObject({
				status: 'resolved',
				resolvedBy: 'moderator:mod-1',
				resolutionAction: 'resolve',
			})
		})
	})
})
