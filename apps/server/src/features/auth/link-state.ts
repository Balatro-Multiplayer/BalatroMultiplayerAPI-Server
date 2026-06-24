import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../../env.js'

const LINK_STATE_TTL = 5 * 60 * 1000

export const linkStateNonces = new Map<
	string,
	{ playerId: string; expiresAt: number; source?: string }
>()

export function generateLinkState(playerId: string, source?: string): string {
	const nonce = randomBytes(32).toString('hex')
	linkStateNonces.set(nonce, {
		playerId,
		expiresAt: Date.now() + LINK_STATE_TTL,
		source,
	})
	return jwt.sign({ nonce, purpose: 'discord-link' }, env.JWT_SECRET, {
		expiresIn: '5m',
	})
}

function decodeLinkStateJwt(
	state: string,
): { nonce: string; purpose: string } | null {
	try {
		return jwt.verify(state, env.JWT_SECRET) as {
			nonce: string
			purpose: string
		}
	} catch {
		return null
	}
}

function consumeLinkStateNonce(
	nonce: string,
): { playerId: string; expiresAt: number; source?: string } | null {
	const entry = linkStateNonces.get(nonce)
	if (!entry) return null
	linkStateNonces.delete(nonce)
	return entry
}

function isLinkStateNonceFresh(entry: { expiresAt: number }): boolean {
	return Date.now() <= entry.expiresAt
}

export function verifyLinkState(
	state: string,
): { playerId: string; source?: string } | null {
	const decoded = decodeLinkStateJwt(state)
	if (!decoded || decoded.purpose !== 'discord-link') return null

	const entry = consumeLinkStateNonce(decoded.nonce)
	if (!entry) return null
	if (!isLinkStateNonceFresh(entry)) return null

	return { playerId: entry.playerId, source: entry.source }
}
