// The types of a request reducer, in a leaf module so the PvP referee can name them
// without importing requests.ts (which imports the referee). Types only: no runtime.
import type { StepContext } from '../actions/registry'
import type { Lobby } from './state'

export type KeyProjection = (lobby: Lobby) => unknown

export type Reduction =
	| {
			ok: true
			lobby: Lobby
			// The match keys this request changed; none: nothing changed, so no rev
			// bump and no STATE.
			changed: string[]
			// A refusal the reducer recorded: the state above stays and is announced,
			// and the answer is `ok: false` with `reason`. `detail` is for the log
			// only, never sent.
			refusal?: { reason: string; detail?: string }
	  }
	// `key`: the rule key a bad_rules refusal names.
	| { ok: false; reason: string; key?: string }

export interface Reducer {
	// The match keys this reducer owns, each with its projection of the lobby.
	keys: { [key: string]: KeyProjection }
	reduce: (
		lobby: Lobby,
		senderId: string,
		payload: unknown,
		ctx: StepContext,
	) => Reduction
}
