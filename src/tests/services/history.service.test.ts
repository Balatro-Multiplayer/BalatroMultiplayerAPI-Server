import { describe, expect, it, vi } from 'vitest'
import { db } from '../../db/index.js'
import { logAction, logChat, logGameResult } from '../../services/history.service.js'

describe('history.service', () => {
	it('logGameResult inserts into database', async () => {
		await logGameResult(
			'ABCDE',
			'mod1',
			[{ id: 'p1' }],
			{ winner: 'p1' },
			new Date(),
		)

		expect(db.insert).toHaveBeenCalled()
	})

	it('logChat inserts into database', async () => {
		await logChat('ABCDE', 'p1', 'hello world')
		expect(db.insert).toHaveBeenCalled()
	})

	it('logAction inserts into database', async () => {
		await logAction('ABCDE', 'p1', 'swap_joker', { joker: 'j_blueprint' })
		expect(db.insert).toHaveBeenCalled()
	})

	it('silently catches database errors', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.mocked(db.insert).mockReturnValue({
			values: vi.fn().mockRejectedValue(new Error('DB down')),
		} as never)

		await logChat('ABCDE', 'p1', 'test')

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Failed to log chat'),
			expect.any(Error),
		)
		consoleSpy.mockRestore()
	})
})
