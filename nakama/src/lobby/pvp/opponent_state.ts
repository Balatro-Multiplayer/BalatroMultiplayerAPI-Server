// The opponent facts of the refereed PvP state: who each player's Nemesis is per
// ante, the sells and blind slots each player reported, the effects aimed at each
// player and the traps in play. Only types and the seeded values live here; the
// reducers are opponent_facts.ts and traps.ts, the target rule is
// opponent_targets.ts.
//
// The records sit beside the other recorded facts. Every record is built fresh for
// the started ids at a run's start (`seedOpponentFacts`), so "no sells" is a known
// value, not a fallback.
import type { Refusal } from './reducer'
import type { RefereeState } from './state'

export const PVP_NEMESIS_KEY = 'pvp.nemesis'
export const PVP_OPPONENT_KEY = 'pvp.opponent'
export const PVP_EFFECTS_KEY = 'pvp.effects'
export const PVP_TRAPS_KEY = 'pvp.traps'

// One player's frozen targets for one ante. `each` is who an effect hits (Asteroid,
// Pizza, Gambling, traps), `one` who a single-opponent card reads (Taxes, Pincher);
// null is a known "no opponent this ante".
export interface NemesisRow {
	each: string[]
	one: string | null
}

// ante (as a JSON key) -> the row frozen for it. An absent ante is unknown.
export type NemesisByAnte = { [ante: string]: NemesisRow }

// ---- sells and blind slots (pvp.opponent) ----

// One blind a player passed. `ante` is null only for a slot refused `no_progress`.
export type Slot =
	| { ante: number; spent: number }
	| { ante: number; skipped: true }
	| { ante: number | null; refused: string }

export interface OpponentPlayer {
	// seller's ante (a JSON key) -> sells accepted
	sells: { [ante: string]: number }
	slots: Slot[]
	// The player is out of the run: a target's Pincher pays $0 for a slot it never
	// recorded.
	closed: boolean
}

export interface OpponentFacts {
	players: { [id: string]: OpponentPlayer }
}

// Server bookkeeping that is never projected (a sibling of pvp.opponent, so the
// published record cannot carry it).
export interface OpponentServerPlayer {
	// The ante the tick last saw the player on; null until the first. A bye ante
	// the player has moved on from is frozen empty only if the tick saw it.
	seenAnte: number | null
}

export interface OpponentServerFacts {
	players: { [id: string]: OpponentServerPlayer }
}

// ---- effects (pvp.effects) ----

export type EffectKind = 'asteroid' | 'pizza' | 'gambling'

// An effect aimed at a player: who sent it, its place in the player's incoming list
// (from 1), what it is and the amount the server's table gave it.
export interface IncomingEffect {
	from: string
	n: number
	kind: EffectKind
	amount: number
}

export interface EffectsPlayer {
	// Effects aimed at this player, in record order.
	incoming: IncomingEffect[]
}

export interface EffectsFacts {
	players: { [id: string]: EffectsPlayer }
}

// ---- traps (pvp.traps) ----

export type TrapData = { [key: string]: unknown }

// `{fired: {bounced: <id>}}` is an Arcane Lock that sent a plant back.
export type TrapState = 'live' | { fired: TrapData } | 'lost'

export interface TrapRecord {
	id: number
	key: string
	owner: string
	holder: string
	state: TrapState
}

export interface TrapsFacts {
	// The next id to assign; ids are unique within a run.
	trapSeq: number
	traps: TrapRecord[]
}

export interface OpponentRecords {
	nemesis: { [id: string]: NemesisByAnte }
	opponent: OpponentFacts
	// Never projected.
	server: OpponentServerFacts
	effects: EffectsFacts
	traps: TrapsFacts
}

// The referee state, whose facts hold the opponent records.
export type OpponentState = RefereeState

// ---- what a request reducer answers ----

// How a request was answered:
// - accepted: recorded and applied;
// - refused: recorded as a refused slot, nothing applied.
export type OpponentReply =
	| { kind: 'accepted' }
	| { kind: 'refused'; reason: string; detail?: Implausible }

// What an `implausible` refusal counted: for the shell's log line (actor, kind,
// count, window). Internal, never on the wire.
export interface Implausible {
	count: number
	cap: number
	window: 'slot'
}

// A refusal that records nothing (`not_running`, `bad_payload`, ...) is a plain
// `Refusal`.
export type OpponentResult =
	| { ok: true; state: OpponentState; changed: string[]; reply: OpponentReply }
	| Refusal

export function seedOpponentPlayer(): OpponentPlayer {
	return { sells: {}, slots: [], closed: false }
}

// The records of a run that starts with `ids`: built fresh, replacing the previous
// run's.
export function seedOpponentFacts(ids: string[]): OpponentRecords {
	const nemesis: OpponentRecords['nemesis'] = {}
	const players: OpponentFacts['players'] = {}
	const server: OpponentServerFacts['players'] = {}
	const effects: EffectsFacts['players'] = {}
	for (const id of ids) {
		nemesis[id] = {}
		players[id] = seedOpponentPlayer()
		server[id] = { seenAnte: null }
		effects[id] = { incoming: [] }
	}
	return {
		nemesis,
		opponent: { players },
		server: { players: server },
		effects: { players: effects },
		traps: { trapSeq: 0, traps: [] },
	}
}
