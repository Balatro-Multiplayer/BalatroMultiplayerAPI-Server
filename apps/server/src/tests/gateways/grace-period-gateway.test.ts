import { describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import {
	deleteGracePeriod,
	insertGracePeriod,
	loadAllGracePeriods,
} from '../../infrastructure/gateways/grace-period.gateway.js'

describe('grace-period.gateway', () => {
	describe('insertGracePeriod', () => {
		it('inserts the given row', async () => {
			let captured: unknown
			;(db as any).insert = vi.fn().mockReturnValue({
				values: vi.fn().mockImplementation((row: unknown) => {
					captured = row
					return Promise.resolve()
				}),
			})

			const disconnectedAt = new Date('2026-08-21T18:00:00Z')
			const expiresAt = new Date('2026-08-21T18:02:00Z')
			await insertGracePeriod({
				playerId: 'p1',
				lobbyCode: 'TESTLB',
				displayName: 'Bob',
				disconnectedAt,
				expiresAt,
			})

			expect(captured).toEqual({
				playerId: 'p1',
				lobbyCode: 'TESTLB',
				displayName: 'Bob',
				disconnectedAt,
				expiresAt,
			})
		})
	})

	describe('deleteGracePeriod', () => {
		it('deletes by playerId', async () => {
			const where = vi.fn().mockResolvedValue(undefined)
			;(db as any).delete = vi.fn().mockReturnValue({ where })

			await deleteGracePeriod('p1')

			expect(where).toHaveBeenCalledOnce()
		})
	})

	describe('loadAllGracePeriods', () => {
		it('returns every persisted row', async () => {
			const rows = [
				{
					id: 'row1',
					playerId: 'p1',
					lobbyCode: 'TESTLB',
					displayName: 'Bob',
					disconnectedAt: new Date(),
					expiresAt: new Date(),
					createdAt: new Date(),
				},
			]
			;(db as any).select = vi.fn().mockReturnValue({
				from: vi.fn().mockResolvedValue(rows),
			})

			const result = await loadAllGracePeriods()

			expect(result).toEqual(rows)
		})

		it('returns an empty array when nothing is persisted', async () => {
			;(db as any).select = vi.fn().mockReturnValue({
				from: vi.fn().mockResolvedValue([]),
			})

			expect(await loadAllGracePeriods()).toEqual([])
		})
	})
})
