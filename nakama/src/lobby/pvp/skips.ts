// The skip time and the Ante bank, as pure rules (docs/pvp-match.md section 8a).
// A client reports its skip total (pvp.skip) and what it spends (pvp.timer_spend);
// the server derives each player's Ante bank from those facts and the settings.
// Plain data in, plain data out: no clock, no lobby, no state but the entries.
import { MAX_TIMER_MS, MIN_TIMER_MS } from './settings'
import type { PvpMode, PvpSettings, SkipEntry } from './state'

// userId -> the player's skip facts; a player with no entry has reported nothing.
export type SkipEntries = { [userId: string]: SkipEntry }

// Who a player faces this round (TimerWorld.opponentOf); null with none.
export type OpponentOf = (id: string) => string | null

const NOTHING: SkipEntry = {
	skips: null,
	skipsAtPvp: null,
	facing: null,
	spentMs: 0,
}

export function entryOf(entries: SkipEntries, id: string): SkipEntry {
	return entries[id] ?? NOTHING
}

// The skips a player has made since the last PvP round open or close; null while
// either the total or the baseline is unknown (the server records both as 0 when
// it opens a run, so only a player outside the run has none).
export function skipsSincePvp(entry: SkipEntry): number | null {
	if (entry.skips === null || entry.skipsAtPvp === null) return null
	return entry.skips - entry.skipsAtPvp
}

// How many skips of the player's count for the increment. 'own': every skip since
// PvP. 'lead': the player's skips since PvP over those of the player they face. No
// facing player, or either side's skips unknown, is 0: no skip time without both
// facts.
export function leadOf(
	settings: PvpSettings,
	entries: SkipEntries,
	id: string,
	opponentOf: OpponentOf,
): number {
	const mine = skipsSincePvp(entryOf(entries, id))
	if (mine === null) return 0
	if (settings.skipTimeRule === 'own') return mine
	// The player faced at the last reset, so a target change mid-Ante does not
	// move the bank; before any reset (or with none then) the live opponent.
	const facing = entryOf(entries, id).facing ?? opponentOf(id)
	if (facing === null) return 0
	const theirs = skipsSincePvp(entryOf(entries, facing))
	if (theirs === null) return 0
	return Math.max(mine - theirs, 0)
}

// The time `lead` skips pay. A lobby with no increment (null) pays no skip time.
function skipTimeMs(settings: PvpSettings, lead: number): number {
	if (settings.timerIncrementMs === null) return 0
	return settings.timerIncrementMs * lead
}

// The bank before the 10 s .. 60 min bounds.
function rawBankMs(
	settings: PvpSettings,
	entries: SkipEntries,
	id: string,
	opponentOf: OpponentOf,
): number {
	return (
		settings.timerBaseMs +
		skipTimeMs(settings, leadOf(settings, entries, id, opponentOf)) -
		entryOf(entries, id).spentMs
	)
}

// The player's Ante bank now. A lobby with no published increment (null) pays no
// skip time.
export function anteBankMs(
	settings: PvpSettings,
	entries: SkipEntries,
	id: string,
	opponentOf: OpponentOf,
): number {
	const raw = rawBankMs(settings, entries, id, opponentOf)
	return Math.min(MAX_TIMER_MS, Math.max(MIN_TIMER_MS, raw))
}

// `ms` more spent from the player's bank, but never past the floor: the bank
// stops at MIN_TIMER_MS, and a later skip must not be swallowed by time that was
// never there to spend. The same map when nothing is taken.
export function spentOut(
	settings: PvpSettings,
	entries: SkipEntries,
	id: string,
	ms: number,
	opponentOf: OpponentOf,
): SkipEntries {
	const room = rawBankMs(settings, entries, id, opponentOf) - MIN_TIMER_MS
	const taken = Math.min(ms, Math.max(0, Math.floor(room)))
	if (taken <= 0) return entries
	const entry = entryOf(entries, id)
	return { ...entries, [id]: { ...entry, spentMs: entry.spentMs + taken } }
}

// Manhunt's two one-per-run vouchers (hieroglyph, petroglyph) each lower the ante by
// one, so a Manhunt player can play up to two antes again and skip their blinds twice.
export const MANHUNT_REPLAYABLE_ANTES = 2

// The most skips a run can have made at the highest ante it reached: the Small and
// the Big of each ante, plus those of the antes a Manhunt voucher lets it replay.
export function skipCap(ante: number, mode: PvpMode): number {
	const replayable = mode === 'manhunt' ? MANHUNT_REPLAYABLE_ANTES : 0
	return 2 * (ante + replayable)
}

// A reported run total: a lower one is stale (refused by the reducer), an equal one
// changes nothing. The same map when nothing changes.
export function skipsReported(
	entries: SkipEntries,
	id: string,
	skips: number,
): SkipEntries {
	const entry = entryOf(entries, id)
	if (entry.skips === skips) return entries
	return { ...entries, [id]: { ...entry, skips } }
}

// A server-counted run-out restarts the deadline from the base: the spend is set
// so the bank is the base again (increment * lead stays), and a later pause or drop
// charges the restarted period. The same map when it already is.
export function spentRestarted(
	settings: PvpSettings,
	entries: SkipEntries,
	id: string,
	opponentOf: OpponentOf,
): SkipEntries {
	const spentMs = skipTimeMs(
		settings,
		leadOf(settings, entries, id, opponentOf),
	)
	const entry = entryOf(entries, id)
	if (entry.spentMs === spentMs) return entries
	return { ...entries, [id]: { ...entry, spentMs } }
}

// A PvP round opened or closed: every player starts the next Ante from the base
// again, the skips counted so far are the baseline, and the player faced now is
// pinned for the lead. The same map when nothing changes.
export function skipsReset(
	entries: SkipEntries,
	opponentOf: OpponentOf,
): SkipEntries {
	let changed = false
	const next: SkipEntries = {}
	for (const id of Object.keys(entries)) {
		const entry = entries[id]
		const facing = opponentOf(id)
		if (
			entry.spentMs === 0 &&
			entry.skipsAtPvp === entry.skips &&
			entry.facing === facing
		) {
			next[id] = entry
			continue
		}
		changed = true
		next[id] = { skips: entry.skips, skipsAtPvp: entry.skips, facing, spentMs: 0 }
	}
	return changed ? next : entries
}

// The pairing changed (a mode's onAnte): a player pinned to someone else is pinned
// to the player faced now. Only the pin moves; the spend and the baseline stay.
// A player with no pin keeps using the live opponent. The same map when no pin
// changes.
export function facingRepinned(
	entries: SkipEntries,
	opponentOf: OpponentOf,
): SkipEntries {
	let changed = false
	const next: SkipEntries = {}
	for (const id of Object.keys(entries)) {
		const entry = entries[id]
		const facing = opponentOf(id)
		if (entry.facing === null || entry.facing === facing) {
			next[id] = entry
			continue
		}
		changed = true
		next[id] = { ...entry, facing }
	}
	return changed ? next : entries
}
