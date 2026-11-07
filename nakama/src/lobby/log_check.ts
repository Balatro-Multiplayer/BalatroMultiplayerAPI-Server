// Checks a player's stored replay log against the hash the client itself
// sent in its closing 'chk' event (api/replay/recorder.lua's RLOG.end_run).
// SHA-256 over the JSON array of [t, opcode, args] tuples, framing events excluded -- here
// over each event's JSON text as it arrived (see PlayerLog). Pure; the hash
// function is passed in.
import type { LogCheck, PlayerLog } from './protocol'

// 'end' carries the outcome the hash attests to, and 'chk' is the hash.
const FRAMING_OPCODES: { [opcode: string]: boolean } = { end: true, chk: true }

function opcodeOf(line: string): unknown {
	return (JSON.parse(line) as unknown[])[1]
}

export function hashInput(lines: string[]): string {
	return `[${lines.filter((line) => !FRAMING_OPCODES[opcodeOf(line) as string]).join(',')}]`
}

// The hash from the log's last 'chk' event, if it has one.
export function claimedHash(lines: string[]): string | null {
	for (let i = lines.length - 1; i >= 0; i--) {
		const event = JSON.parse(lines[i]) as unknown[]
		if (event[1] !== 'chk') continue
		const args = event[2] as { carbon?: unknown } | null
		return args && typeof args.carbon === 'string' ? args.carbon : null
	}
	return null
}

// How many events the server saw numbers for but never kept: the log's gap.
// 0 for a complete log, and for a client that numbers no events.
export function logGapsOf(log: PlayerLog | undefined): number {
	if (!log || log.ahead === undefined) return 0
	return Math.max(0, log.ahead - (log.seq ?? log.lines.length))
}

// 'incomplete' when the stored log has a gap: the events are not all here, so
// the hash cannot be compared (even when the 'chk' is missing too). 'unavailable' when there's nothing to check: no log, no 'chk' (the client
// never reached end_run), or a truncated log. 'mismatch' is only for a
// complete log whose hash really differs.
export function checkLog(
	log: PlayerLog | undefined,
	sha256: (input: string) => string,
): { carbonHash: string | null; check: LogCheck } {
	if (!log) return { carbonHash: null, check: 'unavailable' }
	const carbonHash = claimedHash(log.lines)
	// A gap comes first: events after it were refused, so the 'chk' is often
	// among the missing ones too.
	if (logGapsOf(log) > 0) return { carbonHash, check: 'incomplete' }
	if (carbonHash === null || log.truncated)
		return { carbonHash, check: 'unavailable' }
	const recomputed = sha256(hashInput(log.lines)).toLowerCase()
	return {
		carbonHash,
		check: recomputed === carbonHash.toLowerCase() ? 'match' : 'mismatch',
	}
}
