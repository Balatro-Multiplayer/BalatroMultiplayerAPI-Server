import type { NextFunction, Request, Response } from 'express'
import { hasActiveBan } from '../infrastructure/gateways/ban.gateway.js'
import { authenticate } from './authenticate.js'

// Login plus no active account ban. A banned player can still log in to the
// website, but only the account pages (the auth router, which uses plain
// `authenticate`) work for them. Every other route that needs a login uses
// this. The ban is read fresh, so a new ban or a lift applies at once.
export function authenticateActive(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	authenticate(req, res, async () => {
		try {
			if (await hasActiveBan(req.player!.playerId, 'account')) {
				res
					.status(403)
					.json({ error: 'Your account is banned', code: 'account_banned' })
				return
			}
			next()
		} catch (err) {
			next(err)
		}
	})
}
