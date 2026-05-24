import { db } from '../db/index.js'
import { flaggedMessages, reportedLobbyMessages } from '../db/schema.js'

type MatchRecord = {
	word: string
	startIndex: number
	endIndex: number
}

export async function insertFlaggedMessage(
	playerId: string,
	message: string,
	matches: MatchRecord[],
): Promise<void> {
	const threeMonths = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
	await db.insert(flaggedMessages).values({
		playerId,
		message,
		matches,
		expiresAt: threeMonths,
	})
}

export async function insertReportedLobbyMessage(entry: {
	lobbyId: string
	lobbyCode: string
	playerId: string
	displayName: string
	message: string
	sentAt: Date
}): Promise<void> {
	await db.insert(reportedLobbyMessages).values({
		...entry,
		expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
	})
}

export async function insertReportedLobbyMessages(
	entries: Array<{
		lobbyId: string
		lobbyCode: string
		playerId: string
		displayName: string
		message: string
		sentAt: Date
	}>,
): Promise<void> {
	const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
	await db.insert(reportedLobbyMessages).values(
		entries.map((entry) => ({ ...entry, expiresAt })),
	)
}
