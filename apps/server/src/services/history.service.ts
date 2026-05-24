import { db } from '../db/index.js'
import { actionLogs, chatLogs, gameResults } from '../db/schema.js'

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
) {
	try {
		await db.insert(chatLogs).values({
			lobbyCode,
			playerId,
			message,
		})
	} catch (err) {
		console.error('[history] Failed to log chat:', err)
	}
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
