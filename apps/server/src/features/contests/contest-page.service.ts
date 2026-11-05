// The page a player sees after contesting in the game: it opens once, takes a
// reason and text, and lets the contester Withdraw until staff decide (ADR
// 0011). Opened again later, it shows only "Submitted". The Contest is
// identified by the match and the logged-in player.
//
// Withdrawing an in-game Contest is the contester's forfeit: the result is set
// with the contester last (forfeit.ts), then the match's queue item closes. It
// wins over a staff claim, as a withdrawn report does.
import { WITHDRAWN_ACTION } from '../reports/report-page.service.js'
import type { GameRef } from '../service-queue/dispatcher.js'
import type { Placement } from '../service-queue/overturn.js'
import { ratedPlacements } from '../service-queue/overturn.js'
import { forfeitPlacements } from './forfeit.js'

export { WITHDRAWN_ACTION }

export const CONTEST_REASONS = ['stalling', 'rule_breaking', 'other'] as const
export type ContestReason = (typeof CONTEST_REASONS)[number]
export const MAX_CONTEST_DETAIL = 2000

export interface ContestPageRow {
	id: number
	runId: string
	kind: string
	contesterId: string
	reason: string | null
	detail: string | null
	withdrawnAt: Date | null
	createdAt: Date
}

export interface ContestPageDeps<Tx> {
	getContest(runId: string, contesterId: string): Promise<ContestPageRow | null>
	// True for the one call that opened the page (it had not been opened).
	markPageOpened(id: number, now: Date): Promise<boolean>
	setDetail(id: number, reason: ContestReason | null, detail: string): Promise<void>
	// The match's one queue item; null until the run is stored.
	findQueueItem(runId: string): Promise<{ id: number; status: string } | null>

	gameOf(runId: string): Promise<GameRef | null>
	participantsOf(game: GameRef): Promise<string[]>
	originalResultOf(game: GameRef): Promise<Placement[]>
	flaggedPlayersOf(runId: string): Promise<Set<string>>
	// Sets the result, rating the match. The edit sends no Notification of its own.
	forfeitGame(game: GameRef, placements: (Placement & { rated?: boolean })[]): Promise<{ ok: true } | { ok: false; reason: string }>

	transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
	// Closes the item with the withdrawn action; false when it was no longer open.
	closeItem(tx: Tx, itemId: number, actor: string, now: Date): Promise<boolean>
	markWithdrawn(tx: Tx, contestId: number, now: Date): Promise<boolean>
	recordWithdrawn(tx: Tx, itemId: number, actor: string): Promise<void>
	// After the commit: tells the other players. A failure never undoes the withdraw.
	notifyWithdrawn(runId: string, contesterId: string): Promise<void>
	now(): Date
}

export type ContestPageState = 'open' | 'decided' | 'withdrawn'

export type ContestPage =
	| { pending: true }
	| { submitted: true }
	| {
			submitted: false
			contest: { createdAt: Date; reason: string | null; detail: string | null; state: ContestPageState }
	  }

export type ContestPageRefusal =
	| 'not_found'
	| 'decided'
	| 'already_withdrawn'
	| 'invalid_input'
	// The run is not stored yet (a larger match still playing), so there is no result to set.
	| 'match_running'
	| 'forfeit_failed'

export type ContestPageResult<T> = { ok: true; value: T } | { ok: false; refusal: ContestPageRefusal; reason?: string }

const fail = (refusal: ContestPageRefusal, reason?: string): { ok: false; refusal: ContestPageRefusal; reason?: string } => ({
	ok: false,
	refusal,
	reason,
})

export function isContestReason(value: unknown): value is ContestReason {
	return typeof value === 'string' && (CONTEST_REASONS as readonly string[]).includes(value)
}

export function createContestPageService<Tx>(deps: ContestPageDeps<Tx>) {
	async function stateOf(contest: ContestPageRow): Promise<ContestPageState> {
		if (contest.withdrawnAt) return 'withdrawn'
		const item = await deps.findQueueItem(contest.runId)
		return item && item.status !== 'open' ? 'decided' : 'open'
	}

	return {
		// The first call gets the page; every later call gets "Submitted". Before
		// the Contest is stored the answer is "pending" and uses nothing up.
		async open(runId: string, playerId: string): Promise<ContestPageResult<ContestPage>> {
			const contest = await deps.getContest(runId, playerId)
			if (!contest) return { ok: true, value: { pending: true } }
			if (!(await deps.markPageOpened(contest.id, deps.now()))) return { ok: true, value: { submitted: true } }
			const { createdAt, reason, detail } = contest
			return { ok: true, value: { submitted: false, contest: { createdAt, reason, detail, state: await stateOf(contest) } } }
		},

		async save(runId: string, playerId: string, reason: unknown, detail: unknown): Promise<ContestPageResult<null>> {
			const reasonOk = reason === null || reason === undefined || isContestReason(reason)
			const detailOk = detail === undefined || (typeof detail === 'string' && detail.length <= MAX_CONTEST_DETAIL)
			if (!reasonOk || !detailOk) return fail('invalid_input')
			const contest = await deps.getContest(runId, playerId)
			if (!contest) return fail('not_found')
			if ((await stateOf(contest)) !== 'open') return fail('decided')
			await deps.setDetail(contest.id, (reason as ContestReason | null | undefined) ?? null, (detail as string | undefined) ?? '')
			return { ok: true, value: null }
		},

		async withdraw(runId: string, playerId: string): Promise<ContestPageResult<null>> {
			const contest = await deps.getContest(runId, playerId)
			if (!contest) return fail('not_found')
			if (contest.withdrawnAt) return fail('already_withdrawn')
			const item = await deps.findQueueItem(runId)
			if (!item) return fail('match_running')
			if (item.status !== 'open') return fail('decided')
			const game = await deps.gameOf(runId)
			if (!game) return fail('match_running')

			const [participants, original] = await Promise.all([deps.participantsOf(game), deps.originalResultOf(game)])
			const placements = forfeitPlacements(participants, original, playerId)
			if (!placements) return fail('forfeit_failed', 'the match has no players to rate')
			const flagged = game.ranked ? await deps.flaggedPlayersOf(runId) : new Set<string>()
			// Setting the result is safe to repeat, so a retry after a failed commit is too.
			const forfeited = await deps.forfeitGame(game, ratedPlacements(placements, flagged, game.ranked))
			if (!forfeited.ok) return fail('forfeit_failed', forfeited.reason)

			const now = deps.now()
			const actor = `player:${playerId}`
			const closed = await deps.transaction(async (tx) => {
				if (!(await deps.closeItem(tx, item.id, actor, now))) return false
				if (!(await deps.markWithdrawn(tx, contest.id, now))) throw new Error('contest already withdrawn')
				await deps.recordWithdrawn(tx, item.id, actor)
				return true
			})
			if (!closed) return fail('decided')
			await deps.notifyWithdrawn(runId, playerId)
			return { ok: true, value: null }
		},
	}
}

export type ContestPageService = ReturnType<typeof createContestPageService>
