import type { DbTransaction } from '../../infrastructure/db/executor.js'
import {
	applyMatchEditRows,
	findMatchRow,
} from '../../infrastructure/gateways/match-edit.gateway.js'
import {
	findNakamaUserIds,
	findPlayerIdsByNakamaUserIds,
} from '../../infrastructure/gateways/player.gateway.js'
import { getSeasonAt } from '../../infrastructure/gateways/rating.gateway.js'
import { callNakamaRpc } from '../../infrastructure/nakama/admin-client.js'
import {
	type MatchEditDeps,
	type MatchEditRequest,
	type MatchRow,
	type PlayerRatingChange,
	editMatch,
} from './match-edit.service.js'

// The match edit wired to Postgres and Nakama. `inTransaction` runs inside the
// transaction that saves the rows (the admin route's staff log entry).
export function matchEditorFor(
	inTransaction?: (
		tx: DbTransaction,
		match: MatchRow,
		changes: PlayerRatingChange[],
	) => Promise<void>,
) {
	const deps: MatchEditDeps = {
		findMatch: findMatchRow,
		seasonAt: async (at) => (await getSeasonAt(at))?.id ?? null,
		nakamaIdsOf: findNakamaUserIds,
		playerIdsOf: findPlayerIdsByNakamaUserIds,
		editRun: (body) =>
			callNakamaRpc<
				Awaited<ReturnType<MatchEditDeps['editRun']>> extends { value: infer V }
					? V
					: never
			>('admin_match_edit', body, { timeoutMs: 15000 }),
		applyRows: (match, request, changes, season, ratedFirstTime) =>
			applyMatchEditRows(
				match.matchId,
				request,
				changes,
				season,
				ratedFirstTime,
				inTransaction && ((tx) => inTransaction(tx, match, changes)),
			),
	}
	return (
		game: { runId: string; matchmade: boolean },
		request: MatchEditRequest,
	) => editMatch(deps, game, request)
}
