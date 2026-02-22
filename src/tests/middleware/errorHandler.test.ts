import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../../middleware/errorHandler.js'
import { AppError } from '../../utils/errors.js'
import type { Request, Response, NextFunction } from 'express'

function mockRes() {
	return {
		status: vi.fn().mockReturnThis(),
		json: vi.fn().mockReturnThis(),
	} as unknown as Response
}

describe('errorHandler middleware', () => {
	const req = {} as Request
	const next = vi.fn() as NextFunction

	it('handles AppError with correct status and message', () => {
		const res = mockRes()
		const err = new AppError('Not found', 404)

		errorHandler(err, req, res, next)

		expect(res.status).toHaveBeenCalledWith(404)
		expect(res.json).toHaveBeenCalledWith({ error: 'Not found' })
	})

	it('handles unknown errors with 500', () => {
		const res = mockRes()
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		errorHandler(new Error('unexpected'), req, res, next)

		expect(res.status).toHaveBeenCalledWith(500)
		expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
		consoleSpy.mockRestore()
	})
})
