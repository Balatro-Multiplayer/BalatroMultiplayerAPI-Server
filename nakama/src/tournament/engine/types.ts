// The tournament engine's data: a bracket is a list of match definitions whose
// two slots say where each player comes from (a seed, a named entrant, the
// winner or loser of an earlier match, or a bye). Who actually plays a match is
// never stored: resolve.ts works it out from the slots and the recorded results
// every time, so byes, forfeits, drops and organiser corrections all flow
// through one place. Pure data -- no Nakama calls anywhere in engine/.

export type EntrantId = string

// A match's two sides, by index into its slots.
export type Side = 0 | 1

export type Format = 'single_elim' | 'double_elim' | 'round_robin' | 'swiss'

// W/L/GF: winners bracket, losers bracket, grand final (elimination).
// RR: round robin. SW: Swiss.
export type Stage = 'W' | 'L' | 'GF' | 'RR' | 'SW'

export type SlotSource =
	// 1-based seed into Bracket.seeds; a seed past the entrant count is a bye.
	| { kind: 'seed'; seed: number }
	| { kind: 'entrant'; id: EntrantId }
	| { kind: 'winner'; matchId: string }
	| { kind: 'loser'; matchId: string }
	| { kind: 'bye' }

// One game of a series: the side that won it, or a draw.
export type GameOutcome = Side | 'draw'

// A result that isn't (only) played games. `players` pins the pairing it was
// given for: if an earlier correction changes who is in the match, the
// decision no longer applies (resolve.ts reports it as stale).
export type Decision =
	| { kind: 'forfeit'; winner: Side }
	| { kind: 'double_forfeit' }
	// An organiser's result. 'draw' only where draws exist (RR/Swiss);
	// 'none' = nobody advances (elimination) / both lose (RR/Swiss).
	| { kind: 'override'; outcome: Side | 'draw' | 'none' }

export interface MatchDef {
	// Stable id: W1-1, L2-3, GF1, GF2, RR-g1-r2-3, SW3-4.
	id: string
	stage: Stage
	// Round within its stage, 1-based.
	round: number
	// Position within the round, 1-based (display order).
	order: number
	// Round robin group, 1-based.
	group?: number
	slots: [SlotSource, SlotSource]
	bestOf: number
	games: GameOutcome[]
	// Who the games and the decision were recorded for (set with the first).
	playedBy?: [EntrantId, EntrantId]
	decision?: Decision
	// Played only when that match was won by that side (the grand-final reset).
	onlyIf?: { matchId: string; winner: Side }
}

export interface BracketOptions {
	// Double elimination: play a second grand final when the losers-bracket
	// player wins the first.
	grandFinalReset?: boolean
	// Round robin: most players per group; groups differ by at most one.
	groupSize?: number
	// Swiss: rounds to play.
	swissRounds?: number
	tiebreakers?: Tiebreaker[]
}

export interface Bracket {
	format: Format
	// Entrant ids in seed order: seeds[0] is seed 1.
	seeds: EntrantId[]
	matches: MatchDef[]
	options: BracketOptions
}

export type Tiebreaker = 'buchholz' | 'game_wins' | 'game_diff' | 'head_to_head' | 'seed'

export type MatchStatus =
	// A player isn't known yet (an earlier match is still running).
	| 'waiting'
	// Both players known, nothing played.
	| 'ready'
	// Games played, series not decided.
	| 'in_progress'
	| 'done'
	// A grand-final reset that isn't needed.
	| 'void'

export type OutcomeReason = 'played' | 'bye' | 'forfeit' | 'double_forfeit' | 'override' | 'dropped'

export interface Outcome {
	// null: nobody (a bye with no player, a double forfeit, an override to none).
	winner: EntrantId | null
	loser: EntrantId | null
	// Which slot won; null for a draw or when nobody did.
	winnerSide: Side | null
	draw: boolean
	reason: OutcomeReason
}

export interface ResolvedMatch {
	def: MatchDef
	// undefined: not known yet; null: nobody (bye).
	players: [EntrantId | null | undefined, EntrantId | null | undefined]
	status: MatchStatus
	// Game wins per side (draws not counted).
	wins: [number, number]
	outcome: Outcome | null
	// Games or a decision were recorded for a different pairing than the
	// current one, so they are ignored.
	stale: boolean
}

export interface ResolvedBracket {
	matches: ResolvedMatch[]
	byId: { [matchId: string]: ResolvedMatch }
}

export type EngineError =
	| { code: 'too_few_entrants'; message: string }
	| { code: 'unknown_match'; message: string }
	| { code: 'not_playable'; message: string }
	| { code: 'invalid'; message: string }
	| { code: 'downstream_played'; message: string; matchIds: string[] }
	| { code: 'round_unfinished'; message: string }
	| { code: 'no_more_rounds'; message: string }
