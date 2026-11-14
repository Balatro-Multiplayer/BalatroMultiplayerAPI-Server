// The referee's shell: the part of the server-refereed PvP game that talks to the
// match loop (docs/pvp-match.md sections 2 and 7). The pure driver (`pvpTick`,
// `placementsOf`) lives in pvp_tick.ts; this file binds it to the real ways a game
// ends: `finishGame`, the seed-vote restart, and the dodge test.
import { type StepContext, restartedGame } from '../../actions/registry'
import { finishGame } from '../../actions/results'
import {
	type ActionEnvelope,
	BROADCAST_TARGET,
	SERVER_TARGET,
	ServerOp,
} from '../protocol'
import type { Lobby, Outbound, Step } from '../state'
import { endsAsDodge } from './dodge'
import { pickMode } from './modes'
import { type TickEnds, pvpTick as tick } from './pvp_tick'
import type { ModeFor } from './tick'

function restartOut(lobby: Lobby, ctx: StepContext): Step | null {
	const restarted = restartedGame(lobby, ctx)
	if (!restarted) return null
	const envelope: ActionEnvelope = {
		cid: '',
		action: 'mpapi_restart_game',
		from: SERVER_TARGET,
		to: BROADCAST_TARGET,
		params: restarted.params,
	}
	const next = { ...lobby, game: restarted.game }
	const out: Outbound[] = [
		{
			kind: 'send',
			op: ServerOp.ACTION,
			payload: envelope,
			to: next.players.map((p) => p.id),
		},
		...restarted.out,
	]
	return { lobby: next, out }
}

const REAL_ENDS: TickEnds = {
	finish: finishGame,
	restart: restartOut,
	endsAsDodge,
}

// The shell: pvp_tick's pvpTick with the real ends.
export function pvpTick(
	lobby: Lobby,
	ctx: StepContext,
	modeFor: ModeFor = pickMode,
): Step {
	return tick(lobby, ctx, REAL_ENDS, modeFor)
}
