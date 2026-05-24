import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../shared/utils/errors.js'

export function errorHandler(
	err: Error,
	_req: Request,
	res: Response,
	_next: NextFunction,
) {
	if (err instanceof AppError) {
		res.status(err.statusCode).json({ error: err.message })
		return
	}

	console.error('[error] Unexpected error:', err)
	res.status(500).json({ error: 'Internal server error' })
}
