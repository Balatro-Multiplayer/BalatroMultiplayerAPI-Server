// The round lifecycle of a refereed game (docs/pvp-match.md sections 6 and 7): a
// round resolves (the mode names the losers, the tick charges them) and the next
// one opens from a `pvp.ready` start, and the keys the life guard is kept on.
// Pure: plain state in, plain state out.
import type { StepContext } from '../../actions/registry'
import { worldOf } from './deadline'
import { chargeLife } from './lives'
import { runHook } from './modes'
import { handsDone } from './modes/common'
import type { Mode } from './modes/types'
import { facingRepinned, skipsReset } from './skips'
import { type RefereeState, withMemo } from './state'

// R10, R16, R22: the mode decides whether the round is over (it only acts in
// the 'playing' phase and leaves it, so a round resolves once) and names the
// losers in `lastResult`; the tick takes each loser's life (a team's pool once).
// That PvP loss is guarded on the loser's own Ready blindKey of the round
// (`pvpGuardKey`), so a failed round on that blind afterwards costs nothing
// more (R2).
//
// "The mode resolved the round" is read from the phase it left, never from
// `lastResult` being a new object: the runtime hands match state back through
// wrappers where two reads of one nested object are never `===`, and while
// round N+1 plays `lastResult` still names round N's losers.
export function resolveRound(
	state: RefereeState,
	mode: Mode,
	ctx: StepContext,
): RefereeState {
	if (state.round.phase !== 'playing') return state
	const ran = runHook(mode.resolveRound, state, ctx)
	if (ran.round.phase === 'playing') return ran
	// The PvP round closed: the next Ante starts from the base and the skips so far.
	const resolved = withSkipsReset(ran, mode)
	const result = resolved.round.lastResult
	if (result === null) return resolved
	let next = resolved
	for (const id of chargedLosers(next, mode, result.losers)) {
		const guardKey = pvpGuardKey(next, id)
		// A player who never started a round has no blind to lose on: no life.
		if (guardKey === null) continue
		next = chargeLife(next, mode, id, `pvp:${result.roundId}`, guardKey)
	}
	return next
}

// The skip baseline and the spent Ante time reset at a PvP round's open and close
// (skips.ts). The same state when there is nothing to reset.
// A running Ante deadline ends with the round open, and its running time is not
// charged: the reset below starts the next Ante from the base, and the deadline
// would otherwise be dropped on a later tick and charged into the new bank.
function withoutAnteDeadline(state: RefereeState): RefereeState {
	if (state.facts.deadline?.kind !== 'ante') return state
	return { ...state, facts: { ...state.facts, deadline: null } }
}

function withSkipsReset(state: RefereeState, mode: Mode): RefereeState {
	const { opponentOf } = worldOf(state, mode, [], [])
	const skips = skipsReset(state.facts.skips, opponentOf)
	return skips === state.facts.skips
		? state
		: { ...state, facts: { ...state.facts, skips } }
}

// The PvP blind a player's loss is guarded on: the key of their own Ready this
// round. A Manhunt voucher lowers a player's own ante, so it can differ from
// `<highest ante>:Boss`, and from a teammate's. `withStartKeys` records a key for
// every player who started a round it opens, so for a player of the current start
// the last entry is this round's; null for a player who is not in it (no key is
// invented, and an earlier round's key is not theirs to spend).
// In a team game the representative's key stands for the team: only Manhunt has
// the ante-lowering voucher, and Manhunt has no pool.
function pvpGuardKey(state: RefereeState, id: string): string | null {
	if (state.lastStart === null || !state.lastStart.players.includes(id))
		return null
	const keys = state.facts.pvpBlinds[id]
	if (keys === undefined || keys.length === 0) return null
	return keys[keys.length - 1]
}

// Who is charged for a lost round: each loser alone, or the ones the mode's life
// pool names (a team game: one per losing team, it loses one life, not one per member).
function chargedLosers(
	state: RefereeState,
	mode: Mode,
	losers: string[],
): string[] {
	return mode.lifePool ? mode.lifePool.payers(state, losers) : losers
}

// The tick's round open, for a `pvp.ready` start the round has not opened yet.
// One round number, the start's id (ready.ts `lastStart.roundId`, 1 at the first
// start; the client sends it on pvp.hand and pvp.hand_commit). `round.roundId`
// is 0 before the first start; the newest start always opens, and after every
// tick `round.roundId === lastStart.roundId` (or 0 with no start).
//
// Only this function writes `round.roundId`: no mode hook does (a resolve leaves
// it alone), so a mode cannot bump the id, whatever its hooks do. A start needs
// every required player Ready, so one that arrives while a round is still playing
// means everyone has left that round's blind and no more hands will come: the
// round resolves in the same tick on what the server has (resolveLeftRound), then
// the newest start opens. Starts that piled up are covered by the same rule.
// The tick closes the round (resolveLeftRound) before its Ante step, so the round
// is ranked on the pairing it was played with; by here it is no longer playing.
export function openNextRound(
	state: RefereeState,
	mode: Mode,
	ctx: StepContext,
): RefereeState {
	const start = pendingStart(state)
	if (start === null) return state
	let next = runHook((s, c) => mode.roundReady(s, c), state, ctx)
	next = withStartKeys(next, start)
	next = rearmGuards(next, start.players)
	next = withoutAnteDeadline(next)
	next = withSkipsReset(next, mode)
	return { ...next, round: { ...next.round, roundId: start.roundId } }
}

// The start the round has not opened yet, null when there is none (or the game is over).
function pendingStart(state: RefereeState): RefereeState['lastStart'] {
	const start = state.lastStart
	if (
		state.result.kind !== null ||
		start === null ||
		start.roundId <= state.round.roundId
	)
		return null
	return start
}

// A Ready proves the player left the blind, so their entry of the round that is
// still playing is spent: no more hands will come. Their reported score stands (null
// when they never sent a blind_start, which ranks below every score). The round then
// resolves like any other, so its losers lose their life before the next one opens.
// A mode that leaves it playing has no contest left: it closes with no losers.
// The same state back when no start is pending or the round is not playing.
export function resolveLeftRound(
	state: RefereeState,
	mode: Mode,
	ctx: StepContext,
): RefereeState {
	const start = pendingStart(state)
	if (start === null || state.round.phase !== 'playing') return state
	const players = { ...state.round.players }
	for (const id of start.players) {
		const entry = players[id]
		if (entry !== undefined && !handsDone(entry))
			players[id] = { ...entry, handsSpent: true }
	}
	const resolved = resolveRound(
		{ ...state, round: { ...state.round, players } },
		mode,
		ctx,
	)
	// Reachable only when no contest is left (all forfeited, Manhunt with no Runner):
	// the round closes with no losers, and the game is ending or a pending death
	// decides it. The per-mode property test proves a live contest always resolves.
	if (resolved.round.phase === 'playing')
		return {
			...resolved,
			round: {
				...resolved.round,
				phase: 'resolved',
				lastResult: { roundId: resolved.round.roundId, losers: [] },
			},
		}
	return resolved
}

// The memo `pvpBlinds` with this round's blind key appended for every player who
// started the round (`start.players`, one entry per round per player, so the last
// entry is always this round's): the player's own Ready key. tryStart (ready.ts)
// starts only players who have a key, so each starter has one here.
function withStartKeys(
	state: RefereeState,
	start: NonNullable<RefereeState['lastStart']>,
): RefereeState {
	const blinds = { ...state.facts.pvpBlinds }
	for (const id of start.players) {
		const key = start.blindKeys[id]
		// tryStart only starts players who Readied with a key: a miss is a bug.
		if (key === undefined) throw new Error(`round start without a blind key for ${id}`)
		// A player's first round has no entry in the map yet: a structural miss.
		blinds[id] = [...(blinds[id] ?? []), key]
	}
	return withMemo(state, { pvpBlinds: blinds })
}

// R2: the life guard is re-armed on every new round: the blind a
// round is played on can be lost on once more, whatever an earlier round spent
// on the same key. Takes each starter's key for the round just opened. The same
// state when nothing was spent on them.
function rearmGuards(state: RefereeState, starters: string[]): RefereeState {
	const next: { [id: string]: string[] } = { ...state.facts.guarded }
	let changed = false
	for (const id of starters) {
		const keys = state.facts.pvpBlinds[id]
		const key = keys[keys.length - 1]
		if (next[id]?.includes(key)) {
			next[id] = next[id].filter((k) => k !== key)
			changed = true
		}
	}
	return changed ? withMemo(state, { guarded: next }) : state
}

// A mode re-paired the players (onAnte): move each pinned opponent to the new
// partner, leaving the spend and the skip baseline alone.
export function withFacingRepinned(
	state: RefereeState,
	mode: Mode,
): RefereeState {
	const { opponentOf } = worldOf(state, mode, [], [])
	const skips = facingRepinned(state.facts.skips, opponentOf)
	return skips === state.facts.skips
		? state
		: { ...state, facts: { ...state.facts, skips } }
}
