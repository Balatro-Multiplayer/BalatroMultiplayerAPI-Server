// A staff edit of one stored match: set its result or void it. Nakama changes
// first (run, match history, ratings and leaderboard in one RPC), then the
// Postgres match and ratings take the same rating changes. Only that match's
// players move (ADR 0010); the rating board is never rebuilt.
import type { NakamaRpcError } from '../../infrastructure/nakama/admin-client.js'
import type { Result } from '../../shared/utils/result.js'

export interface EditedPlacement {
	playerId: string
	place: number
}

export type MatchEditRequest =
	| { kind: 'result'; placements: EditedPlacement[] }
	| { kind: 'void' }

export interface MatchRow {
	matchId: string
	modId: string
	gameMode: string
	status: string
	resultPlacements: unknown
	resultReportedAt: Date | null
}

// What the edit did to one player: the match's rating change before and after
// (null: not rated, or still in the placement games) and the amounts added to
// their stored rating row.
export interface PlayerRatingChange {
	playerId: string
	oldDelta: number | null
	newDelta: number | null
	rating: number
	wins: number
	losses: number
	gamesPlayed: number
}

// The old and new result and the rating changes: what the staff log keeps.
export interface MatchEditSummary {
	previous: EditedPlacement[] | null
	next: EditedPlacement[] | null
	ratingChanges: PlayerRatingChange[]
}

export type MatchEditOutcome =
	| { kind: 'edited'; rerated: boolean; summary: MatchEditSummary }
	| { kind: 'not_found' }
	| { kind: 'not_resolved'; status: string }
	| { kind: 'failed'; reason: string }

type NakamaChange = Omit<PlayerRatingChange, 'playerId'>

export interface MatchEditDeps {
	findMatch(matchId: string): Promise<MatchRow | null>
	// The season active at that moment, or null.
	seasonAt(at: Date): Promise<number | null>
	// playerId -> Nakama user id.
	nakamaIdsOf(playerIds: string[]): Promise<Map<string, string>>
	// Nakama user id -> playerId.
	playerIdsOf(nakamaIds: string[]): Promise<Map<string, string>>
	// admin_match_edit.
	editRun(
		body: Record<string, unknown>,
	): Promise<
		Result<
			{ applied: boolean; changes: { [nakamaUserId: string]: NakamaChange } },
			NakamaRpcError
		>
	>
	// The match row and the rating rows, in one transaction.
	applyRows(
		match: MatchRow,
		request: MatchEditRequest,
		changes: PlayerRatingChange[],
		season: number | null,
		// Nakama rated the game for the first time (a contested game), so the
		// rating rows move even though the match row already holds the result.
		ratedFirstTime: boolean,
	): Promise<void>
}

const sameResult = (a: unknown, b: EditedPlacement[]): boolean => {
	if (!Array.isArray(a) || a.length !== b.length) return false
	const places = new Map(
		(a as EditedPlacement[]).map((p) => [p.playerId, p.place]),
	)
	return b.every((p) => places.get(p.playerId) === p.place)
}

// Whether the match row already holds the edit, so its rating changes must not
// be applied twice (a retry after the rows failed to save).
export function matchAtTarget(
	match: MatchRow,
	request: MatchEditRequest,
): boolean {
	return request.kind === 'void'
		? match.status === 'voided'
		: sameResult(match.resultPlacements, request.placements)
}

const placementsOf = (value: unknown): EditedPlacement[] | null =>
	Array.isArray(value)
		? (value as EditedPlacement[]).map(({ playerId, place }) => ({
				playerId,
				place,
			}))
		: null

// `matchmade` is false for a private game: it has a run but no match row and
// no ratings.
export async function editMatch(
	deps: MatchEditDeps,
	game: { runId: string; matchmade: boolean },
	request: MatchEditRequest,
): Promise<MatchEditOutcome> {
	let match: MatchRow | null = null
	if (game.matchmade) {
		match = await deps.findMatch(game.runId)
		if (!match) return { kind: 'not_found' }
		// A void needs a resolved match (or a voided one: a retry). A result
		// may also be set on a match that did not resolve (a contest), unrated.
		const editable =
			request.kind === 'void'
				? match.status === 'resolved' || match.status === 'voided'
				: match.status !== 'voided'
		if (!editable) return { kind: 'not_resolved', status: match.status }
	}

	// Only a resolved ranked match has ratings to move.
	let season: number | null = null
	if (
		match &&
		match.status === 'resolved' &&
		match.gameMode.startsWith('ranked:')
	) {
		season = match.resultReportedAt
			? await deps.seasonAt(match.resultReportedAt)
			: null
		if (season === null)
			return {
				kind: 'failed',
				reason: `no season was active when match ${match.matchId} resolved`,
			}
	}

	const body: Record<string, unknown> = { runId: game.runId }
	if (season !== null) body.season = season
	if (request.kind === 'void') {
		body.void = true
	} else {
		const ids = await deps.nakamaIdsOf(
			request.placements.map((p) => p.playerId),
		)
		if (request.placements.some((p) => !ids.has(p.playerId)))
			return {
				kind: 'failed',
				reason: 'a player in that result has no Nakama account',
			}
		body.placements = request.placements.map((p) => ({
			playerId: ids.get(p.playerId) as string,
			place: p.place,
		}))
	}

	const edited = await deps.editRun(body)
	if (!edited.ok)
		return { kind: 'failed', reason: `admin_match_edit ${edited.error}` }

	const nakamaIds = Object.keys(edited.value.changes)
	const playerIds = await deps.playerIdsOf(nakamaIds)
	const ratingChanges: PlayerRatingChange[] = []
	for (const id of nakamaIds) {
		const playerId = playerIds.get(id)
		if (playerId) ratingChanges.push({ playerId, ...edited.value.changes[id] })
	}

	const ratedFirstTime =
		edited.value.applied &&
		ratingChanges.length > 0 &&
		ratingChanges.every((c) => c.oldDelta === null)
	if (match)
		await deps.applyRows(match, request, ratingChanges, season, ratedFirstTime)
	return {
		kind: 'edited',
		rerated: season !== null,
		summary: {
			previous: match ? placementsOf(match.resultPlacements) : null,
			next: request.kind === 'void' ? null : request.placements,
			ratingChanges,
		},
	}
}
