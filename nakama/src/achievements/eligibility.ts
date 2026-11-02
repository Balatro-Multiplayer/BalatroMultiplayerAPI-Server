// Whether a finished game counts toward a player's achievements, and as
// what. A game counts when it finished (agreed, partial or disputed), the
// player wasn't flagged, it hasn't been counted already, and it was a real
// game: at least MIN_HANDS hands from the player, MIN_GAME_MS long, and at
// least two players who played a hand. Private lobbies count too, at most
// PRIVATE_DAILY_CAP times a day against the same opponents (alt farming).
// A disputed result or a draw counts the game but not who won. Pure.
import type { Placement, RunRecord, RunStatus } from '../lobby/protocol'
import type { CountedGame, GameKind, GameResult, Progress } from './progress'
import type { LogFacts } from './facts'

export const MIN_HANDS = 3
export const MIN_GAME_MS = 120 * 1000
export const MIN_ACTIVE_PLAYERS = 2
export const PRIVATE_DAILY_CAP = 10

export const FINISHED_STATUSES: readonly RunStatus[] = ['agreed', 'partial', 'disputed']

const MOD_KINDS: { [modId: string]: GameKind } = { MultiplayerPvP: 'pvp', MultiplayerSPDRN: 'spdrn' }

export type SkipReason =
	| 'not_participant'
	| 'not_finished'
	| 'flagged'
	| 'already_counted'
	| 'too_few_hands'
	| 'too_short'
	| 'too_few_active'
	| 'private_cap'

export type Eligibility = { kind: 'counts'; game: CountedGame } | { kind: 'skipped'; reason: SkipReason }

function resultOf(run: RunRecord, playerId: string): GameResult {
	if (run.status === 'disputed') return 'unknown'
	const placement = run.placements.filter((p: Placement) => p.playerId === playerId)[0]
	if (!placement) return 'unknown'
	if (placement.place !== 1) return 'loss'
	// A shared first place is a draw (no win, and no loss either), unless it is a
	// winning team: PvP reports a team's winners at place 1 with performance 1.
	const shared = run.placements.filter((p: Placement) => p.place === 1).length > 1
	return shared && placement.performance !== 1 ? 'unknown' : 'win'
}

export function eligibilityOf(
	run: RunRecord,
	playerId: string,
	facts: { [userId: string]: LogFacts },
	metShowman: boolean,
	progress: Progress,
	day: string,
): Eligibility {
	const skip = (reason: SkipReason): Eligibility => ({ kind: 'skipped', reason })
	if (!run.players.some((p) => p.id === playerId)) return skip('not_participant')
	if (FINISHED_STATUSES.indexOf(run.status) === -1) return skip('not_finished')
	if (run.flags && run.flags[playerId]) return skip('flagged')
	if (progress.countedRunIds.indexOf(run.runId) !== -1) return skip('already_counted')
	const own = facts[playerId]
	if (!own || own.hands < MIN_HANDS) return skip('too_few_hands')
	if (run.endedAt - run.startedAt < MIN_GAME_MS) return skip('too_short')
	const active = run.players.filter((p) => facts[p.id] && facts[p.id].hands > 0)
	if (active.length < MIN_ACTIVE_PLAYERS) return skip('too_few_active')

	const isPrivate = run.lobbyType !== 'public'
	const opponentsKey = isPrivate
		? run.players
				.map((p) => p.id)
				.filter((id) => id !== playerId)
				.sort()
				.join(',')
		: null
	if (opponentsKey !== null && progress.privateGames.day === day && (progress.privateGames.counts[opponentsKey] || 0) >= PRIVATE_DAILY_CAP)
		return skip('private_cap')

	return {
		kind: 'counts',
		game: {
			runId: run.runId,
			day,
			kind: MOD_KINDS[run.modId] || 'other',
			result: resultOf(run, playerId),
			activeOpponents: active.filter((p) => p.id !== playerId).length,
			metShowman,
			privateOpponentsKey: opponentsKey,
			facts: own,
		},
	}
}
