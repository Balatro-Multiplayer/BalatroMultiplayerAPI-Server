// Picks the mode a refereed game plays (docs/pvp-match.md section 2). The
// modes fill in the hooks, not this table.
import type { StepContext } from '../../../actions/registry'
import {
	type ModeView,
	type PvpMode,
	type RefereeState,
	withView,
} from '../state'
import { aliveIds, seatedIds } from './common'
import { duelMode, duelOpponents } from './duel'
import { manhuntMode } from './manhunt'
import { nemesisMode } from './nemesis'
import { royaleMode } from './royale'
import { teamsMode } from './teams'
import type { Hook, Mode } from './types'

export type { Hook, Mode, ModeName } from './types'

// A hook may return the referee state without the facts: keep them.
export function runHook(
	hook: Hook,
	state: RefereeState,
	ctx: StepContext,
): RefereeState {
	const out = hook(state, ctx)
	return out === state ? state : withView(state, out)
}

// The round rules of the last two: a game that started with 3+ players keeps its own
// death, hands and win rules but plays the 1v1 round and targets once exactly two
// started seats are still seated (R55). A player who is out but still seated counts.
const finalTwo = (mode: Mode): Mode => ({
	...mode,
	finalTwo: true,
	resolveRound: duelMode.resolveRound,
	view: (state) => ({ opponents: duelOpponents(state, aliveIds(state)) }),
})
const royaleFinalTwo = finalTwo(royaleMode)
const nemesisFinalTwo = finalTwo(nemesisMode)

// Manhunt and Teams play their own rules; otherwise exactly two players duel
// (ranked is Nemesis with two); Nemesis with more plays the pairing rules;
// Royale with more play Royale (rank-and-cut down to two alive). The
// one place that decides it: the 3+ game with two alive, seated players left plays
// the round rules of a duel. `seatedCount` (the started seats that have not left)
// defaults to the started count.
export function pickMode(
	mode: PvpMode,
	startedCount: number,
	seatedCount: number = startedCount,
): Mode {
	if (mode === 'manhunt') return manhuntMode
	if (mode === 'teams') return teamsMode
	if (startedCount === 2) return duelMode
	if (mode === 'nemesis') return seatedCount === 2 ? nemesisFinalTwo : nemesisMode
	return seatedCount === 2 ? royaleFinalTwo : royaleMode
}

// The mode a running game plays now, from the rules frozen at its start and the
// players still seated; null while the rules are not frozen (no game is running).
export function modeOfGame(state: ModeView): Mode | null {
	const { rules } = state
	if (rules.runId === null) return null
	return pickMode(rules.mode, rules.startedCount, seatedIds(state).length)
}
