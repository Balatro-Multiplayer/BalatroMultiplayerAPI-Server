// Who a finished run's result is suspect for: a replay log that fails its
// hash check, more scored hands than the game's real length allows (the
// API's evaluateAntiCheat, with MIN_MS_PER_HAND from anti-cheat.config.ts),
// or, in a ranked game, a log that is missing, cut off or has no hash: its
// season best claim can't be checked (rating/metrics.ts logBounds). That last
// flag is only for a player who reported a result in a game that was played
// out: a restarted or abandoned game, or a player with no result, has no
// claim to check.
// A flagged player is still rated, and the run goes to the moderators' service
// queue through the mirror. Pure.
import type { LogEvent } from '../shared/replay/events'
import type { FlagReason, LogCheck, RunRecord } from './protocol'

// The least time (ms) one hand can take to select and score.
export const MIN_MS_PER_HAND = 3000

// The replay opcode for a scored hand, as the PvP client logs it.
const HAND_OPCODE = 'hand_result'

export function handCount(events: LogEvent[] | undefined): number {
	if (!events) return 0
	return events.filter((event) => event.opcode === HAND_OPCODE).length
}

export function runFlags(
	run: RunRecord,
	events: { [userId: string]: LogEvent[] },
	checks: { [userId: string]: LogCheck },
): { [userId: string]: FlagReason } {
	const flags: { [userId: string]: FlagReason } = {}
	const played = run.status !== 'restarted' && run.status !== 'abandoned' && run.status !== 'dodged'
	const elapsedMs = run.endedAt - run.startedAt
	for (const player of run.players) {
		if (checks[player.id] === 'mismatch') flags[player.id] = 'hash_mismatch'
		else if (handCount(events[player.id]) * MIN_MS_PER_HAND > elapsedMs) flags[player.id] = 'elapsed_time_gate'
		else if (run.rankedMode && played && player.id in (run.reports ?? {}) && (checks[player.id] === 'unavailable' || checks[player.id] === 'incomplete')) flags[player.id] = 'unverified_log'
	}
	return flags
}
