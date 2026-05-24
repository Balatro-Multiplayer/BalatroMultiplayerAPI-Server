import { db } from '../db/index.js'
import { reports, reportedLobbyMessages } from '../db/schema.js'
import type { Lobby } from '../state/lobby.js'

export async function submitReport(
	lobby: Lobby,
	reporterId: string,
	reportedId: string,
	type: string,
	message: string | undefined,
): Promise<void> {
	await db.insert(reports).values({
		lobbyId: lobby.id,
		lobbyCode: lobby.code,
		reporterId,
		reportedId,
		type,
		message,
	})

	if (!lobby.isReported) {
		lobby.isReported = true

		// Flush the in-memory message buffer to DB so the history leading up to
		// the report is preserved alongside future messages.
		if (lobby.messageBuffer.length > 0) {
			const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
			await db.insert(reportedLobbyMessages).values(
				lobby.messageBuffer.map((entry) => ({
					lobbyId: lobby.id,
					lobbyCode: lobby.code,
					playerId: entry.playerId,
					displayName: entry.displayName,
					message: entry.message,
					sentAt: entry.sentAt,
					expiresAt,
				})),
			)
		}
	}
}
