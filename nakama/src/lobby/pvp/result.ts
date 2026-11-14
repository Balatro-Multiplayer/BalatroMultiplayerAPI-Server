// A decided game's result: the places of a duel or Royale (`resultOf`,
// `withResult`) and of a team game (`teamResultOf`, `withTeamResult`). Pure.
import type { ModeView, PvpResult, PvpTeam, RefereeState } from './state'

// The result as a decided state: places filled in when the writer left them out.
export function resultOf(
	state: RefereeState,
	kind: 'win' | 'draw',
	winnerId: string | null,
): PvpResult {
	return {
		runId: state.rules.runId,
		kind,
		winnerId: kind === 'win' ? winnerId : null,
		winnerTeam: null,
		places: Object.keys(state.lives.players)
			.sort()
			.map((id) => ({
				playerId: id,
				place: kind === 'draw' || id === winnerId ? 1 : 2,
			})),
	}
}

export function withResult(
	state: RefereeState,
	kind: 'win' | 'draw',
	winnerId: string | null,
): RefereeState {
	if (state.result.kind !== null) return state
	return { ...state, result: resultOf(state, kind, winnerId) }
}

// A team result (Manhunt, Teams): no winnerId, the winning team instead. Every
// seat of the winning team is place 1, everyone else place 2; a draw puts
// everyone at place 1. A seat with no team entry places 2 on a win. Places come in
// id order (resultOf too). A mode hook passes the state type it was given.
export function teamResultOf(
	state: ModeView,
	kind: 'win' | 'draw',
	winnerTeam: PvpTeam | null,
): PvpResult {
	return {
		runId: state.rules.runId,
		kind,
		winnerId: null,
		winnerTeam: kind === 'win' ? winnerTeam : null,
		places: Object.keys(state.lives.players)
			.sort()
			.map((id) => ({
				playerId: id,
				place: kind === 'draw' || state.teams.teams[id] === winnerTeam ? 1 : 2,
			})),
	}
}

export function withTeamResult<S extends ModeView>(
	state: S,
	kind: 'win' | 'draw',
	winnerTeam: PvpTeam | null,
): S {
	if (state.result.kind !== null) return state
	return { ...state, result: teamResultOf(state, kind, winnerTeam) }
}
