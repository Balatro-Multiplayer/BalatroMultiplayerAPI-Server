import type { NextFunction, Request, Response } from 'express'
import { verifyJwt } from '../features/auth/auth.service.js'
import type { JwtPayload } from '../shared/types/index.js'

declare global {
	namespace Express {
		interface Request {
			player?: JwtPayload
		}
	}
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
	const header = req.headers.authorization
	if (!header?.startsWith('Bearer ')) {
		res.status(401).json({ error: 'Missing or malformed Authorization header' })
		return
	}

	const token = header.slice(7)
	const payload = verifyJwt(token)
	if (!payload) {
		res.status(401).json({ error: 'Invalid or expired token' })
		return
	}

	req.player = payload
	next()
}
