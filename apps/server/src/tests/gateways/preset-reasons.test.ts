import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import { editPresetReasons } from '../../infrastructure/gateways/preset-reasons.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'

vi.mock('../../infrastructure/gateways/staff-log.gateway.js', () => ({
	recordStaffAction: vi.fn().mockResolvedValue(undefined),
}))

describe('editPresetReasons', () => {
	const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
	const tx = {
		select: () => ({ from: async () => [{ itemType: 'flagged_chat', reasons: ['Spam.'] }] }),
		insert: () => ({ values: () => ({ onConflictDoUpdate }) }),
	}
	beforeEach(() => {
		;(db as any).transaction = vi.fn(async (run: (t: unknown) => unknown) => run(tx))
		vi.mocked(recordStaffAction).mockClear()
	})

	it('saves the list and logs the lists before and after in the same transaction', async () => {
		await editPresetReasons({ playerId: 'adm', role: 'admin' }, 'flagged_chat', ['Slur.'], 'Reworded')
		expect(onConflictDoUpdate).toHaveBeenCalled()
		expect(recordStaffAction).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({
				action: 'preset_reasons_edit',
				reason: 'Reworded',
				detail: { itemType: 'flagged_chat', before: ['Spam.'], after: ['Slur.'] },
			}),
		)
	})
})
