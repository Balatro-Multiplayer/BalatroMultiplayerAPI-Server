import { createHash, randomBytes } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import { db } from '../db/index.js'
import { refreshTokens } from '../db/schema.js'

const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex')
}

export async function issueRefreshToken(playerId: string): Promise<string> {
	const plaintext = randomBytes(48).toString('base64url')
	const tokenHash = hashToken(plaintext)
	const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

	await db.insert(refreshTokens).values({
		playerId,
		tokenHash,
		expiresAt,
	})

	return plaintext
}

export async function redeemRefreshToken(
	token: string,
): Promise<string | null> {
	const tokenHash = hashToken(token)

	const row = await db.query.refreshTokens.findFirst({
		where: eq(refreshTokens.tokenHash, tokenHash),
	})

	if (!row) return null

	// Delete the consumed token (one-time use)
	await db.delete(refreshTokens).where(eq(refreshTokens.id, row.id))

	if (row.expiresAt < new Date()) return null

	return row.playerId
}

export async function revokeAllTokens(playerId: string): Promise<void> {
	await db
		.delete(refreshTokens)
		.where(eq(refreshTokens.playerId, playerId))
}

export async function cleanupExpiredTokens(): Promise<number> {
	const result = await db
		.delete(refreshTokens)
		.where(lt(refreshTokens.expiresAt, new Date()))
		.returning({ id: refreshTokens.id })
	return result.length
}
