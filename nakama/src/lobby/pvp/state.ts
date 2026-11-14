// The server-refereed PvP game state (docs/pvp-match.md section 4): the types, the
// idle value, the lobby accessors and the small updaters every other file shares.
// The decisions live in tick.ts and modes/.
//
// The referee state sits beside the Ready state (PvpState, protocol.ts) on
// lobby.game.pvp, under `referee` (both have a `round`, so they cannot be merged).
// Every idle value is the one a non-PvP lobby projects (never null for a whole
// key).
//
// The four state types, from the lobby inwards:
//
//   type          | holds                                    | who may change it
//   --------------|------------------------------------------|----------------------------
//   PvpState      | the Ready state (protocol.ts): who is    | ready.ts only
//                 | Ready, the last round start              |
//   StoredPvp     | lobby.game.pvp: a PvpState plus the      | ready.ts (the Ready part),
//                 | referee's part under `referee`           | withReferee (`referee`)
//   RefereeState  | the referee's working state: a ModeView  | the fact reducers record
//                 | plus the facts, `runId` and `lastStart`  | facts (facts.ts); only the
//                 | (the two read from the Ready state)      | tick decides (tick.ts)
//   ModeView      | RefereeState without the facts: what a   | mode hooks (modes/): they
//                 | mode hook sees and returns               | cannot reach the log
//
// "Still playing" has five predicates, with different rules; pick by the table:
//
//   predicate           | file         | true for
//   --------------------|--------------|------------------------------------------
//   isOut               | reducer.ts   | out of the run, or a forfeit fact unread
//                       |              | (a request's gate)
//   outOfRun            | ready.ts     | out per the stored lives, read from the
//                       |              | lobby (who the Ready round waits on)
//   inRunIgnoringLives  | state.ts     | in the run, lives not looked at
//                       |              | (waiting on a seat)
//   inRunWithLives      | modes/common | in the run and a life left ("alive")
//   teamIsOut           | modes/teams  | a team with no lives or no member in the run
import { PVP_MOD_ID } from '../../standing/pvp_version'
import type { PvpState } from '../protocol'
import type { Lobby } from '../state'
import type { OpponentRecords } from './opponent_state'
import { seedOpponentFacts } from './opponent_state'
import type { PendingDeath } from './pending'
import { pvpOf } from './ready'
import type { Deadline, TimerKind } from './types'

// The game mode, from the lobby's queue_mode (settings.ts).
export const PVP_MODES = ['royale', 'nemesis', 'manhunt', 'teams'] as const
export type PvpMode = (typeof PVP_MODES)[number]

export type PvpTeam = 'A' | 'B' | 'RUNNER' | 'HUNTER'

// The settings frozen at the first tick that sees a new runId.
export interface PvpSettings {
	mode: PvpMode
	startedCount: number
	startingLives: number
	hunterLives: number
	// The first ante whose Boss is the PvP blind (lobby metadata pvp_start_round).
	pvpStartAnte: number
	deathOnRoundLoss: boolean
	// The clock rules of the ruleset (settings.ts RULESET_CLOCKS), resolved at start.
	// A ruleset the table does not know never starts (bad_rules), so there is always a row.
	clocks: ClockRules
	// The server-counted Ante timer's restart base, and how many run-outs a player
	// is forgiven per game (lobby metadata timer_base_seconds, timer_forgiveness).
	// Not projected: the clients are told the deadline, not the rule.
	timerBaseMs: number
	timerForgiveness: number
	// What the skip time adds to an Ante bank per skip of lead (lobby metadata
	// timer_increment_seconds; null = no skip time), and whose skips
	// count: 'lead' over the facing player, 'own' every skip since the last PvP
	// round (skips.ts). Not projected.
	timerIncrementMs: number | null
	skipTimeRule: SkipTimeRule
}

export type SkipTimeRule = 'lead' | 'own'

// Who counts the Ante clock: the server's shared bank, a personal clock per
// player (Pressure, Speedlatro), or nobody (a ruleset without a timer).
export type AnteClock = 'bank' | 'personal' | 'none'

// The PvP hand timer: the allowance at round open, and the time each credited hand adds.
export interface PvpClockRules {
	baseMs: number
	handMs: number
}

// A personal clock's rules. `timedRate` is the rate while an Ante deadline times the
// player (outside PvP for Speedlatro).
export type PersonalClockRules =
	| {
			kind: 'pressure'
			baseMs: number
			timedRate: 1 | 2
			previewCostMs: number
	  }
	| {
			kind: 'speedlatro'
			baseMs: number
			// The clock at the player's own blind start, and the grace after it.
			pvpMs: number
			graceMs: number
			timedRate: 1 | 2
			previewCostMs: number
	  }

export interface ClockRules {
	ante: AnteClock
	pvp: PvpClockRules | null
	personal: PersonalClockRules | null
}

// `state.rules` (and the pvp.rules key): idle until the first tick of a run
// freezes the settings.
export type FrozenSettings =
	| { runId: null; mode: null; startedCount: 0 }
	| ({ runId: string } & PvpSettings)

export type PvpPhase = 'shop' | 'playing' | 'resolved'

// A player's entry in the round. It exists from the seat (seatPlayers) and no fact
// creates one. Every number the client owns is null until the client reports it
// (blind_start, hand, progress): null is unknown, never a guess, and every reader
// says what it does with it.
export interface PvpRoundPlayer {
	// Scores travel as strings (Talisman text). null until the player's blind_start
	// (which carries the score then) or a hand of the round; compareRoundScore ranks
	// null below every score (score.ts).
	score: string | null
	// DERIVED, by handsAfter (facts.ts) only: reportedHands less the run-outs the
	// player has not yet counted. null until the player's blind_start of this round.
	handsLeft: number | null
	// The best score of the run; null until a hand.
	highestScore: string | null
	// null until the player reports progress.
	ante: number | null
	furthestBlind: number | null
	// The hands the player last counted: the first blind_start of the round, then
	// every pvp.hand. null until blind_start. Not projected.
	reportedHands: number | null
	// How many of `timerLosses` the player had already subtracted when it counted
	// `reportedHands` (the request's timerLossesApplied). Not projected.
	reportedApplied: number
	// PvP-timer run-outs the server accepted from this player this round. A count
	// the server owns: 0 at the seat and at every round open.
	timerLosses: number
	// The server ended this player's hands for the round (out of hands on a failed
	// blind); handsLeft stays as reported. false at the seat and at every round open.
	handsSpent: boolean
	// The hand count the player's pending pvp.hand_commit announced; null when none
	// is pending. Server-only, not projected.
	committedHands: number | null
	// The watermark of hands already credited time: the derived handsLeft at the
	// player's blind_start, lowered by each credit and each server PvP run-out. null
	// until blind_start. Server-only, not projected.
	creditedHands: number | null
	// The PvP hand allowance left (ms), while no PvP deadline holds it; null on a
	// ruleset with no PvP clock. Server-only, not projected.
	pvpLeftMs: number | null
}

export interface PvpRound {
	runId: string | null
	// The id of the start the round opened at (ready.ts lastStart.roundId, 1-based,
	// the number the client sends); 0 before the first start. Only the tick
	// writes it (openNextRound); no mode hook does, so a mode cannot bump the id.
	roundId: number
	phase: PvpPhase
	players: { [userId: string]: PvpRoundPlayer }
	lastResult: { roundId: number; losers: string[] } | null
}

// One change of a player's lives. `key` is the blindKey, "pvp:<roundId>" for a
// PvP loss, or null for a gain.
export interface PvpLifeEvent {
	delta: number
	key: string | null
}

export interface PvpLifePlayer {
	lives: number
	eliminated: boolean
	forfeited: boolean
	left: boolean
	// Append-only within a run, less the consumed facts the tick drops.
	events: PvpLifeEvent[]
}

// A dead player whose result waits on the same-blind result of `waitsOn`. (A server
// run-out has no blind and never appears here: it is a record in facts.deaths only.)
export interface PvpPending {
	playerId: string
	blindKey: string
	waitsOn: string[]
}

export interface PvpLives {
	runId: string | null
	players: { [userId: string]: PvpLifePlayer }
	teamLives: { A: number; B: number } | null
	pending: PvpPending[]
}

export interface PvpTeams {
	runId: string | null
	teams: { [userId: string]: PvpTeam }
}

export interface PvpVotes {
	runId: string | null
	draw: string[]
	seed: string[]
}

export interface PvpPlace {
	playerId: string
	place: number
}

export interface PvpResult {
	runId: string | null
	kind: 'win' | 'draw' | null
	winnerId: string | null
	winnerTeam: string | null
	places: PvpPlace[]
}

// Nemesis: who fights whom at one ante (R27). Stored, so a re-tick or a death
// never re-pairs; the mode that makes it owns it.
export interface PvpPairing {
	// The ante the pairing was made for.
	ante: number
	// userId -> partner, null for the bye. A partner who dies stays in.
	partners: { [userId: string]: string | null }
	// "a|b" with the two ids sorted.
	usedPairs: string[]
	lastBye: string | null
}

// Teams: the opposing member each player's card targets at one ante (R51).
// Random, so stored: a re-tick never re-draws it; the mode that makes it owns it.
export interface PvpCardTargets {
	// The ante the targets were drawn for.
	ante: number
	targets: { [userId: string]: string | null }
}

// The referee's state as a mode hook sees it, without the facts. (pvp.targets is
// derived in the projection, so it has no stored type.)
export interface ModeView {
	rules: FrozenSettings
	round: PvpRound
	lives: PvpLives
	teams: PvpTeams
	votes: PvpVotes
	result: PvpResult
	pairing: PvpPairing | null
	cardTargets: PvpCardTargets | null
}

export type PvpFact =
	// A blind result as merged so far: a failure is final (R12), so a later
	// `beaten` never clears it, and roundLost never clears either.
	| {
			type: 'blind'
			playerId: string
			blindKey: string
			beaten: boolean
			roundLost: boolean
	  }
	// Hand time earned: `hands` newly credited hands of the player (the tick adds
	// hands x handMs to the PvP clock).
	| { type: 'hand_credit'; playerId: string; hands: number }
	// A timer request; the tick opens or drops the deadline from it, by the
	// ruleset's clock rules.
	| { type: 'timer_start'; playerId: string; kind: TimerKind }
	| { type: 'timer_pause'; playerId: string }
	// One Score Preview on a personal clock (D10): the tick charges the previewCostMs
	// of the rules against the clock as accrued, never the reducer.
	| { type: 'preview_charge'; playerId: string }
	| { type: 'voucher'; playerId: string; voucherKey: string }
	| { type: 'forfeit'; playerId: string }
	// A player's progress moved (an ante reached or a blind selected or skipped): kept
	// in the log so it is consumed in order with the failures (the team guard, lives.ts).
	| { type: 'progress'; playerId: string }

// A player's skip facts of the run (skips.ts). An absent entry is a player who has
// reported nothing: skips unknown, nothing spent.
export interface SkipEntry {
	// The run total the player last reported (G.GAME.skips); null until the first
	// pvp.skip, unknown rather than 0.
	skips: number | null
	// `skips` as of the last PvP round open or close; null when none was known then.
	skipsAtPvp: number | null
	// The player faced at that point (the lead is counted against them); null until a
	// reset found one, then the live opponent stands in.
	facing: string | null
	// Ante bank the player has used since that point (a pvp.timer_spend, the time
	// their own server-counted deadline ran).
	spentMs: number
}

// A player's personal clock (Pressure, Speedlatro; clocks.ts). `ms` is the time at
// `since` (rewritten only when `n` bumps); the live value is
// `ms - (now - since) x rate` while `running`. `n` counts the changes, `spent` is a
// Speedlatro run-out not yet reset. Only the personal rulesets have entries.
// `since` and `graceUntil` are never projected.
export interface PersonalClock {
	ms: number
	running: boolean
	rate: 1 | 2
	n: number
	spent: boolean
	since: number
	// The end of the Speedlatro grace after the player's own blind start; null until
	// this round's anchor (always null for Pressure).
	graceUntil: number | null
}

// A bye is remembered as `{ rival: null }`, so the next rival, the old one included,
// starts from a fresh baseline.
export type SkipsSeen = { rival: null } | { rival: string; skips: number }

export interface BlindRecord {
	beaten: boolean
	roundLost: boolean
}

// What the request reducers record (facts.ts): the facts and the merged blind
// results. Append-only within a run, except that the tick drops the facts nobody
// dedupes on once it has read them (tick.ts); it also advances `applied`.
export interface RecordedFacts extends OpponentRecords {
	// Append-only within a run, less the consumed facts the tick drops.
	log: PvpFact[]
	// How much of `log` the tick has decided on (the tick advances it).
	applied: number
	// userId -> blindKey -> the merged blind result.
	blinds: { [userId: string]: { [blindKey: string]: BlindRecord } }
	// userId -> the roundId of the player's last real pvp.hand. Only a hand writes
	// it (a server-ended hand count is `handsSpent`, not this).
	handRound: { [userId: string]: number }
	// userId -> the player's skip facts (skips.ts).
	skips: { [userId: string]: SkipEntry }
	// The players whose client is animating (pvp.animating), sorted. Only pvp.animating
	// adds a player; the tick drops one who disconnects or leaves, all of them when a
	// round closes, and the set at a new run. Server-only, not projected.
	animating: string[]
}

// What the tick derives from the facts and remembers between ticks. Only the tick
// writes it (withMemo; the deadline step writes `deadline` and `timerN`).
export interface TickMemo {
	// userId -> the blindKeys whose guarded life loss is spent (R2: one guarded
	// loss per player per blind; an unguarded ante-timer loss leaves it alone).
	// Besides blind keys a list may hold the one `team:spent` entry (the Teams guard, spent by a
	// non-PvP failure, cleared by a member's progress): read by lives.ts, and round_cycle.ts's
	// rearmGuards (which only removes blind keys, so it leaves it alone).
	guarded: { [userId: string]: string[] }
	// userId -> the blindKey of each PvP round the player Readied, one entry per
	// round the player started in, in round order (the last is the current round's).
	// A PvP loss is guarded on it, and it is the one source of "a PvP blind": a
	// Manhunt voucher lowers a player's own ante, so the key is the player's own.
	pvpBlinds: { [userId: string]: string[] }
	// The highest ante any player reached that onAnte has seen; 0 before any.
	anteSeen: number
	// A game of 3+ players (R32): a death on a non-PvP blind, kept for the places
	// once the game ends. Never projected; `lives.pending` shows only the deaths
	// still waiting.
	deaths: PendingDeath[]
	// The one running timer of the game (deadline.ts), null when none runs. Only
	// the deadline step writes it.
	deadline: Deadline | null
	// The last `n` a deadline was given, so a deadline opened after another
	// dropped never reuses a number the clients have seen; 0 before any.
	timerN: number
	// userId -> run-outs forgiven so far this game (absent: none yet).
	forgiven: { [userId: string]: number }
	// userId -> the personal clock (absent: none yet, and on a ruleset without one).
	clocks: { [userId: string]: PersonalClock }
	// userId -> the opponent whose skips the personal clock last counted, and their
	// total then (the baseline the next credit is measured from).
	skipsSeen: { [userId: string]: SkipsSeen }
}

export type PvpFacts = RecordedFacts & TickMemo

// The referee's whole working state: what the mode hooks see, plus the facts and
// the two Ready fields the reducers and the tick read (`runId`, `lastStart`).
export type RefereeState = ModeView & {
	facts: PvpFacts
	runId: string
	lastStart: PvpState['lastStart']
}

// A refereed game's lobby.game.pvp: the Ready state, plus the referee's part
// (everything but the two Ready fields) once the first request or tick wrote it.
export type StoredPvp = PvpState & {
	referee?: Omit<RefereeState, 'runId' | 'lastStart'>
}

// The idle referee state: what a lobby with no refereed game projects.
export function emptyPvp(): ModeView {
	return {
		rules: { runId: null, mode: null, startedCount: 0 },
		round: {
			runId: null,
			roundId: 0,
			phase: 'shop',
			players: {},
			lastResult: null,
		},
		lives: { runId: null, players: {}, teamLives: null, pending: [] },
		teams: { runId: null, teams: {} },
		votes: { runId: null, draw: [], seed: [] },
		result: {
			runId: null,
			kind: null,
			winnerId: null,
			winnerTeam: null,
			places: [],
		},
		pairing: null,
		cardTargets: null,
	}
}

export function emptyFacts(): PvpFacts {
	return {
		log: [],
		applied: 0,
		blinds: {},
		handRound: {},
		skips: {},
		animating: [],
		...seedOpponentFacts([]),
		guarded: {},
		pvpBlinds: {},
		anteSeen: 0,
		deaths: [],
		deadline: null,
		timerN: 0,
		forgiven: {},
		clocks: {},
		skipsSeen: {},
	}
}

// The running PvP game's referee state; null when no PvP game is started. A
// game that has no referee fields yet (before the first tick) reads as idle.
export function refereeOf(lobby: Lobby): RefereeState | null {
	if (lobby.modId !== PVP_MOD_ID) return null
	const base: StoredPvp | null = pvpOf(lobby)
	if (!base) return null
	// A stored referee is returned as stored: the checkpoint schema is checked at
	// its one boundary (checkpoint.ts), so no field is filled in here.
	const stored = base.referee ?? { ...emptyPvp(), facts: emptyFacts() }
	return { ...stored, runId: base.runId, lastStart: base.lastStart }
}

export function withReferee(lobby: Lobby, state: RefereeState): Lobby {
	const base: StoredPvp | null = pvpOf(lobby)
	if (!base) return lobby
	const { runId: _run, lastStart: _last, ...referee } = state
	const pvp: StoredPvp = { ...base, referee }
	return { ...lobby, game: { ...lobby.game, pvp } }
}

// What a mode returns (a ModeView) laid back over the referee state: the facts stay.
export function withView(state: RefereeState, view: ModeView): RefereeState {
	return { ...state, ...view, facts: state.facts }
}

// The tick's memo fields of `facts`.
export function withMemo(
	state: RefereeState,
	memo: Partial<TickMemo>,
): RefereeState {
	return { ...state, facts: { ...state.facts, ...memo } }
}

export function withFact(state: RefereeState, fact: PvpFact): RefereeState {
	return {
		...state,
		facts: { ...state.facts, log: [...state.facts.log, fact] },
	}
}

// A blind's result merged into the facts: a failure is final (R12). The tick's
// run-out helper records a timer's failed blind through this too.
export function mergeBlind(
	state: RefereeState,
	id: string,
	blindKey: string,
	next: BlindRecord,
): { state: RefereeState; record: BlindRecord; changed: boolean } {
	const old = state.facts.blinds[id]?.[blindKey]
	const record: BlindRecord = old
		? {
				beaten: old.beaten && next.beaten,
				roundLost: old.roundLost || next.roundLost,
			}
		: next
	if (old && old.beaten === record.beaten && old.roundLost === record.roundLost)
		return { state, record, changed: false }
	return {
		changed: true,
		record,
		state: {
			...state,
			facts: {
				...state.facts,
				blinds: {
					...state.facts.blinds,
					[id]: { ...state.facts.blinds[id], [blindKey]: record },
				},
			},
		},
	}
}

// In the run: not eliminated, forfeited or left. Lives are not looked at: a seat
// at 0 lives still counts while its pending death waits. Use `inRunWithLives`
// (modes/common.ts) for "alive", which also needs a life left.
export function inRunIgnoringLives(seat: PvpLifePlayer | undefined): boolean {
	return !!seat && !seat.eliminated && !seat.forfeited && !seat.left
}
