// One player's leaderboard record, made to match their stored rating. A
// player with their placement games behind them is on the board; others are
// not (the legacy leaderboard also hides everyone under 5 games).
import type { RatingRecord } from './apply'
import { PLACEMENT_GAMES } from './elo'

export function syncLeaderboardEntry(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger,
	board: string,
	metadata: { modId: string; mode: string },
	userId: string,
	name: string,
	record: RatingRecord | null,
): void {
	try {
		nk.leaderboardCreate(board, true, 'desc', 'set', null, metadata)
		if (record && record.gamesPlayed >= PLACEMENT_GAMES) {
			nk.leaderboardRecordWrite(
				board,
				userId,
				name,
				record.rating,
				record.wins,
				{
					losses: record.losses,
					gamesPlayed: record.gamesPlayed,
					seasonBest: record.seasonBest,
				},
				'set',
			)
		} else {
			try {
				nk.leaderboardRecordDelete(board, userId)
			} catch (err) {
				// Never on the board.
			}
		}
	} catch (e) {
		logger.warn('Leaderboard update on %s for %s failed: %v', board, userId, e)
	}
}
