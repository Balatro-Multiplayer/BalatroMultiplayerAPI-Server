// Rating read RPCs: a player's own rating on a board, and a board's top.
import { INVALID_ARGUMENT, UNAUTHENTICATED, runtimeError } from '../errors'
import { boardId, loadRatings, newRating } from './apply'
import { RATINGS_COLLECTION } from '../lobby/protocol'
import type { Rated } from './season'
import { currentSeason, decayedRating } from './season'
import { PLACEMENT_GAMES } from './elo'
import { seasonBestOf } from './metrics'

const BOARD_PAGE = 50
const USER_ID_PATTERN = /^[0-9a-f-]{36}$/
const MODE_PATTERN = /^[A-Za-z0-9_:.-]{1,64}$/

function boardOf(payload: string): { modId: string; mode: string; input: { [key: string]: unknown } } {
	let input: { [key: string]: unknown } = {}
	try {
		const data = payload ? JSON.parse(payload) : {}
		if (typeof data === 'object' && data !== null && !Array.isArray(data)) input = data
	} catch (e) {
		throw runtimeError(INVALID_ARGUMENT, 'Payload must be a JSON object')
	}
	const { modId, mode } = input
	if (typeof modId !== 'string' || typeof mode !== 'string' || !MODE_PATTERN.test(mode))
		throw runtimeError(INVALID_ARGUMENT, 'modId and mode are required')
	return { modId, mode, input }
}

// {modId, mode, playerId?} -> the player's (default: the caller's) rating record on that board (a fresh one if
// they haven't played it), plus whether they're still in placement games, how many there are, and their place
// on the board once they're past them.
export function rpcRatingGet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	if (!ctx.userId) throw runtimeError(UNAUTHENTICATED, 'Rating RPCs need a player session')
	const { modId, mode, input } = boardOf(payload)
	// Ratings are public: a lobby's players read each other's (the card info
	// shown for an opponent). Default is the caller's own.
	const playerId = input.playerId === undefined ? ctx.userId : input.playerId
	if (typeof playerId !== 'string' || !USER_ID_PATTERN.test(playerId))
		throw runtimeError(INVALID_ARGUMENT, 'playerId is not a user id')
	const season = currentSeason(nk)
	const rating = loadRatings(nk, modId, mode, [playerId], Date.now(), season).current[playerId] || newRating()
	const isPlacement = rating.gamesPlayed < PLACEMENT_GAMES
	return JSON.stringify({
		...rating,
		seasonBest: seasonBestOf(modId, rating.seasonBest),
		isPlacement,
		placementGames: PLACEMENT_GAMES,
		rank: isPlacement ? null : boardRankOf(nk, boardId(modId, mode, season), playerId),
	})
}

// The player's place on a board, or null when they aren't on it (still placing,
// or the board doesn't exist yet). Ranked by the stored score, as the board
// pages are before their in-page re-rank, so a decayed player can read a
// place or two high until their next game.
export function boardRankOf(nk: nkruntime.Nakama, id: string, playerId: string): number | null {
	try {
		const owned = nk.leaderboardRecordsList(id, [playerId], 1, '', 0).ownerRecords || []
		const record = owned.find((r) => r.ownerId === playerId)
		return record ? record.rank : null
	} catch (e) {
		return null
	}
}

// {modId, mode, cursor?} -> {entries: [{rank, playerId, name, rating, wins,
// losses, gamesPlayed, seasonBest}], cursor}. Only players past their
// placement games are on a board.
export function rpcLeaderboardGet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	if (!ctx.userId) throw runtimeError(UNAUTHENTICATED, 'Rating RPCs need a player session')
	const { modId, mode, input } = boardOf(payload)
	const cursor = typeof input.cursor === 'string' ? input.cursor : ''
	let page: ReturnType<nkruntime.Nakama['leaderboardRecordsList']>
	try {
		page = nk.leaderboardRecordsList(boardId(modId, mode, currentSeason(nk)), null, BOARD_PAGE, cursor, 0)
	} catch (e) {
		// The board is created by the first rated game.
		return JSON.stringify({ entries: [], cursor: '' })
	}
	const records = page.records || []
	const stored = storedRatings(nk, records.map((r) => r.ownerId), boardId(modId, mode, currentSeason(nk)))
	return JSON.stringify({
		entries: boardEntries(records, stored, Date.now(), modId),
		cursor: page.nextCursor || '',
	})
}

// Reads the stored (undecayed) rating objects behind a page of board records.
function storedRatings(nk: nkruntime.Nakama, userIds: string[], key: string): { [userId: string]: Rated } {
	const out: { [userId: string]: Rated } = {}
	if (userIds.length === 0) return out
	for (const object of nk.storageRead(userIds.map((userId) => ({ collection: RATINGS_COLLECTION, key, userId }))))
		out[object.userId] = object.value as unknown as Rated
	return out
}

export interface BoardEntry {
	rank: number
	playerId: string
	name: string | undefined
	rating: number
	wins: number
	losses: unknown
	gamesPlayed: unknown
	seasonBest: unknown
}

// A board page as players see it: each score is the stored rating, so the
// entries are decayed the way rating_get and the website decay them, and the
// page re-ranked by the decayed rating (then wins, as the website ranks).
// Re-ranking is within the page: a decayed player can still sit a page too
// high until their next game rewrites their score. Pure.
export function boardEntries(
	records: nkruntime.LeaderboardRecord[],
	stored: { [userId: string]: Rated },
	now: number,
	modId: string,
): BoardEntry[] {
	if (records.length === 0) return []
	const firstRank = Math.min(...records.map((r) => r.rank))
	return records
		.map((r) => {
			const record = stored[r.ownerId]
			return {
				playerId: r.ownerId,
				name: r.username,
				rating: record ? decayedRating({ ...record, rating: r.score }, now) : r.score,
				wins: r.subscore,
				losses: r.metadata.losses,
				gamesPlayed: r.metadata.gamesPlayed,
				seasonBest: seasonBestOf(modId, r.metadata.seasonBest),
			}
		})
		.sort((a, b) => b.rating - a.rating || b.wins - a.wins)
		.map((e, i) => ({ rank: firstRank + i, ...e }))
}
