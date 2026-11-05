// Telling players how a season ended. The API calls this once when it rolls
// a season over. Each player with a ranked entry (past their placement games,
// as the leaderboard counts them) gets one Notification listing every board
// they are on, with the final place and rating.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { SYSTEM_USER_ID } from '../lobby/protocol'
import { PLACEMENT_GAMES } from '../rating/elo'
import { scanSeason } from '../rating/season_board'
import { parsePayload, requireServer } from '../rpc'
import { NotificationKind, type SeasonEnd, type SeasonEndBoard } from './kinds'
import { sendNotification } from './store'

export const SEASON_END_COLLECTION = 'season_end_notified'

interface Entry {
	userId: string
	rating: number
	wins: number
}

// Rating records are keyed `<modId>:<mode>:<season>`, and a mode may hold
// colons itself ("ranked:solo").
function splitBoardKey(
	key: string,
	season: number,
): { modId: string; mode: string } | undefined {
	const suffix = `:${season}`
	if (!key.endsWith(suffix)) return undefined
	const rest = key.slice(0, key.length - suffix.length)
	const colon = rest.indexOf(':')
	if (colon <= 0 || colon === rest.length - 1) return undefined
	return { modId: rest.slice(0, colon), mode: rest.slice(colon + 1) }
}

// Per player, their entries on the season's boards. Places follow the
// leaderboard order: rating, then wins.
export function seasonEndBoards(
	entriesByBoard: Map<string, Entry[]>,
	season: number,
): Map<string, SeasonEndBoard[]> {
	const byPlayer = new Map<string, SeasonEndBoard[]>()
	const keys = [...entriesByBoard.keys()].sort()
	for (const key of keys) {
		const board = splitBoardKey(key, season)
		if (!board) continue
		const ranked = (entriesByBoard.get(key) || [])
			.slice()
			.sort((a, b) => b.rating - a.rating || b.wins - a.wins)
		ranked.forEach((entry, i) => {
			const list = byPlayer.get(entry.userId) || []
			list.push({
				modId: board.modId,
				mode: board.mode,
				place: i + 1,
				rating: Math.round(entry.rating),
			})
			byPlayer.set(entry.userId, list)
		})
	}
	return byPlayer
}

function readBoards(nk: nkruntime.Nakama, season: number) {
	const entriesByBoard = new Map<string, Entry[]>()
	let cursor = ''
	do {
		cursor = scanSeason(nk, season, cursor, (o) => {
			const v = o.value as { [key: string]: unknown }
			if (
				typeof v.rating !== 'number' ||
				typeof v.gamesPlayed !== 'number' ||
				v.gamesPlayed < PLACEMENT_GAMES
			)
				return
			const list = entriesByBoard.get(o.key) || []
			list.push({
				userId: o.userId,
				rating: v.rating,
				wins: typeof v.wins === 'number' ? v.wins : 0,
			})
			entriesByBoard.set(o.key, list)
		})
	} while (cursor !== '')
	return entriesByBoard
}

// Sends one season_end Notification to each ranked player of the season.
export function notifySeasonEnd(
	nk: nkruntime.Nakama,
	season: number,
	name: string,
): number {
	const byPlayer = seasonEndBoards(readBoards(nk, season), season)
	for (const [userId, boards] of byPlayer) {
		const params: SeasonEnd = { season, name, boards }
		sendNotification(nk, userId, NotificationKind.SEASON_END, params)
	}
	return byPlayer.size
}

// {season, name?} -> {notified, repeated}. A season is told once: a second
// call for it sends nothing.
export function rpcAdminSeasonEndNotify(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const season = input.season
	if (typeof season !== 'number' || !Number.isInteger(season) || season < 1)
		throw runtimeError(INVALID_ARGUMENT, 'season must be a positive integer')
	const name =
		typeof input.name === 'string' && input.name !== ''
			? input.name
			: `Season ${season}`
	const key = String(season)
	const done = nk.storageRead([
		{ collection: SEASON_END_COLLECTION, key, userId: SYSTEM_USER_ID },
	])
	if (done.length > 0) return JSON.stringify({ notified: 0, repeated: true })
	// Marked first: a half-sent run is not repeated, since every player it
	// reached would get a second Notification.
	nk.storageWrite([
		{
			collection: SEASON_END_COLLECTION,
			key,
			userId: SYSTEM_USER_ID,
			value: { at: Date.now() },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
	const notified = notifySeasonEnd(nk, season, name)
	logger.info('Season %d end told to %d players', season, notified)
	return JSON.stringify({ notified, repeated: false })
}
