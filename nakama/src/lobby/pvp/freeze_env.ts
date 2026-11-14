// The request shell's side of the freeze (docs/pvp-match.md section 4): reads the
// lobby into the plain values `freezeIfNeeded` (tick.ts) takes. The tick builds the
// same values in referee.ts; the two callers freeze from one source, lobby.metadata.
import type { StepContext } from '../../actions/registry'
import { PVP_MOD_ID } from '../../standing/pvp_version'
import type { Lobby } from '../state'
import { type RefereeState, refereeOf } from './state'
import { type FreezeEnv, freezeIfNeeded } from './tick'

// Null when no game is started.
export function freezeEnvOf(lobby: Lobby): FreezeEnv | null {
	const started = lobby.game.started
	if (!started) return null
	return {
		runId: started.runId,
		startedIds: started.players.map((p) => p.id),
		metadata: lobby.metadata,
		picks: lobby.teamPicks ?? {},
		teamPlan: lobby.teamPlan ?? null,
	}
}

// `state` frozen for the lobby's started game: the same state back when it already is.
export function frozenState(
	lobby: Lobby,
	state: RefereeState,
	ctx: StepContext,
):
	| { ok: true; state: RefereeState }
	| { ok: false; reason: 'bad_rules'; key: string } {
	const env = freezeEnvOf(lobby)
	if (env === null) return { ok: true, state }
	return freezeIfNeeded(state, env, ctx)
}

// The rules of the started game are frozen (by a request or by the tick).
export function runFrozen(lobby: Lobby): boolean {
	const started = lobby.game.started
	const state = refereeOf(lobby)
	return !!started && !!state && state.rules.runId === started.runId
}

// PvP's ruleset vote step id (pvp_api/setup.lua S.Step.RULESET).
const RULESET_STEP = 'ruleset'

// Setup is not over, so the race cannot have begun: the server owns "Setup finished"
// (docs/pvp-match.md section 4). True while a step is open; in a ranked game of two
// (always a Draft, ranked_pin.ts) until the Draft result exists, which covers the time
// before the host opens it and the reveal between steps; in a casual PvP game while a
// closed ruleset vote is not yet written to the metadata (the host publishes it after the
// reveal, and a freeze before that would pin the pre-vote ruleset). No client message
// moves it: only a step the server closed does. Nothing here after the race began.
export function setupPending(lobby: Lobby): boolean {
	const started = lobby.game.started
	if (!started) return false
	const setup = lobby.game.setup
	if (setup?.open) return true
	if (lobby.modId !== PVP_MOD_ID) return false
	const results = Object.values(setup?.results ?? {})
	if (lobby.rankedMode !== undefined)
		return started.players.length === 2 && !results.some((r) => r.kind === 'draft')
	const vote = setup?.results[RULESET_STEP]
	return vote?.kind === 'vote' && lobby.metadata.ruleset !== `ruleset_mp_${vote.option}`
}

// The started seats of a ranked game of two that were away when the race began
// (docs/pvp-match.md section 7): `awaySince` at or before `raceStartedAt`, the first
// replay event. That is the one check point: the race cannot begin before Setup is
// finished (setupPending, used by registry.ts appendLogEvent), so a seat that is away
// through the Draft is away at the stamp. A seat that came back before the stamp is not listed; a disconnect after the
// stamp is the grace's business (a forfeit). Empty before the race began, for a casual
// game, a game of more seats, a contested game, and a restarted run (the dodge window is
// the first run's only).
export function awayBeforeRunOf(lobby: Lobby): string[] {
	const started = lobby.game.started
	if (lobby.rankedMode === undefined || !started || lobby.game.contest) return []
	if (started.players.length !== 2 || started.restarted) return []
	const racedAt = started.raceStartedAt
	if (racedAt === undefined) return []
	return lobby.players
		.filter(
			(p) =>
				started.players.some((s) => s.id === p.id) &&
				p.awaySince !== null &&
				p.awaySince <= racedAt,
		)
		.map((p) => p.id)
}
