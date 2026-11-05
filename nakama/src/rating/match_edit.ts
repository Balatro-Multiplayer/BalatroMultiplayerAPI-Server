// A staff edit of one finished ranked game: set its result or void it, and
// move only that game's players' ratings by the difference (ADR 0010). The
// edit never replays later games, so later changes keep the values they had.
// planMatchEdit is pure; rpcAdminMatchEdit reads and writes around it.
import { INVALID_ARGUMENT, runtimeError } from '../errors'
import {
	MY_RUNS_COLLECTION,
	RATINGS_COLLECTION,
	RUNS_COLLECTION,
	type RatingChange,
	type RatingResult,
	type RunRecord,
	SYSTEM_USER_ID,
} from '../lobby/protocol'
import { myRunKey, readRun } from '../lobby/storage'
import {
	type ResultPlacement,
	overturnRun,
	parseResultPlacements,
} from '../review/result'
import { planResultNotifications } from '../notification/result_change'
import { sendNotification } from '../notification/store'
import { parsePayload, requireServer } from '../rpc'
import { type RatingRecord, boardId, loadRatings, newRating } from './apply'
import { syncLeaderboardEntry } from './board_sync'
import {
	PLACEMENT_GAMES,
	RATING_FLOOR,
	computeRatingDeltas,
	detectRatingMode,
} from './elo'

export interface MatchEdit {
	// The new result, or null to void the game.
	placements: ResultPlacement[] | null
	// The board's season; null leaves ratings alone.
	season: number | null
	now: number
}

export type MatchEditRefusal =
	| { kind: 'players_differ' }
	| { kind: 'unchanged' }
	| { kind: 'voided' }
	// The player's rating change in this game is not stored (placement games).
	| { kind: 'old_change_unknown'; playerId: string }
	| { kind: 'record_missing'; playerId: string }
	// The stored record holds fewer wins, losses or games than the edit takes back.
	| { kind: 'record_too_small'; playerId: string }

export type MatchEditPlan =
	| {
			ok: true
			run: RunRecord
			// New my_runs place per player (absent: unchanged).
			places: { [userId: string]: number }
			// New my_runs rating per player; null clears it.
			myRunRatings: { [userId: string]: RatingResult | null }
			changes: { [userId: string]: RatingChange }
			// The new stored record of each player whose rating changed.
			records: { [userId: string]: RatingRecord }
	  }
	| { ok: false; refusal: MatchEditRefusal }

const refuse = (refusal: MatchEditRefusal): MatchEditPlan => ({
	ok: false,
	refusal,
})

function samePlayers(a: string[], b: string[]): boolean {
	const key = (ids: string[]) => ids.slice().sort().join(',')
	return a.length === b.length && key(a) === key(b)
}

// Same win rule as planRatings: everyone on the best place won (a draw is a
// win for all).
function winners(
	placements: { playerId: string; place: number }[],
): Set<string> {
	if (placements.length === 0) return new Set()
	const best = Math.min(...placements.map((p) => p.place))
	return new Set(
		placements.filter((p) => p.place === best).map((p) => p.playerId),
	)
}

interface Before {
	rating: number
	gamesPlayed: number
}

// `current` holds each player's stored record now (after any later games).
export function planMatchEdit(
	run: RunRecord,
	current: { [userId: string]: RatingRecord | undefined },
	edit: MatchEdit,
): MatchEditPlan {
	if (edit.placements === null && run.voided)
		return refuse({ kind: 'unchanged' })
	if (edit.placements !== null && run.voided) return refuse({ kind: 'voided' })

	const rated = run.rankedMode !== undefined && edit.season !== null
	const hadRatings = hasRatings(run)
	let next: RunRecord = run
	let places: { [userId: string]: number } = {}
	if (edit.placements !== null) {
		const overturn = overturnRun(run, edit.placements, edit.now)
		if (overturn.ok) {
			next = overturn.run
			places = overturn.places
		} else if (
			overturn.refusal.kind === 'unchanged' &&
			!hadRatings &&
			rated &&
			run.placements.length >= 2
		) {
			// Confirming the recorded result of a game nobody was rated for rates it.
		} else {
			return refuse(
				overturn.refusal.kind === 'unchanged'
					? { kind: 'unchanged' }
					: { kind: 'players_differ' },
			)
		}
	}

	const empty = {
		ok: true as const,
		places,
		myRunRatings: {},
		changes: {},
		records: {},
	}
	if (edit.placements === null) {
		const { ratings: _taken, ...rest } = run
		next = { ...rest, voided: { at: edit.now } }
		if (!rated || !hadRatings)
			return { ...empty, run: next, myRunRatings: nulls(run) }
	} else if (
		!rated ||
		(!hadRatings &&
			(run.status === 'abandoned' ||
				run.status === 'restarted' ||
				next.placements.length < 2))
	) {
		return { ...empty, run: next }
	}

	const ids = run.players.map((p) => p.id)
	const oldWon = winners(run.placements)
	const newWon = winners(next.placements)
	const befores: { [userId: string]: Before } = {}
	const oldDeltas: { [userId: string]: number | null } = {}
	for (const id of ids) {
		const record = current[id]
		const old = run.ratings?.[id]
		if (hadRatings) {
			if (!old || old.delta === null || old.newRating === null)
				return refuse({ kind: 'old_change_unknown', playerId: id })
			befores[id] = {
				rating: old.newRating - old.delta,
				gamesPlayed: old.gamesPlayed - 1,
			}
			oldDeltas[id] = old.delta
			if (!record) return refuse({ kind: 'record_missing', playerId: id })
		} else {
			const base = record ?? newRating()
			befores[id] = { rating: base.rating, gamesPlayed: base.gamesPlayed }
			oldDeltas[id] = null
		}
	}

	// The new change of every player, rated on the standings before this game.
	let newDeltas: Map<string, number> | null = null
	if (edit.placements !== null) {
		const entries = next.placements.map((p) => ({
			playerId: p.playerId,
			place: p.place,
			performance: p.performance,
		}))
		const ratings = new Map(ids.map((id) => [id, befores[id]]))
		newDeltas = computeRatingDeltas(detectRatingMode(entries), entries, ratings)
	}

	const changes: { [userId: string]: RatingChange } = {}
	const records: { [userId: string]: RatingRecord } = {}
	const ratings: { [userId: string]: RatingResult } = {}
	for (const id of ids) {
		const before = befores[id]
		const stored = current[id] ?? newRating()
		const oldDelta = oldDeltas[id]
		const wasWon = hadRatings && oldWon.has(id)
		let change: RatingChange
		if (newDeltas === null) {
			change = {
				oldDelta,
				newDelta: null,
				rating: -(oldDelta as number),
				wins: wasWon ? -1 : 0,
				losses: wasWon ? 0 : -1,
				gamesPlayed: -1,
			}
		} else {
			const after = Math.max(
				RATING_FLOOR,
				before.rating + (newDeltas.get(id) ?? 0),
			)
			const newDelta = after - before.rating
			const won = newWon.has(id)
			const gamesPlayed = before.gamesPlayed + 1
			const placing = gamesPlayed < PLACEMENT_GAMES
			change = {
				oldDelta,
				newDelta,
				rating: newDelta - (oldDelta ?? 0),
				wins: (won ? 1 : 0) - (wasWon ? 1 : 0),
				losses: (won ? 0 : 1) - (hadRatings && !wasWon ? 1 : 0),
				gamesPlayed: hadRatings ? 0 : 1,
			}
			const old = run.ratings?.[id]
			ratings[id] = hadRatings
				? { ...(old as RatingResult), delta: newDelta, newRating: after }
				: {
						delta: placing ? null : newDelta,
						newRating: placing ? null : after,
						isPlacement: placing,
						justPlaced: !placing && before.gamesPlayed < PLACEMENT_GAMES,
						gamesPlayed,
					}
		}
		const record: RatingRecord = {
			...stored,
			rating: Math.max(RATING_FLOOR, stored.rating + change.rating),
			wins: stored.wins + change.wins,
			losses: stored.losses + change.losses,
			gamesPlayed: stored.gamesPlayed + change.gamesPlayed,
			lastMatchAt:
				change.gamesPlayed > 0
					? Math.max(stored.lastMatchAt, run.endedAt)
					: stored.lastMatchAt,
		}
		if (record.wins < 0 || record.losses < 0 || record.gamesPlayed < 0)
			return refuse({ kind: 'record_too_small', playerId: id })
		changes[id] = change
		records[id] = record
	}

	if (newDeltas === null)
		return {
			...empty,
			run: { ...next, ratingChanges: changes },
			myRunRatings: nulls(run),
			changes,
			records,
		}
	return {
		...empty,
		run: { ...next, ratings, ratingChanges: changes },
		myRunRatings: ratings,
		changes,
		records,
	}
}

// A disputed run is stored with `ratings: {}`: that means nobody was rated.
function hasRatings(run: RunRecord): boolean {
	return run.ratings !== undefined && Object.keys(run.ratings).length > 0
}

function nulls(run: RunRecord): { [userId: string]: null } {
	const out: { [userId: string]: null } = {}
	for (const p of run.players) out[p.id] = null
	return out
}

const WRITE_ATTEMPTS = 3

const REFUSAL_TEXT: { [kind in MatchEditRefusal['kind']]: string } = {
	players_differ: "placements must place exactly the run's players",
	unchanged: 'That is already the recorded result',
	voided: 'The game is voided',
	old_change_unknown:
		"a player's rating change in this game was not stored (placement games)",
	record_missing: "a player's rating record is missing",
	record_too_small: "a player's rating record cannot hold the change",
}

// {runId, placements | void: true, season?, decidesContest?, contesters?} -> {run, changes,
// applied}. Each player whose result the edit changes gets a Notification;
// `decidesContest` (the service queue deciding a contest) picks the contest
// wording. `silent` records who was told but sends nothing.
// With a season, a ranked run's players are re-rated on that board by the
// difference. One storage write holds the run, each my_runs entry and the
// ratings, so they agree; the leaderboard follows. A repeated edit answers
// {applied: false} with the earlier edit's changes.
export function rpcAdminMatchEdit(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const voiding = input.void === true
	const placements = voiding ? null : parseResultPlacements(input.placements)
	if (!voiding && !placements)
		throw runtimeError(
			INVALID_ARGUMENT,
			'placements must be a list of {playerId, place}',
		)
	const decidesContest = input.decidesContest === true
	// The players whose Contests stand: they get the contester wording, in-game
	// or from the website.
	const contesters = Array.isArray(input.contesters)
		? input.contesters.filter((id): id is string => typeof id === 'string')
		: []
	// A caller that tells the players itself (a withdrawn Contest) sets
	// `silent`: the edit still records who was told, but sends nothing.
	const silent = input.silent === true
	const season = input.season
	if (
		season !== undefined &&
		(typeof season !== 'number' || !Number.isInteger(season) || season < 1)
	)
		throw runtimeError(INVALID_ARGUMENT, 'season must be a positive integer')

	for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
		const run = readRun(nk, input.runId)
		const ids = run.players.map((p) => p.id)
		const board =
			run.rankedMode !== undefined && typeof season === 'number'
				? boardId(run.modId, run.rankedMode, season)
				: null
		const stored: { [userId: string]: RatingRecord } = {}
		const versions: { [userId: string]: string | undefined } = {}
		if (board) {
			// A game nobody was rated for starts from the ratings a new game would.
			const base = hasRatings(run)
				? null
				: loadRatings(
						nk,
						run.modId,
						run.rankedMode as string,
						ids,
						run.endedAt,
						season as number,
					)
			for (const object of nk.storageRead(
				ids.map((id) => ({
					collection: RATINGS_COLLECTION,
					key: board,
					userId: id,
				})),
			)) {
				stored[object.userId] = object.value as unknown as RatingRecord
				versions[object.userId] = object.version
			}
			if (base)
				for (const id of ids)
					if (base.current[id]) stored[id] = base.current[id]
		}
		const plan = planMatchEdit(run, stored, {
			placements,
			season: typeof season === 'number' ? season : null,
			now: Date.now(),
		})
		if (!plan.ok) {
			if (plan.refusal.kind === 'unchanged') {
				// A contest decided by keeping the reported result changes no
				// record, but the players have not been told yet.
				const told = planResultNotifications(run, run, decidesContest, contesters)
				if (told.sends.length > 0) {
					nk.storageWrite([
						{
							collection: RUNS_COLLECTION,
							key: run.runId,
							userId: SYSTEM_USER_ID,
							value: { ...run, told: told.told } as unknown as {
								[key: string]: unknown
							},
							permissionRead: 2,
							permissionWrite: 0,
						},
					])
					if (!silent)
						for (const send of told.sends)
							sendNotification(nk, send.userId, send.kind, send.params as never)
				}
				return JSON.stringify({
					run,
					changes: run.ratingChanges ?? {},
					applied: false,
				})
			}
			throw runtimeError(INVALID_ARGUMENT, REFUSAL_TEXT[plan.refusal.kind])
		}

		const told = planResultNotifications(run, plan.run, decidesContest, contesters)
		const storedRun = { ...plan.run, told: told.told }
		const key = myRunKey(run)
		const pointers = nk.storageRead(
			ids.map((id) => ({ collection: MY_RUNS_COLLECTION, key, userId: id })),
		)
		const writes: nkruntime.StorageWriteRequest[] = [
			{
				collection: RUNS_COLLECTION,
				key: run.runId,
				userId: SYSTEM_USER_ID,
				value: storedRun as unknown as { [key: string]: unknown },
				permissionRead: 2,
				permissionWrite: 0,
			},
		]
		for (const pointer of pointers) {
			const value: { [key: string]: unknown } = { ...pointer.value }
			if (plan.places[pointer.userId] !== undefined)
				value.place = plan.places[pointer.userId]
			if (pointer.userId in plan.myRunRatings)
				value.rating = plan.myRunRatings[pointer.userId]
			writes.push({
				collection: MY_RUNS_COLLECTION,
				key,
				userId: pointer.userId,
				value,
				permissionRead: 1,
				permissionWrite: 0,
			})
		}
		for (const id of Object.keys(plan.records)) {
			writes.push({
				collection: RATINGS_COLLECTION,
				key: board as string,
				userId: id,
				value: plan.records[id] as unknown as { [key: string]: unknown },
				permissionRead: 2,
				permissionWrite: 0,
				version: versions[id] || '*',
			})
		}
		try {
			nk.storageWrite(writes)
		} catch (e) {
			logger.warn(
				'Match edit for run %s conflicted (attempt %d): %v',
				run.runId,
				attempt + 1,
				e,
			)
			continue
		}
		if (board) {
			for (const id of Object.keys(plan.records)) {
				const name = run.players.find((p) => p.id === id)?.displayName ?? ''
				syncLeaderboardEntry(
					nk,
					logger,
					board,
					{ modId: run.modId, mode: run.rankedMode as string },
					id,
					name,
					plan.records[id],
				)
			}
		}
		if (!silent)
			for (const send of told.sends)
				sendNotification(nk, send.userId, send.kind, send.params as never)
		logger.info(
			'Run %s %s by staff',
			run.runId,
			voiding ? 'voided' : 'result set',
		)
		return JSON.stringify({
			run: plan.run,
			changes: plan.changes,
			applied: true,
		})
	}
	throw runtimeError(
		INVALID_ARGUMENT,
		'The ratings changed while editing; try again',
	)
}
