import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { actionLogs, chatLogs, gameResults } from '../db/schema.js'

const CHAT_LOG_TTL_MS = 90 * 24 * 60 * 60 * 1000

export async function logGameResult(
	lobbyCode: string,
	modId: string,
	players: Record<string, unknown>[],
	result: Record<string, unknown>,
	startedAt: Date,
) {
	try {
		await db.insert(gameResults).values({
			lobbyCode,
			modId,
			players,
			result,
			startedAt,
			endedAt: new Date(),
		})
	} catch (err) {
		console.error('[history] Failed to log game result:', err)
	}
}

export async function logChat(
	lobbyCode: string,
	playerId: string,
	message: string,
	steamIdHash: string | null,
) {
	try {
		await db.insert(chatLogs).values({
			lobbyCode,
			playerId,
			message,
			// Retained separately from playerId so moderators can still trace a
			// message back to an account even after account deletion pseudonymizes
			// playerId (see pseudonymizeChatLogsForPlayer).
			moderationId: steamIdHash,
			expiresAt: new Date(Date.now() + CHAT_LOG_TTL_MS),
		})
	} catch (err) {
		console.error('[history] Failed to log chat:', err)
	}
}

// Account-deletion side effect: chat logs aren't deleted (moderators may still
// need them for the remainder of their normal 90-day retention window), but
// the sender is no longer identifiable via playerId once their account is
// gone — moderationId (the hashed Steam ID) still carries whatever
// moderation-relevant linkage is needed.
export async function pseudonymizeChatLogsForPlayer(
	playerId: string,
): Promise<void> {
	await db
		.update(chatLogs)
		.set({ playerId: `deleted_user_${playerId}` })
		.where(eq(chatLogs.playerId, playerId))
}

export async function logAction(
	lobbyCode: string,
	playerId: string,
	actionType: string,
	payload: Record<string, unknown>,
) {
	try {
		await db.insert(actionLogs).values({
			lobbyCode,
			playerId,
			actionType,
			payload,
		})
	} catch (err) {
		console.error('[history] Failed to log action:', err)
	}
}
