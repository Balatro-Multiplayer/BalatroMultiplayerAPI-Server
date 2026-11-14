// The pure tick driver of the server-refereed PvP game (docs/pvp-match.md sections 2
// and 7). `pvpTick` reads the lobby, runs the pure `decide` (tick.ts) on its referee
// state, writes the result back, sends the STATE before GAME_ENDED, and says what ends
// the game. The three ways a game ends (finish it, restart it, tell a dodge from a
// plain leave) are passed in as `TickEnds`: referee.ts supplies the real ones, so this
// file imports nothing of the match loop. `placementsOf` turns a decided state into the
// game's placements.
import type { StepContext } from '../../actions/registry'
import type { FinishOverride } from '../../actions/results'
import { announceChange, changedKeys } from '../match_state'
import type { Placement } from '../protocol'
import type { Lobby, Outbound, Step } from '../state'
import { awayBeforeRunOf, freezeEnvOf } from './freeze_env'
import { pickMode } from './modes'
import { pvpOf, readyIdsOf, requiredIds, startIfReady } from './ready'
import { type RefereeState, refereeOf, withReferee } from './state'
import { type ModeFor, decide } from './tick'

// How a decided tick ends the game. The shell (referee.ts) owns the real ones.
export interface TickEnds {
	// The game stored and GAME_ENDED sent (actions/results finishGame).
	finish(lobby: Lobby, now: number, override?: FinishOverride): Step
	// The next game on a new seed, or null when there is no game to restart.
	restart(lobby: Lobby, ctx: StepContext): Step | null
	// Whether a seat leaving now ends the game as a dodge (dodge.ts endsAsDodge).
	endsAsDodge(lobby: Lobby): boolean
}

// For a test whose tick ends no game: reaching an end is a bug in the test, so it is
// loud. `ends` has no default, so production code cannot forget it; referee.ts
// `pvpTick` is the one that can end a game.
export const NO_ENDS: TickEnds = {
	finish() {
		throw new Error('this tick ends the game: use referee.pvpTick')
	},
	restart() {
		throw new Error('this tick restarts the game: use referee.pvpTick')
	},
	endsAsDodge() {
		throw new Error('this tick ends the game: use referee.pvpTick')
	},
}

// A metric is a whole number up to this (R15).
const METRIC_CAP = 1e15

// metric and metricText of a placement: the player's best PvP score, capped at
// 1e15 (R15; comma text, a score past a double, is the cap).
function metricOf(text: string): number {
	if (text.includes(',')) return METRIC_CAP
	const n = Number(text)
	return Math.round(Math.min(n, METRIC_CAP))
}

// PVP.build_placements: the winner (or a team's members) place 1, everyone else
// 2, a draw everyone 1; performance 1 only for a sole winner.
export function placementsOf(
	state: RefereeState,
	playerIds: string[],
): Placement[] {
	const placeOf: { [id: string]: number } = {}
	for (const p of state.result.places) placeOf[p.playerId] = p.place
	const tiedFirst = playerIds.filter((id) => placeOf[id] === 1).length
	return playerIds.map((id) => {
		const place = placeOf[id]
		if (place === undefined) throw new Error(`no place for ${id}`)
		const entry = state.round.players[id]
		// A player who never reported a score has no metric: unknown is not 0, so it
		// never ties a player who scored 0 and never moves a season best.
		const best = entry === undefined ? null : entry.highestScore
		const performance = place === 1 && tiedFirst === 1 ? 1 : 0
		if (best === null) return { playerId: id, place, performance }
		return {
			playerId: id,
			place,
			performance,
			metric: metricOf(best),
			metricText: best,
		}
	})
}

// R31: when the tick put a player out of the run, the others may have been
// waiting on their Ready only: the round starts now if they are all ready.
function readyAfterOut(before: Lobby, after: Lobby): Lobby {
	if (!pvpOf(before)) return after
	const still = new Set(requiredIds(after))
	const left = requiredIds(before).filter((id) => !still.has(id))
	if (left.length === 0) return after
	return startIfReady(after, left)
}

// The driver: the lobby's referee state through `decide`, the change announced
// (the STATE with pvp.result goes out before GAME_ENDED), and the game finished
// or restarted when it is decided. Nothing happens in a lobby with no PvP game.
// A contested game of two is finished with no placements (`decide` says so).
export function pvpTick(
	lobby: Lobby,
	ctx: StepContext,
	ends: TickEnds,
	modeFor: ModeFor = pickMode,
): Step {
	const state = refereeOf(lobby)
	const started = lobby.game.started
	const ready = pvpOf(lobby)
	if (!state || !started || !ready) return { lobby, out: [] }
	const freezeEnv = freezeEnvOf(lobby)
	if (freezeEnv === null) return { lobby, out: [] }
	const outcome = decide(
		state,
		{
			...freezeEnv,
			seatedIds: lobby.players.map((p) => p.id),
			raceStarted: started.raceStartedAt !== undefined,
			// A restarted run has no dodge window: a pre-run leave is a forfeit there.
			firstRun: started.restarted !== true,
			readyIds: readyIdsOf(ready),
			readiedIds: ready.readied,
			requiredIds: requiredIds(lobby),
			awayIds: lobby.players
				.filter((p) => p.awaySince !== null)
				.map((p) => p.id),
			contested: !!lobby.game.contest,
			ranked: lobby.rankedMode !== undefined,
			awayBeforeRun: awayBeforeRunOf(lobby),
		},
		ctx,
		modeFor,
	)
	if (outcome.end?.kind === 'contested') return ends.finish(lobby, ctx.now)
	// A leave before the run began in a ranked 2-player game: stored dodged, nobody rated,
	// and the dodge recorded for the penalty (a follow-up).
	// `decide` alone owns this: its conditions (ranked, two started players, no replay event
	// yet, no contest, no decided result) are the ones endsAsDodge mirrors for the
	// grace-expiry path in state.ts, so no second check is made here.
	if (outcome.end?.kind === 'dodged' && lobby.rankedMode !== undefined) {
		const finished = ends.finish(lobby, ctx.now, {
			status: 'dodged',
			announce: true,
		})
		const dodge: Outbound = {
			kind: 'dodged',
			leaverId: outcome.end.leaverId,
			runId: started.runId,
			at: ctx.now,
			rankedMode: lobby.rankedMode,
		}
		return { lobby: finished.lobby, out: [dodge, ...finished.out] }
	}
	// Every started player gone before the run began: abandoned, unrated; a ranked game
	// of two records a dodge for each. A larger ranked lobby (only a hand-made one) keeps
	// the forfeits state.ts stored, since endsAsDodge is false for it.
	if (outcome.end?.kind === 'bothGone') {
		const finished = ends.finish(lobby, ctx.now, {
			status: 'abandoned',
			announce: true,
		})
		const rankedMode = lobby.rankedMode
		const dodges: Outbound[] =
			rankedMode === undefined || !ends.endsAsDodge(lobby)
				? []
				: outcome.end.leaverIds.map((leaverId) => ({
						kind: 'dodged',
						leaverId,
						runId: started.runId,
						at: ctx.now,
						rankedMode,
					}))
		return { lobby: finished.lobby, out: [...dodges, ...finished.out] }
	}
	// Every player of a ranked run forfeited or left (none died): abandoned, unrated
	// (rating/apply.ts rates only agreed or partial). The referee's draw is discarded:
	// no pvp.result STATE goes out, only GAME_ENDED abandoned with no placements.
	if (outcome.end?.kind === 'forfeited')
		return ends.finish(lobby, ctx.now, { status: 'abandoned', announce: true })
	// Settings that do not validate at the freeze: the game cannot be refereed. The
	// metadata guard and the start refuse every such key, so this is loud when it fires.
	if (outcome.end?.kind === 'unrefereeable') {
		const finished = ends.finish(lobby, ctx.now, {
			status: 'abandoned',
			announce: true,
		})
		const message = `run ${started.runId} is unrefereeable: bad_rules ${outcome.end.key}`
		return {
			lobby: finished.lobby,
			out: [{ kind: 'log', message }, ...finished.out],
		}
	}
	const next = readyAfterOut(
		lobby,
		outcome.state === state ? lobby : withReferee(lobby, outcome.state),
	)

	// A passed seed vote starts the next game: the reset is announced as the
	// drift of the new game, so nothing is announced from here.
	if (outcome.end?.kind === 'restart') {
		const restarted = ends.restart(next, ctx)
		if (restarted) return restarted
	}

	const announced = announceChange(next, changedKeys(lobby, next), lobby)
	// A finish announces the decided state (the result) and then resets the game to
	// idle without announcing that reset: a client keeps the final pvp.* values
	// (docs/pvp-match.md section 7). The next game's start announces its own.
	if (outcome.end?.kind === 'finish') {
		const finished = ends.finish(announced.lobby, ctx.now, {
			status: 'agreed',
			announce: true,
			placements: placementsOf(
				outcome.state,
				started.players.map((p) => p.id),
			),
		})
		return { lobby: finished.lobby, out: [...announced.out, ...finished.out] }
	}
	return announced
}
