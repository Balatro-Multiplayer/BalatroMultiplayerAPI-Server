import { describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import { logAction, logChat, logGameResult } from '../../infrastructure/gateways/history.gateway.js'

describe('history.service', () => {
	describe('logGameResult', () => {
		it('inserts a row with the correct fields', async () => {
			const valuesMock = vi.fn().mockResolvedValue(undefined)
			vi.mocked(db.insert).mockReturnValueOnce({ values: valuesMock } as never)

			const players = [{ id: 'p1', steamName: 'Alice' }]
			const result = { winner: 'p1' }
			const startedAt = new Date('2025-01-01T00:00:00Z')

			await logGameResult('ABCDE', 'mod1', players, result, startedAt)

			expect(valuesMock).toHaveBeenCalledWith(
				expect.objectContaining({
					lobbyCode: 'ABCDE',
					modId: 'mod1',
					players,
					result,
					startedAt,
				}),
			)
		})

		it('sets endedAt to the current time', async () => {
			const valuesMock = vi.fn().mockResolvedValue(undefined)
			vi.mocked(db.insert).mockReturnValueOnce({ values: valuesMock } as never)

			const before = new Date()
			await logGameResult('ABCDE', 'mod1', [], {}, new Date())
			const after = new Date()

			const { endedAt } = valuesMock.mock.calls[0][0] as { endedAt: Date }
			expect(endedAt).toBeInstanceOf(Date)
			expect(endedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
			expect(endedAt.getTime()).toBeLessThanOrEqual(after.getTime())
		})

		it('silently catches database errors', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			vi.mocked(db.insert).mockReturnValueOnce({
				values: vi.fn().mockRejectedValue(new Error('DB down')),
			} as never)

			await expect(logGameResult('X', 'mod1', [], {}, new Date())).resolves.toBeUndefined()
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to log game result'),
				expect.any(Error),
			)
			consoleSpy.mockRestore()
		})
	})

	describe('logChat', () => {
		it('inserts a row with the correct fields', async () => {
			const valuesMock = vi.fn().mockResolvedValue(undefined)
			vi.mocked(db.insert).mockReturnValueOnce({ values: valuesMock } as never)

			await logChat('ABCDE', 'p1', 'hello world')

			expect(valuesMock).toHaveBeenCalledWith(
				expect.objectContaining({
					lobbyCode: 'ABCDE',
					playerId: 'p1',
					message: 'hello world',
				}),
			)
		})

		it('silently catches database errors', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			vi.mocked(db.insert).mockReturnValueOnce({
				values: vi.fn().mockRejectedValue(new Error('DB down')),
			} as never)

			await expect(logChat('X', 'p1', 'msg')).resolves.toBeUndefined()
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to log chat'),
				expect.any(Error),
			)
			consoleSpy.mockRestore()
		})
	})

	describe('logAction', () => {
		it('inserts a row with the correct fields', async () => {
			const valuesMock = vi.fn().mockResolvedValue(undefined)
			vi.mocked(db.insert).mockReturnValueOnce({ values: valuesMock } as never)

			const payload = { joker: 'j_blueprint' }
			await logAction('ABCDE', 'p1', 'swap_joker', payload)

			expect(valuesMock).toHaveBeenCalledWith(
				expect.objectContaining({
					lobbyCode: 'ABCDE',
					playerId: 'p1',
					actionType: 'swap_joker',
					payload,
				}),
			)
		})

		it('silently catches database errors', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			vi.mocked(db.insert).mockReturnValueOnce({
				values: vi.fn().mockRejectedValue(new Error('DB down')),
			} as never)

			await expect(logAction('X', 'p1', 'act', {})).resolves.toBeUndefined()
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to log action'),
				expect.any(Error),
			)
			consoleSpy.mockRestore()
		})
	})
})
