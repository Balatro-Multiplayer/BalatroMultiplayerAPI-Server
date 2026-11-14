// Rates a finished ranked game. planRatings is pure; applyRatings reads and
// writes Nakama storage around it (and mirrors ratings into a leaderboard).
import {
	computeRatingDeltas,
	detectRatingMode,
	INITIAL_HIDDEN_RATING,
	PLACEMENT_GAMES,
	RATING_FLOOR,
} from './elo'
import { nextSeasonBest } from './metrics'
import { carriedOver, currentSeason, decayedRating } from './season'
import type { RunRecord } from '../lobby/protocol'
import { RATINGS_COLLECTION, type RatingResult } from '../lobby/protocol'

// A player's rating on one (mod, mode, season) board: the stored object.
export interface RatingRecord {
	rating: number
	wins: number
	losses: number
	gamesPlayed: number
	// Score text on a score board, milliseconds on a time board.
	seasonBest: number | string | null
	lastMatchAt: number
}

export function boardId(modId: string, mode: string, season: number): string {
	return `${modId}:${mode}:${season}`
}

export function newRating(): RatingRecord {
	return {
		rating: INITIAL_HIDDEN_RATING,
		wins: 0,
		losses: 0,
		gamesPlayed: 0,
		seasonBest: null,
		lastMatchAt: 0,
	}
}

export interface RatingPlan {
	updates: { [userId: string]: RatingRecord }
	results: { [userId: string]: RatingResult }
}

// How each player's game counts in wins and losses, the one owner of that rule:
// the players on the best place win and the rest lose, unless every rated player
// shares the best place. That is a draw, no one's win and no one's loss (the rating
// delta of a draw is unchanged). `[1,1,2]` is no draw: both first places win. A
// single placement is no draw either: a lone rated player keeps the win.
// Mirrored by `standingsOf` in apps/server/src/features/ratings/standing.ts (used by
// the gateway that rebuilds a voided match); change both together.
export type Standing = 'win' | 'loss' | 'draw'

export function standingsOf(
	placements: { playerId: string; place: number }[],
): Map<string, Standing> {
	const out = new Map<string, Standing>()
	if (placements.length === 0) return out
	const best = Math.min(...placements.map((p) => p.place))
	const draw =
		placements.length >= 2 && placements.every((p) => p.place === best)
	for (const p of placements)
		out.set(p.playerId, draw ? 'draw' : p.place === best ? 'win' : 'loss')
	return out
}

// Who is rated: everyone in an agreed or partial result (a disputed one isn't
// trusted). An anti-cheat flag (lobby/anticheat.ts) doesn't withhold a rating.
// `bounds` caps each player's season best at their replay log (logBounds).
export function planRatings(
	run: RunRecord,
	current: { [userId: string]: RatingRecord | undefined },
	bounds: { [userId: string]: string } = {},
): RatingPlan {
	const plan: RatingPlan = { updates: {}, results: {} }
	if (run.status !== 'agreed' && run.status !== 'partial') return plan
	const placements = run.placements
	if (placements.length < 2) return plan

	const ratings = new Map<string, RatingRecord>()
	for (const p of placements) ratings.set(p.playerId, current[p.playerId] || newRating())
	const entries = placements.map((p) => ({
		playerId: p.playerId,
		place: p.place,
		performance: p.performance,
	}))
	const deltas = computeRatingDeltas(detectRatingMode(entries), entries, ratings)
	const standings = standingsOf(placements)
	for (const p of placements) {
		const before = ratings.get(p.playerId) as RatingRecord
		const delta = deltas.get(p.playerId) || 0
		const standing = standings.get(p.playerId)
		const after: RatingRecord = {
			rating: Math.max(RATING_FLOOR, before.rating + delta),
			wins: before.wins + (standing === 'win' ? 1 : 0),
			losses: before.losses + (standing === 'loss' ? 1 : 0),
			gamesPlayed: before.gamesPlayed + 1,
			seasonBest: nextSeasonBest(run.modId, p, before.seasonBest, bounds[p.playerId]),
			lastMatchAt: run.endedAt,
		}
		plan.updates[p.playerId] = after
		// A player still in their placement games isn't shown their rating.
		const placing = after.gamesPlayed < PLACEMENT_GAMES
		plan.results[p.playerId] = {
			delta: placing ? null : after.rating - before.rating,
			newRating: placing ? null : after.rating,
			isPlacement: placing,
			// The game that finishes the placement games: the first rating shown.
			justPlaced: !placing && before.gamesPlayed < PLACEMENT_GAMES,
			gamesPlayed: after.gamesPlayed,
		}
	}
	return plan
}

// Pending optimistic-lock retries: ratings are shared by every match, so two
// games ending together can race on the same player's object.
const WRITE_ATTEMPTS = 5

// The players' ratings as they stand now: decayed for inactivity, and for a
// player with no record this season, carried over from the last one. `versions`
// holds the stored object's version (absent = nothing stored yet this season).
export function loadRatings(
	nk: nkruntime.Nakama,
	modId: string,
	mode: string,
	playerIds: string[],
	now: number,
	season: number,
): { current: { [userId: string]: RatingRecord }; versions: { [userId: string]: string | undefined } } {
	const key = boardId(modId, mode, season)
	const current: { [userId: string]: RatingRecord } = {}
	const versions: { [userId: string]: string | undefined } = {}
	for (const object of nk.storageRead(
		playerIds.map((id) => ({ collection: RATINGS_COLLECTION, key, userId: id })),
	)) {
		const record = object.value as unknown as RatingRecord
		current[object.userId] = { ...record, rating: decayedRating(record, now) }
		versions[object.userId] = object.version
	}
	const fresh = playerIds.filter((id) => !current[id])
	if (season > 1 && fresh.length > 0) {
		const previous = nk.storageRead(
			fresh.map((id) => ({
				collection: RATINGS_COLLECTION,
				key: boardId(modId, mode, season - 1),
				userId: id,
			})),
		)
		for (const object of previous) {
			const rating = carriedOver(object.value as unknown as RatingRecord, now)
			if (rating !== undefined) current[object.userId] = { ...newRating(), rating }
		}
	}
	return { current, versions }
}

// Reads, plans and writes the ratings for a finished ranked game, retrying
// when another game wrote a player's rating in between. Returns each rated
// player's result, or {} if nobody was rated.
export function applyRatings(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger,
	run: RunRecord,
	mode: string,
	bounds: { [userId: string]: string } = {},
): { [userId: string]: RatingResult } {
	const season = currentSeason(nk)
	const key = boardId(run.modId, mode, season)
	for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
		const { current, versions } = loadRatings(
			nk,
			run.modId,
			mode,
			run.players.map((p) => p.id),
			run.endedAt,
			season,
		)
		const plan = planRatings(run, current, bounds)
		const ids = Object.keys(plan.updates)
		if (ids.length === 0) return {}
		try {
			nk.storageWrite(
				ids.map((id) => ({
					collection: RATINGS_COLLECTION,
					key,
					userId: id,
					value: plan.updates[id] as unknown as { [key: string]: unknown },
					permissionRead: 2,
					permissionWrite: 0,
					// '*' = only if it doesn't exist yet.
					version: versions[id] || '*',
				})),
			)
		} catch (e) {
			logger.warn('Rating write for run %s conflicted (attempt %d): %v', run.runId, attempt + 1, e)
			continue
		}
		mirrorToLeaderboard(nk, logger, run, key, mode, plan)
		return plan.results
	}
	logger.error('Could not rate run %s after %d attempts', run.runId, WRITE_ATTEMPTS)
	return {}
}

// Players with their placement games behind them go on the board (the legacy
// leaderboard also hides everyone under 5 games).
function mirrorToLeaderboard(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger,
	run: RunRecord,
	id: string,
	mode: string,
	plan: RatingPlan,
) {
	try {
		nk.leaderboardCreate(id, true, 'desc', 'set', null, { modId: run.modId, mode })
		for (const player of run.players) {
			const after = plan.updates[player.id]
			if (!after || after.gamesPlayed < PLACEMENT_GAMES) continue
			nk.leaderboardRecordWrite(id, player.id, player.displayName, after.rating, after.wins, {
				losses: after.losses,
				gamesPlayed: after.gamesPlayed,
				seasonBest: after.seasonBest,
			}, 'set')
		}
	} catch (e) {
		logger.warn('Leaderboard update for run %s failed: %v', run.runId, e)
	}
}
