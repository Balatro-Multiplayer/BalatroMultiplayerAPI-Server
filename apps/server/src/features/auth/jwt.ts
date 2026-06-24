import jwt from 'jsonwebtoken'
import { env } from '../../env.js'
import type { JwtPayload } from '../../shared/types/index.js'

export function signJwt(payload: JwtPayload): string {
	return jwt.sign(payload, env.JWT_SECRET, {
		expiresIn: env.JWT_EXPIRES_IN as `${number}${'s' | 'm' | 'h' | 'd'}`,
	})
}

export function verifyJwt(token: string): JwtPayload | null {
	try {
		return jwt.verify(token, env.JWT_SECRET) as JwtPayload
	} catch {
		return null
	}
}

export function signTosPendingToken(playerId: string): string {
	return jwt.sign({ playerId, purpose: 'tos-accept' }, env.JWT_SECRET, {
		expiresIn: '10m',
	})
}

export function verifyTosPendingToken(token: string): string | null {
	try {
		const decoded = jwt.verify(token, env.JWT_SECRET) as {
			playerId: string
			purpose: string
		}
		if (decoded.purpose !== 'tos-accept') return null
		return decoded.playerId
	} catch {
		return null
	}
}
