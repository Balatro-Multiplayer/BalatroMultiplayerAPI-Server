// The pvp.* match state keys as projections of the lobby (docs/pvp-match.md
// section 4). Pure: each returns exactly the section 4 JSON, built fresh so no
// internal field (facts, the tick's cursor) leaks. A lobby with no PvP game
// projects the idle values, which are never null.
import type { Lobby } from '../state'
import { clockLive } from './clocks'
import {
	plainDeadline,
	projectDeadline,
	roundOpen,
	wouldTime,
	worldOf,
} from './deadline'
import { modeOfGame } from './modes'
import {
	PVP_EFFECTS_KEY,
	PVP_NEMESIS_KEY,
	PVP_OPPONENT_KEY,
	PVP_TRAPS_KEY,
} from './opponent_state'
import { PVP_ROUND_KEY, PVP_SKIPS_KEY, PVP_VOTES_KEY } from './reducer'
import { modeOfQueue } from './settings'
import { anteBankMs, entryOf } from './skips'
import {
	type ModeView,
	type PvpRoundPlayer,
	type PvpTeam,
	type RefereeState,
	emptyPvp,
	refereeOf,
} from './state'

export const PVP_RULES_KEY = 'pvp.rules'
export const PVP_LIVES_KEY = 'pvp.lives'
export const PVP_TARGETS_KEY = 'pvp.targets'
export const PVP_TEAMS_KEY = 'pvp.teams'
export const PVP_RESULT_KEY = 'pvp.result'
export const PVP_CLOCKS_KEY = 'pvp.clocks'

function stateOf(lobby: Lobby): ModeView {
	return refereeOf(lobby) ?? emptyPvp()
}

export function projectRules(lobby: Lobby): unknown {
	const r = stateOf(lobby).rules
	if (r.runId === null) return { runId: null, mode: null, startedCount: 0 }
	return {
		runId: r.runId,
		mode: r.mode,
		startedCount: r.startedCount,
		startingLives: r.startingLives,
		hunterLives: r.hunterLives,
		pvpStartAnte: r.pvpStartAnte,
		deathOnRoundLoss: r.deathOnRoundLoss,
		clocks: {
			ante: r.clocks.ante,
			pvp: r.clocks.pvp === null ? null : { ...r.clocks.pvp },
			personal: r.clocks.personal === null ? null : { ...r.clocks.personal },
		},
	}
}

export function projectRound(lobby: Lobby): unknown {
	return roundOf(lobby, true)
}

// pvp.round for a masked viewer: score and highestScore null for every player (the
// viewer's own too, which the client knows locally) and no canTime, so one payload
// serves every masked viewer.
export function projectRoundMasked(lobby: Lobby): unknown {
	return roundOf(lobby, false)
}

// Whether a PvP hand timer of `id` could be started now: the ruleset's PvP clock and
// `wouldTime` read on the state, so the client shows the button from the server's
// rule, never its own.
function canTime(lobby: Lobby, id: string): boolean {
	const state = refereeOf(lobby)
	if (state === null) return false
	if (state.rules.runId === null || state.rules.clocks.pvp === null)
		return false
	if (!roundOpen(state)) return false
	const mode = modeOfGame(state)
	if (mode === null) return false
	const world = worldOf(state, mode, [], [])
	return wouldTime('pvp', id, state, world).ok
}

// A null score is an unknown one; the masked projection hides every score the
// same way (null, not an absent key). `canTime` is only in the unmasked one: it
// would leak whether the viewer is ahead.
function roundOf(lobby: Lobby, unmasked: boolean): unknown {
	const r = stateOf(lobby).round
	const players: { [id: string]: unknown } = {}
	for (const id of Object.keys(r.players)) {
		const p = r.players[id]
		players[id] = {
			score: unmasked ? p.score : null,
			handsLeft: p.handsLeft,
			highestScore: unmasked ? p.highestScore : null,
			ante: p.ante,
			furthestBlind: p.furthestBlind,
			timerLosses: p.timerLosses,
			handsSpent: p.handsSpent,
			pvpLeftMs: p.pvpLeftMs,
			...(unmasked ? { canTime: canTime(lobby, id) } : {}),
		}
	}
	return {
		runId: r.runId,
		roundId: r.roundId,
		phase: r.phase,
		players,
		lastResult: r.lastResult
			? { roundId: r.lastResult.roundId, losers: [...r.lastResult.losers] }
			: null,
		// A STATE shows the bank frozen at the last `n`; a snapshot adds the live
		// remaining time (state.ts snapshotFor).
		deadline: projectDeadline(refereeOf(lobby)?.facts.deadline, null),
	}
}

export function projectLives(lobby: Lobby): unknown {
	const l = stateOf(lobby).lives
	const players: { [id: string]: unknown } = {}
	for (const id of Object.keys(l.players)) {
		const p = l.players[id]
		players[id] = {
			lives: p.lives,
			eliminated: p.eliminated,
			forfeited: p.forfeited,
			left: p.left,
			events: p.events.map((e) => ({ delta: e.delta, key: e.key })),
		}
	}
	return {
		runId: l.runId,
		players,
		teamLives: l.teamLives ? { A: l.teamLives.A, B: l.teamLives.B } : null,
		pending: l.pending.map((p) => ({
			playerId: p.playerId,
			blindKey: p.blindKey,
			waitsOn: [...p.waitsOn],
		})),
	}
}

export function projectTargets(lobby: Lobby): unknown {
	return targetsOf(stateOf(lobby), false)
}

// pvp.targets for a masked viewer: every score unknown, so the order of the
// opponents falls to each mode's tie-break (by id, never by score), and no team
// score.
export function projectTargetsMasked(lobby: Lobby): unknown {
	return targetsOf(stateOf(lobby), true)
}

function targetsOf(state: ModeView, scrubbed: boolean): unknown {
	const rules = state.rules
	if (rules.runId === null)
		return {
			runId: null,
			opponents: {},
			cardTargets: {},
			teamScores: null,
			safe: {},
			pairingAnte: null,
		}
	// The picked rules say who targets whom; a mode with no view has no targets.
	const view = modeOfGame(state)?.view?.(
		scrubbed ? withoutScores(state) : state,
	)
	return {
		runId: rules.runId,
		opponents: view?.opponents ?? {},
		cardTargets: view?.cardTargets ?? {},
		teamScores: scrubbed ? null : (view?.teamScores ?? null),
		safe: view?.safe ?? {},
		pairingAnte: view?.pairingAnte ?? null,
	}
}

// The state with every round score unknown.
function withoutScores(state: ModeView): ModeView {
	const players: { [id: string]: PvpRoundPlayer } = {}
	for (const [id, p] of Object.entries(state.round.players))
		players[id] = { ...p, score: null, highestScore: null }
	return { ...state, round: { ...state.round, players } }
}

// R35, R46: the teams each mode offers. Manhunt: Runner or Hunter; Teams: A or
// B; any other mode has no teams.
export const TEAMS_OF_MODE: { [mode: string]: PvpTeam[] } = {
	manhunt: ['RUNNER', 'HUNTER'],
	teams: ['A', 'B'],
}

// The lobby's picks that the lobby's current mode offers. A pick made under
// another queue mode stays stored but is not shown.
function picksOfMode(lobby: Lobby): { [userId: string]: PvpTeam } {
	const mode = modeOfQueue(lobby.metadata.queue_mode)
	const offered = mode === null ? [] : (TEAMS_OF_MODE[mode] ?? [])
	const shown: { [userId: string]: PvpTeam } = {}
	for (const [id, team] of Object.entries(lobby.teamPicks ?? {}))
		if (offered.includes(team)) shown[id] = team
	return shown
}

// R35, R46: before a run (and after it ends) the lobby's picks that the mode
// offers; during a run the settled roster.
export function projectTeams(lobby: Lobby): unknown {
	const t = stateOf(lobby).teams
	if (t.runId === null) return { runId: null, teams: picksOfMode(lobby) }
	return { runId: t.runId, teams: { ...t.teams } }
}

export function projectVotes(lobby: Lobby): unknown {
	const v = stateOf(lobby).votes
	return { runId: v.runId, draw: [...v.draw], seed: [...v.seed] }
}

export function projectResult(lobby: Lobby): unknown {
	const r = stateOf(lobby).result
	return {
		runId: r.runId,
		kind: r.kind,
		winnerId: r.winnerId,
		winnerTeam: r.winnerTeam,
		places: r.places.map((p) => ({ playerId: p.playerId, place: p.place })),
	}
}

// pvp.skips: each seated player's reported skip total (null until their first
// pvp.skip) and Ante bank. The bank is frozen while the player's own server-counted
// deadline runs: the clients show the running time from pvp.round.deadline.
export function projectSkips(lobby: Lobby): unknown {
	const state = refereeOf(lobby)
	if (state === null || state.rules.runId === null)
		return { runId: null, players: {} }
	const mode = modeOfGame(state)
	if (mode === null) return { runId: null, players: {} }
	const world = worldOf(state, mode, [], [])
	// The starter of a running server-counted deadline shows the bank frozen when
	// that deadline last changed (`shownMs`); the client counts the time from
	// pvp.round.deadline.
	const running = plainDeadline(state.facts.deadline)
	const players: { [id: string]: unknown } = {}
	for (const id of Object.keys(state.lives.players))
		players[id] = {
			skips: entryOf(state.facts.skips, id).skips,
			anteBankMs:
				running?.by === id && running.shownMs !== null
					? running.shownMs
					: anteBankMs(state.rules, state.facts.skips, id, world.opponentOf),
		}
	return { runId: state.rules.runId, players }
}

// pvp.clocks: each clock holder's personal clock, on a personal-clock ruleset only
// (absent otherwise). A STATE shows `ms` as of the last `n` change, so a push goes
// out only when an `n` changes; a snapshot adds the live value (withLiveClocks).
// `since` and `graceUntil` are the server's and never leave it.
function projectClocks(lobby: Lobby): unknown {
	const state = refereeOf(lobby)
	if (
		state === null ||
		state.rules.runId === null ||
		state.rules.clocks.personal === null
	)
		return undefined
	return clocksShown(state.facts.clocks, null)
}

function clocksShown(
	clocks: RefereeState['facts']['clocks'],
	now: number | null,
): { [id: string]: unknown } {
	const players: { [id: string]: unknown } = {}
	for (const id of Object.keys(clocks)) {
		const c = clocks[id]
		players[id] = {
			ms: now === null ? c.ms : clockLive(c, now),
			running: c.running,
			rate: c.rate,
			n: c.n,
			spent: c.spent,
		}
	}
	return players
}

// A snapshot's match state with the live value of every personal clock; the same
// object when the game has no personal clocks.
export function withLiveClocks(
	match: { [key: string]: unknown },
	state: RefereeState | null,
	now: number,
): { [key: string]: unknown } {
	if (state === null || match[PVP_CLOCKS_KEY] === undefined) return match
	return { ...match, [PVP_CLOCKS_KEY]: clocksShown(state.facts.clocks, now) }
}

// pvp.opponent: what each player reported of their shop (sells per ante, the blind
// slots they passed, whether their shop is closed). Lobby-wide.
export function projectOpponent(lobby: Lobby): unknown {
	const state = refereeOf(lobby)
	if (state === null || state.rules.runId === null)
		return { runId: null, players: {} }
	const players: { [id: string]: unknown } = {}
	const recorded = state.facts.opponent.players
	for (const id of Object.keys(recorded)) {
		const p = recorded[id]
		players[id] = {
			sells: { ...p.sells },
			slots: p.slots.map((slot) => ({ ...slot })),
			closed: p.closed,
		}
	}
	return { runId: state.rules.runId, players }
}

// pvp.traps: every trap in play, lobby-wide.
export function projectTraps(lobby: Lobby): unknown {
	const state = refereeOf(lobby)
	if (state === null || state.rules.runId === null)
		return { runId: null, trapSeq: 0, traps: [] }
	const traps = state.facts.traps
	return {
		runId: state.rules.runId,
		trapSeq: traps.trapSeq,
		traps: traps.traps.map((t) => ({
			id: t.id,
			key: t.key,
			owner: t.owner,
			holder: t.holder,
			state: t.state,
		})),
	}
}

// What the viewer is sent of pvp.nemesis: their own frozen rows only (a masked
// Royale viewer never learns another player's target). Null for a seat that is
// not in the run, and before the rules freeze.
export function projectNemesisFor(lobby: Lobby, viewer: string): unknown {
	const state = refereeOf(lobby)
	if (state === null || state.rules.runId === null)
		return { runId: null, byAnte: null }
	const mine = state.facts.nemesis[viewer]
	return {
		runId: state.rules.runId,
		byAnte: mine === undefined ? null : { ...mine },
	}
}

// What the viewer is sent of pvp.effects: the effects aimed at them.
export function projectEffectsFor(lobby: Lobby, viewer: string): unknown {
	const state = refereeOf(lobby)
	if (state === null || state.rules.runId === null)
		return { runId: null, me: null }
	const mine = state.facts.effects.players[viewer]
	if (mine === undefined) return { runId: state.rules.runId, me: null }
	return {
		runId: state.rules.runId,
		me: { incoming: mine.incoming.map((e) => ({ ...e })) },
	}
}

// The detection projections of the two per-viewer keys: the whole record, used
// only to tell that the key changed (changedKeys, announceDrift, the tick), never
// sent.
function detectNemesis(lobby: Lobby): unknown {
	const state = refereeOf(lobby)
	if (state === null || state.rules.runId === null) return { runId: null }
	return { runId: state.rules.runId, nemesis: state.facts.nemesis }
}

function detectEffects(lobby: Lobby): unknown {
	const state = refereeOf(lobby)
	if (state === null || state.rules.runId === null) return { runId: null }
	return { runId: state.rules.runId, effects: state.facts.effects.players }
}

// The keys that are sent per viewer, each with what one viewer receives.
export const VIEWER_PROJECTIONS: {
	[key: string]: (lobby: Lobby, viewer: string) => unknown
} = {
	[PVP_NEMESIS_KEY]: projectNemesisFor,
	[PVP_EFFECTS_KEY]: projectEffectsFor,
}

// The masked variant of each key that carries a score, shown to a masked viewer.
export const MASKED_PROJECTIONS: {
	[key: string]: (lobby: Lobby) => unknown
} = {
	[PVP_ROUND_KEY]: projectRoundMasked,
	[PVP_TARGETS_KEY]: projectTargetsMasked,
}

// Every refereed key with its projection; pvp.ready stays in ready.ts.
export const PVP_PROJECTIONS: {
	[key: string]: (lobby: Lobby) => unknown
} = {
	[PVP_RULES_KEY]: projectRules,
	[PVP_ROUND_KEY]: projectRound,
	[PVP_LIVES_KEY]: projectLives,
	[PVP_TARGETS_KEY]: projectTargets,
	[PVP_TEAMS_KEY]: projectTeams,
	[PVP_VOTES_KEY]: projectVotes,
	[PVP_RESULT_KEY]: projectResult,
	[PVP_SKIPS_KEY]: projectSkips,
	[PVP_CLOCKS_KEY]: projectClocks,
	[PVP_OPPONENT_KEY]: projectOpponent,
	[PVP_TRAPS_KEY]: projectTraps,
	[PVP_NEMESIS_KEY]: detectNemesis,
	[PVP_EFFECTS_KEY]: detectEffects,
}

// The recorded facts each opponent key is projected from, for the keys whose
// records grow with the run. Reducers return a new object only for a fact they
// change, so a key whose sources are the same objects in two lobbies is unchanged
// and `changedKeys` need not project it.
const sourcesOf = (
	lobby: Lobby,
	pick: (state: RefereeState) => unknown[],
): unknown[] => {
	const state = refereeOf(lobby)
	return state === null ? [null] : [state.rules.runId, ...pick(state)]
}

export const PVP_SOURCES: {
	[key: string]: (lobby: Lobby) => unknown[]
} = {
	[PVP_OPPONENT_KEY]: (l) => sourcesOf(l, (s) => [s.facts.opponent]),
	[PVP_TRAPS_KEY]: (l) => sourcesOf(l, (s) => [s.facts.traps]),
	[PVP_NEMESIS_KEY]: (l) => sourcesOf(l, (s) => [s.facts.nemesis]),
	[PVP_EFFECTS_KEY]: (l) => sourcesOf(l, (s) => [s.facts.effects]),
}
