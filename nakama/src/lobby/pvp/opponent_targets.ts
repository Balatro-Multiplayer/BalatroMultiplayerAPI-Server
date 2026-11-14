// Who an effect hits: each player's targets are resolved from
// the mode's own view, frozen per ante, and every recorded effect reads the frozen
// row. Pure: plain state in, plain state out. The resolve always runs on the
// unmasked state (masking is a projection in view.ts, never an input here).
import { modeOfGame } from './modes'
import { inRunWithLives } from './modes/common'
import type { TargetsView } from './modes/types'
import {
	type NemesisRow,
	type OpponentState,
	PVP_NEMESIS_KEY,
} from './opponent_state'
import { type Refusal, refuse } from './reducer'
import type { RefereeState } from './state'

const emptyRow = (): NemesisRow => ({ each: [], one: null })

const isEmpty = (row: NemesisRow): boolean =>
	row.each.length === 0 && row.one === null

const isAlive = (state: RefereeState, id: string): boolean => {
	const seat = state.lives.players[id]
	return seat !== undefined && inRunWithLives(seat)
}

// Never the actor, never a player who is out, never a teammate.
function targetable(state: RefereeState, actor: string, id: string): boolean {
	if (id === actor || !isAlive(state, id)) return false
	const mine = state.teams.teams[actor]
	return mine === undefined || state.teams.teams[id] !== mine
}

const unique = (ids: string[]): string[] => [...new Set(ids)]

// The mode's view of the whole game, computed once per tick and shared by every
// actor's resolve. Null when the rules are not frozen or the mode has no targets.
type ViewOf = TargetsView | null

export function viewOf(state: RefereeState): ViewOf {
	const mode = modeOfGame(state)
	if (mode === null || mode.view === undefined) return null
	return mode.view(state)
}

// The actor's targets now, by the mode's rule. A game whose rules
// are not frozen, or a mode with no targets, resolves to nobody. `view` is the
// mode's view of `state` when the caller already has it.
export function resolveTargets(
	state: RefereeState,
	actor: string,
	view: ViewOf = viewOf(state),
): NemesisRow {
	const mode = modeOfGame(state)
	if (mode === null || view === null) return emptyRow()
	let each: string[]
	let one: string | null
	if (mode.name === 'teams') {
		// A card target: null before the first draw.
		one = view.cardTargets?.[actor] ?? null
		each = one === null ? [] : [one]
	} else if (mode.name === 'manhunt' && state.teams.teams[actor] === 'RUNNER') {
		// The Runner's effects hit every alive Hunter; its one opponent is the
		// server's reduced Hunter.
		one = view.opponents[actor] ?? null
		each = Object.keys(state.teams.teams)
			.filter((id) => state.teams.teams[id] === 'HUNTER')
			.sort()
	} else {
		one = view.opponents[actor] ?? null
		each = one === null ? [] : [one]
	}
	return {
		each: unique(each).filter((id) => targetable(state, actor, id)),
		one: one !== null && targetable(state, actor, one) ? one : null,
	}
}

// Writes the rows the tick owes: for every seeded actor with a known ante, the
// current ante's row once its resolve is non-empty. An empty resolve is not frozen
// while the ante is current (the pairing can arrive later in it); once the server
// ante moves up from an ante the tick saw the actor on that has no row, that ante
// is frozen as the known empty row (a bye). An ante the server never saw stays
// unrecorded (unknown). A frozen row never changes. `changed` reports pvp.nemesis
// only: the last seen ante is server bookkeeping and is never published. The
// mode's view is computed at most once, and only when an actor needs a resolve.
export function freezeNemesis(state: OpponentState): {
	state: OpponentState
	changed: boolean
} {
	let nemesis = state.facts.nemesis
	let server = state.facts.server
	let view: ViewOf | undefined
	for (const actor of Object.keys(state.facts.nemesis)) {
		const ante = state.round.players[actor]?.ante ?? null
		if (ante === null) continue
		const seen = server.players[actor]?.seenAnte ?? null
		const mine = server.players[actor]
		const mineRows = nemesis[actor]
		const byeAnte = seen !== null && ante > seen && mineRows[seen] === undefined
		const needsRow = mineRows[ante] === undefined
		if (byeAnte || needsRow) {
			const rows = { ...mineRows }
			let wrote = false
			if (byeAnte && seen !== null) {
				rows[seen] = emptyRow()
				wrote = true
			}
			if (needsRow) {
				if (view === undefined) view = viewOf(state)
				const row = resolveTargets(state, actor, view)
				if (!isEmpty(row)) {
					rows[ante] = row
					wrote = true
				}
			}
			if (wrote) nemesis = { ...nemesis, [actor]: rows }
		}
		if (mine !== undefined && mine.seenAnte !== ante)
			server = {
				...server,
				players: { ...server.players, [actor]: { ...mine, seenAnte: ante } },
			}
	}
	if (nemesis === state.facts.nemesis && server === state.facts.server)
		return { state, changed: false }
	return {
		state: { ...state, facts: { ...state.facts, nemesis, server } },
		changed: nemesis !== state.facts.nemesis,
	}
}

export type RecordedTargets =
	| { ok: true; state: OpponentState; targets: string[]; changed: string[] }
	| Refusal

// The row of `id` for `ante`: the frozen one, else a fresh resolve, which is frozen
// when it is non-empty (the same rule as the tick's freeze).
function rowAt(
	state: OpponentState,
	id: string,
	ante: number,
): { row: NemesisRow; state: OpponentState; changed: string[] } {
	const frozen = state.facts.nemesis[id]?.[ante]
	if (frozen !== undefined) return { row: frozen, state, changed: [] }
	const row = resolveTargets(state, id)
	if (isEmpty(row)) return { row, state, changed: [] }
	return {
		row,
		state: {
			...state,
			facts: {
				...state.facts,
				nemesis: {
					...state.facts.nemesis,
					[id]: { ...state.facts.nemesis[id], [ante]: row },
				},
			},
		},
		changed: [PVP_NEMESIS_KEY],
	}
}

// The targets an effect of `actor` is recorded against, alive players only. `each`
// and `one` read the row frozen for the actor's server ante. `all` is every other
// alive player now, a teammate too, and reads no row. `targeting` is every alive
// player whose own row, frozen for that player's own ante, has the actor as its one
// opponent (the players the actor is the target of). Rows are never written for a
// receiver: one not frozen yet is a fresh resolve. In the final two the mode's view
// decides. The actor's own row is frozen by this call when it is non-empty. An actor
// with no ante is refused `no_progress`. An empty result is a fact, not a refusal:
// the effect is recorded against nobody.
export function recordTargets(
	state: OpponentState,
	actor: string,
	fan: 'each' | 'one' | 'all' | 'targeting',
): RecordedTargets {
	const ante = state.round.players[actor]?.ante ?? null
	if (ante === null) return refuse('no_progress')
	if (fan === 'all') {
		const targets = Object.keys(state.lives.players)
			.filter((id) => id !== actor && isAlive(state, id))
			.sort()
		return { ok: true, state, targets, changed: [] }
	}
	if (fan === 'targeting') {
		// Only the actor's own row is frozen by this call. A receiver's row is read at
		// the receiver's own ante and never written; one not frozen yet is resolved
		// fresh. In the final two the view's opponent decides, not a frozen row.
		const own = rowAt(state, actor, ante)
		const finalTwo = modeOfGame(state)?.finalTwo === true
		const view = viewOf(state)
		const targets = Object.keys(state.lives.players)
			.sort()
			.filter((id) => {
				if (id === actor || !isAlive(state, id)) return false
				if (finalTwo) return resolveTargets(state, id, view).one === actor
				const theirs = state.round.players[id]?.ante ?? null
				if (theirs === null) return false
				const row =
					state.facts.nemesis[id]?.[theirs] ?? resolveTargets(state, id, view)
				return row.one === actor
			})
		return { ok: true, state: own.state, targets, changed: own.changed }
	}
	const at = rowAt(state, actor, ante)
	const picked =
		fan === 'one' ? (at.row.one === null ? [] : [at.row.one]) : at.row.each
	return {
		ok: true,
		state: at.state,
		targets: picked.filter((id) => isAlive(state, id)),
		changed: at.changed,
	}
}
