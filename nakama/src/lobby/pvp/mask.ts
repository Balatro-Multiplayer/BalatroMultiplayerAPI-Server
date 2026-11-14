// The score mask rule (docs/pvp-match.md section 4a). Kept apart from view.ts so
// the timer rule (deadline.ts) and the announcer (match_state.ts) can read it
// without an import cycle.
import { handsDone } from './modes/common'
import type { RefereeState } from './state'

// While a round is playing, a viewer sees no opponent score until they have
// played a hand of it (or have none left). A viewer with no seat in the round (a
// spectator) and a viewer who has not reported their hands (not started) stay
// masked. The round resolving unmasks everyone. `state` is null for a lobby with
// no PvP game, which has nothing to hide.
export function maskedFor(state: RefereeState | null, viewer: string): boolean {
	if (state === null || state.round.phase !== 'playing') return false
	const entry = state.round.players[viewer]
	if (entry === undefined || entry.handsLeft === null) return true
	if (state.facts.handRound[viewer] === state.round.roundId) return false
	return !handsDone(entry)
}
