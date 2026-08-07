import { db } from '../db/index.js'
import { flaggedMessages, reportedLobbyMessages } from '../db/schema.js'

type MatchRecord = {
	word: string
	startIndex: number
	endIndex: number
}

// `matches` is an untyped jsonb column. The local obscenity filter records
// which words matched; the remote moderation bridge has no word list to
// report, only the band the service rejected on.
export type FlaggedMatches = MatchRecord[] | { source: 'remote'; band: string }

export async function insertFlaggedMessage(
	playerId: string,
	message: string,
	matches: FlaggedMatches,
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
