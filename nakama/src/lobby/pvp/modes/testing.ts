// A test helper: a mode that changes nothing but keeps the death, hands and life
// pool choices of the real mode of that name, so a test can drive the shared code
// (deaths.ts, lives.ts) with its own hooks spread over it.
import { duelMode } from './duel'
import { manhuntMode } from './manhunt'
import { nemesisMode } from './nemesis'
import { royaleMode } from './royale'
import { teamsMode } from './teams'
import type { Hook, Mode, ModeName } from './types'

const keep: Hook = (state) => state

const MODES: { [name in ModeName]: Mode } = {
	duel: duelMode,
	royale: royaleMode,
	nemesis: nemesisMode,
	manhunt: manhuntMode,
	teams: teamsMode,
}

export function inertMode(name: ModeName): Mode {
	const { deathPolicy, opensSideDeath, outOfHandsOnFail, lifePool } =
		MODES[name]
	return {
		name,
		deathPolicy,
		opensSideDeath,
		outOfHandsOnFail,
		lifePool,
		init: keep,
		roundReady: keep,
		resolveRound: keep,
		checkWinner: keep,
		onForfeit: keep,
	}
}
