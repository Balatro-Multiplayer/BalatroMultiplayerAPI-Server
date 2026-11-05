// Admin RPCs that read and clear a whole season's board: every rating record
// and every leaderboard record, including players the owner's season replay no
// longer rates. admin_ratings_set only touches the entries it is given. The
// API pages through these for its backup, then writes the replayed ratings
// with admin_ratings_set.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import { RATINGS_COLLECTION } from '../lobby/protocol'
import { listCollectionPage, parsePayload, requireServer } from '../rpc'

const LIST_PAGE = 100
// Storage pages scanned per call.
const PAGES_PER_CALL = 10

function seasonOf(input: { [key: string]: unknown }): number {
	const { season } = input
	if (typeof season !== 'number' || !Number.isInteger(season) || season < 1)
		throw runtimeError(INVALID_ARGUMENT, 'season must be a positive integer')
	return season
}

function cursorOf(input: { [key: string]: unknown }): string {
	if (input.cursor !== undefined && typeof input.cursor !== 'string')
		throw runtimeError(INVALID_ARGUMENT, 'cursor must be a string')
	return (input.cursor as string | undefined) || ''
}

// Rating records are keyed `<modId>:<mode>:<season>`.
function inSeason(key: string, season: number): boolean {
	return key.endsWith(`:${season}`)
}

// Runs `visit` on the season's rating records of up to PAGES_PER_CALL storage
// pages from `cursor`. Returns the cursor to continue from ('' = done).
function scanSeason(
	nk: nkruntime.Nakama,
	season: number,
	cursor: string,
	visit: (object: nkruntime.StorageObject) => void,
): string {
	let next = cursor
	for (let pages = 0; pages < PAGES_PER_CALL; pages++) {
		const page = listCollectionPage(nk, RATINGS_COLLECTION, LIST_PAGE, next)
		for (const o of page.objects || []) if (inSeason(o.key, season)) visit(o)
		next = page.cursor || ''
		if (next === '') break
	}
	return next
}

// {season, cursor?} -> {ratings: [{userId, key, value}], cursor}. Call again
// with the returned cursor until it is ''.
export function rpcAdminRatingsSeasonExport(
	ctx: nkruntime.Context,
	_logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const ratings: { userId: string; key: string; value: unknown }[] = []
	const cursor = scanSeason(nk, seasonOf(input), cursorOf(input), (o) =>
		ratings.push({ userId: o.userId, key: o.key, value: o.value }),
	)
	return JSON.stringify({ ratings, cursor })
}

// {board, cursor?} -> {records: [{ownerId, username, score, subscore,
// metadata}], cursor}. A board nobody was ever rated on has no records.
export function rpcAdminRatingsBoardExport(
	ctx: nkruntime.Context,
	_logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	if (typeof input.board !== 'string' || input.board === '')
		throw runtimeError(INVALID_ARGUMENT, 'board is required')
	const cursor = cursorOf(input)
	let page: ReturnType<nkruntime.Nakama['leaderboardRecordsList']>
	try {
		page = nk.leaderboardRecordsList(input.board, null, LIST_PAGE, cursor, 0)
	} catch (e) {
		if (cursor) throw runtimeError(INVALID_ARGUMENT, 'Invalid cursor')
		return JSON.stringify({ records: [], cursor: '' })
	}
	const records = (page.records || []).map((r) => ({
		ownerId: r.ownerId,
		username: r.username,
		score: r.score,
		subscore: r.subscore,
		metadata: r.metadata,
	}))
	return JSON.stringify({ records, cursor: page.nextCursor || '' })
}

// {season, cursor?} -> {cleared, cursor}. Deletes the season's rating records
// and each owner's leaderboard record. Call again with the returned cursor
// until it is ''.
export function rpcAdminRatingsSeasonClear(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const season = seasonOf(input)
	const found: nkruntime.StorageObject[] = []
	const cursor = scanSeason(nk, season, cursorOf(input), (o) => found.push(o))
	if (found.length > 0) {
		nk.storageDelete(
			found.map((o) => ({
				collection: RATINGS_COLLECTION,
				key: o.key,
				userId: o.userId,
			})),
		)
		for (const o of found) {
			try {
				nk.leaderboardRecordDelete(o.key, o.userId)
			} catch (e) {
				// Never on the board.
			}
		}
	}
	logger.info('Season %d ratings cleared: %d records', season, found.length)
	return JSON.stringify({ cleared: found.length, cursor })
}
