// Telling players how a season ended. The API computes each player's place and
// rating on every board they are on, the way the website leaderboard shows
// them (decay included), and hands them here when a season ends. Each player
// gets one Notification listing all their boards.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { parsePayload, requireServer } from '../rpc'
import { NotificationKind, type SeasonEnd, type SeasonEndBoard } from './kinds'
import { sendNotification } from './store'

export const SEASON_END_COLLECTION = 'season_end_notified'
const USER_ID_PATTERN = /^[0-9a-f-]{36}$/
const MAX_PLAYERS = 500
const MAX_BOARDS = 50

function parseBoards(value: unknown): SeasonEndBoard[] | undefined {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BOARDS)
		return undefined
	const boards: SeasonEndBoard[] = []
	for (const b of value) {
		if (typeof b !== 'object' || b === null) return undefined
		const { name, place, rating } = b as { [key: string]: unknown }
		if (
			typeof name !== 'string' ||
			name === '' ||
			typeof place !== 'number' ||
			!Number.isInteger(place) ||
			place < 1 ||
			typeof rating !== 'number' ||
			!Number.isFinite(rating)
		)
			return undefined
		boards.push({ name, place, rating: Math.round(rating) })
	}
	return boards
}

// {season, name?, players: [{userId, boards: [{name, place, rating}]}]} ->
// {notified, skipped}. A player already told for this season is skipped, so
// the API can repeat a call that failed part way.
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
	if (
		!Array.isArray(input.players) ||
		input.players.length > MAX_PLAYERS
	)
		throw runtimeError(INVALID_ARGUMENT, 'players must be a list of up to 500')
	const key = String(season)
	let notified = 0
	let skipped = 0
	for (const p of input.players) {
		const userId = (p as { userId?: unknown } | null)?.userId
		const boards = parseBoards((p as { boards?: unknown } | null)?.boards)
		if (typeof userId !== 'string' || !USER_ID_PATTERN.test(userId) || !boards)
			throw runtimeError(INVALID_ARGUMENT, 'Invalid player entry')
		const done = nk.storageRead([
			{ collection: SEASON_END_COLLECTION, key, userId },
		])
		if (done.length > 0) {
			skipped++
			continue
		}
		const params: SeasonEnd = { season, name, boards }
		sendNotification(nk, userId, NotificationKind.SEASON_END, params)
		nk.storageWrite([
			{
				collection: SEASON_END_COLLECTION,
				key,
				userId,
				value: { at: Date.now() },
				permissionRead: 0,
				permissionWrite: 0,
			},
		])
		notified++
	}
	logger.info('Season %d end told to %d players (%d skipped)', season, notified, skipped)
	return JSON.stringify({ notified, skipped })
}
