// What a PvP mode implements (docs/pvp-match.md section 6). Every hook is a
// pure function (state, ctx) -> state.
//
// Adding a mode: write one file in modes/ that exports a `Mode`, and register it in
// `pickMode` (modes/index.ts), the only place that maps a mode name to a Mode. Add its
// name to `ModeName` here (and `PvpMode` in state.ts, settings.ts when a lobby queue
// starts it). The shared code never asks which mode it is: it reads the data fields
// (`deathPolicy`, `outOfHandsOnFail`) and calls the optional hooks (`lifePool`,
// `opensSideDeath`, `voucherGainers`, `mayRedeemVoucher`, `onAnte`, `view`). Start
// from the helpers in modes/common.ts (seats, round opening, last-one-standing win
// check, forfeits). A mode only names losers and gainers; the tick (lives.ts) is
// the one writer of lives.
import type { StepContext } from '../../../actions/registry'
import type { ModeView, PvpTeam } from '../state'

export type ModeName = 'duel' | 'royale' | 'nemesis' | 'manhunt' | 'teams'

export type Hook = (state: ModeView, ctx: StepContext) => ModeView

// What the lobby knows when a run starts: the started ids in start order, the
// teams the players picked, and a matchmade team split (docs/pvp-match.md section 4).
export interface RunStart {
	startedIds: string[]
	picks: { [id: string]: PvpTeam }
	teamPlan: string[][] | null
}

// Settles the roster and lives once, at the start of a run.
export type InitHook = (
	state: ModeView,
	ctx: StepContext,
	start: RunStart,
) => ModeView

// A Manhunt voucher fact: the player who bought it and which one.
export interface VoucherFact {
	playerId: string
	voucherKey: string
}

// Names the players who gain a life from a voucher; the tick gives it (R42).
export type VoucherGainers = (state: ModeView, fact: VoucherFact) => string[]

// Whether `playerId` may redeem a voucher in this game (a refused one gets `not_runner`).
export type VoucherRedeemer = (state: ModeView, playerId: string) => boolean

// Opens a round.
export type RoundReadyHook = (
	state: ModeView,
	ctx: StepContext,
) => ModeView

// What a mode puts in pvp.targets. The projection fills the rest with idle
// values: `safe` {} (Royale only), `pairingAnte` null (Nemesis only).
export interface TargetsView {
	opponents: { [id: string]: string | null }
	safe?: { [id: string]: boolean }
	pairingAnte?: number | null
	// Teams: each player's card target; teamScores: each team's round score.
	cardTargets?: { [id: string]: string | null }
	teamScores?: { A: string | null; B: string | null } | null
}

export type ViewHook = (state: ModeView) => TargetsView

// Whose answer a player's last life lost on a normal blind waits on (deaths.ts):
// - 'opponent': the one opponent (R11, R21);
// - 'everyone': every other player still in the run (R32), a game of 3+;
// - 'side': the other side as a whole (R45, R53), Manhunt and Teams;
// - 'none': nobody, the player is simply out.
export type DeathPolicy = 'none' | 'opponent' | 'everyone' | 'side'

// Teams: the lives are one pool per team, not one per player. The tick (lives.ts)
// asks the pool who pays and has it spend; the guards and the pending death stay
// shared. A mode without one charges each player's own lives.
export interface LifePool {
	// The seats that show the loss when `id` is charged: all of id's team. Empty
	// when nothing is charged (id on no team, or its pool already at 0).
	sharers: (state: ModeView, id: string) => string[]
	// One life off the pool of id's team, with the loss event under `key` and the
	// pool's value shown on every seat of the team.
	spend: (state: ModeView, id: string, key: string | null) => ModeView
	// Who is charged for a lost round, out of its `losers`: one per losing team.
	payers: (state: ModeView, losers: string[]) => string[]
}

export interface Mode {
	name: ModeName
	// True for the final-two variant of a 3+ game (modes/index.ts): the round and the
	// targets are the duel's.
	finalTwo?: true
	// Who a death on a normal blind waits on.
	deathPolicy: DeathPolicy
	// 'side' deaths only: whether `id` running out of lives opens the pending death
	// (default yes). Manhunt: only the Runner does, a Hunter at 0 is simply out.
	opensSideDeath?: (state: ModeView, id: string) => boolean
	// Whether a lost blind (or an ante-timer run-out) puts the player out of hands,
	// so the round does not wait on a count that will never move (R34). False for
	// a duel, whose round ends on the hands and scores of both.
	outOfHandsOnFail: boolean
	// The team's life pool (Teams only).
	lifePool?: LifePool
	// Settles the roster and lives at the start of a run.
	init: InitHook
	// Opens the next round. The tick calls it only when a new pvp.ready start
	// arrives.
	roundReady: RoundReadyHook
	// Resolves a round once every alive player has handsLeft 0: sets phase
	// 'resolved' and writes `lastResult`; never touches roundId or lives.
	resolveRound: Hook
	// A voucher fact (Manhunt: a Runner's ante-skip voucher gives Hunters a life).
	// The mode names the gainers; only the tick changes lives.
	voucherGainers?: VoucherGainers
	// Who may redeem a voucher; a mode without it refuses every voucher.
	mayRedeemVoucher?: VoucherRedeemer
	// Writes the result when the game is decided.
	checkWinner: Hook
	// Ante hooks (re-pairing, the Runner's ante 9).
	onAnte?: Hook
	// A forfeit or a left seat.
	onForfeit: Hook
	// Who targets whom, derived from the state (pvp.targets); nothing is stored.
	// A mode with no targets leaves it out.
	view?: ViewHook
}
