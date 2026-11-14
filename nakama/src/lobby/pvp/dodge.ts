// Whether a seat leaving the lobby now ends the game as a dodge (docs/pvp-match.md
// section 7): a ranked game of two that has not begun its run, or whose seat was away
// when the run began (the seat that sat out the Draft), in the first run of the game.
// pvpTick (referee.ts) is the only place that decides and stores the dodge. The
// grace-expiry path (lobby/state.ts tick) reads this predicate only to leave the seat
// to pvpTick: it stores no forfeit for a pre-race leaver, and it does not remove a seat
// away since the race began until pvpTick has run, so the leaver gets exactly one record.
// The run has begun only at the first replay event (`raceStartedAt`), whether or not a
// request already froze the rules: a request from the seat that stayed does not turn a
// dodge into a forfeit. It mirrors the pre-run branch of `decide` (tick.ts): a contested
// game of two ends contested before that branch, a decided game is finished, and a lobby
// with no referee (a ranked lobby of another mod) is never ticked by pvpTick, so it keeps
// its forfeit.
import type { Lobby } from '../state'
import { awayBeforeRunOf } from './freeze_env'
import { refereeOf } from './state'

export function endsAsDodge(lobby: Lobby): boolean {
	const started = lobby.game.started
	if (lobby.rankedMode === undefined || !started) return false
	if (started.players.length !== 2) return false
	if (started.restarted) return false
	if (
		started.raceStartedAt !== undefined &&
		awayBeforeRunOf(lobby).length === 0
	)
		return false
	if (lobby.game.contest) return false
	const referee = refereeOf(lobby)
	if (referee === null) return false
	return !(
		referee.result.runId === started.runId && referee.result.kind !== null
	)
}
