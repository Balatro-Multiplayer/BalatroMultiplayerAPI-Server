// The timer types of a PvP game, in a leaf module so state.ts can name them without
// importing deadline.ts (which imports state.ts). Types only: no imports, no runtime.
export type TimerKind = 'ante' | 'pvp'

// The one running timer of a game. `against` is who is being timed, sorted.
// `endsAt` is the server's wall-clock end: a number for a bank Ante deadline and for
// every PvP hand timer, null for a personal-clock Ante deadline (it only marks who is
// timed, so their own clock runs faster). `shownMs` is what a STATE shows: the time
// left frozen when `n` last changed or the clock last went on after a pause, so a
// running deadline is no change.
// `pausedMs` is there only while the deadline is paused (docs/pvp-match.md
// section 8): the time left, standing still. `endsAt` is then not read.
export interface Deadline {
	kind: TimerKind
	by: string
	against: string[]
	endsAt: number | null
	shownMs: number | null
	n: number
	pausedMs?: number
	// An Ante deadline that a server restart carried over (checkpoint.ts): the restart
	// voided the starter's Ready, not the starter, so `dropReason` does not read the
	// missing Ready as "unready" until the starter is Ready again, which clears the mark.
	// The value is the id of the last round start at carry time (0 with none): a mark
	// never outlives its round, so a start made since drops the deadline. While marked
	// and the starter is away, the deadline stands still.
	resumed?: number
}
