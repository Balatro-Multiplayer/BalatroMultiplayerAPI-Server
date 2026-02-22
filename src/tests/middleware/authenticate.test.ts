import { describe, expect, it, vi } from 'vitest'
import { authenticate } from '../../middleware/authenticate.js'
import { signJwt } from '../../services/auth.service.js'
import type { Request, Response, NextFunction } from 'express'

function mockReqRes(authHeader?: string) {
	const req = {
		headers: { authorization: authHeader },
	} as unknown as Request

	const res = {
		status: vi.fn().mockReturnThis(),
		json: vi.fn().mockReturnThis(),
	} as unknown as Response

	const next = vi.fn() as NextFunction

	return { req, res, next }
}

describe('authenticate middleware', () => {
	it('returns 401 when no Authorization header', () => {
		const { req, res, next } = mockReqRes()
		authenticate(req, res, next)

		expect(res.status).toHaveBeenCalledWith(401)
		expect(res.json).toHaveBeenCalledWith({
			error: 'Missing or malformed Authorization header',
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('returns 401 for non-Bearer token', () => {
		const { req, res, next } = mockReqRes('Basic abc123')
		authenticate(req, res, next)

		expect(res.status).toHaveBeenCalledWith(401)
		expect(next).not.toHaveBeenCalled()
	})

	it('returns 401 for invalid JWT', () => {
		const { req, res, next } = mockReqRes('Bearer garbage-token')
		authenticate(req, res, next)

		expect(res.status).toHaveBeenCalledWith(401)
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid or expired token',
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('populates req.player and calls next for valid JWT', () => {
		const token = signJwt({ playerId: 'steam1', username: 'Alice' })
		const { req, res, next } = mockReqRes(`Bearer ${token}`)

		authenticate(req, res, next)

		expect(req.player).toMatchObject({ playerId: 'steam1', username: 'Alice' })
		expect(next).toHaveBeenCalled()
		expect(res.status).not.toHaveBeenCalled()
	})
})
