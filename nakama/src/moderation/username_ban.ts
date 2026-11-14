// What a username ban changes when it starts or is lifted: the name everyone
// sees (the account's display name, the player's lobby seat, their own
// client) and their in-game leaderboard entries, which carry the name as
// written by the last rated game. The Ban name itself is never stored: it
// comes from the player's id (packages/types ban-name.ts).
import { RATINGS_COLLECTION } from '../lobby/protocol'
import { profileChanged } from '../player/rpc'
import { readProfile, shownNameOf } from '../player/profile'
import { syncLeaderboardEntry } from '../rating/board_sync'
import type { RatingRecord } from '../rating/apply'
import { forEachStored } from '../shared/storage'

// A board id is `<modId>:<mode>:<season>` (rating/apply.ts boardId).
function boardParts(board: string): { modId: string; mode: string } | null {
	const parts = board.split(':')
	if (parts.length < 3) return null
	return { modId: parts.slice(0, parts.length - 2).join(':'), mode: parts[parts.length - 2] }
}

// Writes `name` onto every leaderboard entry of the player.
export function renameLeaderboardEntries(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, name: string) {
	const boards: { board: string; record: RatingRecord }[] = []
	forEachStored(nk, userId, RATINGS_COLLECTION, (o) => {
		boards.push({ board: o.key, record: o.value as unknown as RatingRecord })
	})
	for (const { board, record } of boards) {
		const metadata = boardParts(board)
		if (metadata) syncLeaderboardEntry(nk, logger, board, metadata, userId, name, record)
	}
}

// After a username ban was put in force or lifted: the shown name reaches the
// account, the lobby and the player's sessions, and the leaderboards.
export function showNameChange(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string) {
	const stored = readProfile(nk, userId)
	if (!stored) return
	profileChanged(nk, logger, userId, stored.profile)
	renameLeaderboardEntries(nk, logger, userId, shownNameOf(nk, userId, stored.profile))
}
