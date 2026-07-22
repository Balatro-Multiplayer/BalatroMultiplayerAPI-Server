// Draft service: issues server-generated draft pools, idempotently.

import { ForbiddenError, NotFoundError } from '../../shared/utils/errors.js'
import { DECK } from './draft-constants.js'
import type { DraftPolicy } from './draft-policy.js'
import type { DraftRepository } from './draft.repository.js'
import {
	type DraftTuple,
	type Rng,
	generateDraftPool,
} from './generate-draft-pool.js'
import { getWeeklyCocktail } from './weekly-cocktail.js'

// Self-describing items: stamp this week's composition onto any cocktail
// tuple so the pool response carries it, no separate weekly-config fetch.
// Client appends its own "Cocktail" wording to the bare name.
function attachWeeklyCocktail(pool: DraftTuple[]): void {
	const weekly = getWeeklyCocktail()
	for (const tuple of pool) {
		if (tuple.key === DECK.COCKTAIL) {
			tuple.decks = [...weekly.decks]
			tuple.name = weekly.name
		}
	}
}

export interface DraftMatchInfo {
	matchId: string
	modId: string
	gameMode: string
	playerIds: string[]
}

export interface DraftServiceDeps {
	repo: DraftRepository
	getMatch: (matchId: string) => DraftMatchInfo | undefined
	getPolicy: (modId: string, gameMode: string) => DraftPolicy | undefined
	rng?: Rng
	log?: Pick<Console, 'log'>
}

export function makeDraftService(deps: DraftServiceDeps) {
	const rng: Rng = deps.rng ?? Math.random
	const log = deps.log ?? console

	// Single-flight per match: with an async repo, check-then-set (getPool ->
	// generate -> savePool) spans awaits, so two concurrent first calls could
	// both roll. Setting the map entry in the same task as the miss check makes
	// the roll unique within this process; cross-process uniqueness is the
	// future Drizzle impl's job (insert-if-absent returning the winner).
	const inFlightRolls = new Map<string, Promise<DraftTuple[]>>()

	function requireParticipant(
		matchId: string,
		playerId: string,
	): DraftMatchInfo {
		const match = deps.getMatch(matchId)
		if (!match) throw new NotFoundError('Match not found')
		if (!match.playerIds.includes(playerId))
			throw new ForbiddenError('Not a participant of this match')
		return match
	}

	return {
		// Idempotent: FIRST call rolls and persists; every later call (transport
		// retry, host reconnect) returns the identical pool. 404s when the queue
		// has no policy -- the client's signal to fall back to its own generation.
		async issueDraftPool(
			matchId: string,
			playerId: string,
		): Promise<{ pool: DraftTuple[]; reused: boolean }> {
			const match = requireParticipant(matchId, playerId)

			const existing = await deps.repo.getPool(matchId)
			if (existing) return { pool: existing, reused: true }

			const inFlight = inFlightRolls.get(matchId)
			if (inFlight) return { pool: await inFlight, reused: true }

			const roll = (async () => {
				const policy = deps.getPolicy(match.modId, match.gameMode)
				if (!policy) throw new NotFoundError('No draft policy for this queue')

				const pool = generateDraftPool(policy, rng)
				attachWeeklyCocktail(pool)
				await deps.repo.savePool(matchId, pool)
				log.log(
					`[draft] issued pool for match ${matchId} (${match.modId}:${match.gameMode}) -- ${pool.length} tuples`,
				)
				return pool
			})()
			inFlightRolls.set(matchId, roll)
			try {
				return { pool: await roll, reused: false }
			} finally {
				inFlightRolls.delete(matchId)
			}
		},
	}
}

export type DraftService = ReturnType<typeof makeDraftService>
