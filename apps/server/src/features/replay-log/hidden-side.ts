import {
	PVP_BLIND_KEY,
	RESULT_OPCODE,
	ZERO_SCORE,
	parseLegacyScore,
} from '@bmp/types'
import {
	compressToBase64,
	decompressFromBase64,
} from '../../shared/utils/compression.js'

// What a viewer gets for a side its player has not shared: only the events
// that give the result, lives lost and PvP blind scores. The match view reads
// these in apps/web/src/app/(home)/matches/lib/game-log/build-game-log.ts, so
// keep the whitelist (RESULT_OPCODE in @bmp/types) in step with it.
//
// Kept, and in what shape:
//   select_blind, skip_blind  [null, blindKey]  (rounds, and which blind is PvP)
//   hand_result               [scoreText]       (only the last non-zero score of
//                                               each blind recorded as PvP: its
//                                               final score)
//   life_lost                 { lost?, lives? } (lives lost; the only fields the
//                                               match view reads)
//   end                       { result }        (who won)
// Everything else is dropped: hands, discards, shop actions, money, jokers,
// Idol rolls, deck snapshots, run info and match framing events.
//
// A blind counts as PvP only when select_blind names PVP_BLIND_KEY. A
// recording without blind keys has no hand_result kept: the server does not
// guess which blind was PvP.

type EventTuple = [number, string, unknown]

// parseLegacyScore reads the same score forms the match view does (grouped
// digits, e-notation, array text); unreadable text reads as zero and is dropped.
function scoreIsZero(text: string): boolean {
	return parseLegacyScore(text) === ZERO_SCORE
}

function isEventTuple(value: unknown): value is EventTuple {
	return (
		Array.isArray(value) &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'string'
	)
}

function lifeLostFields(args: unknown): { lost?: number; lives?: number } {
	if (args === null || typeof args !== 'object' || Array.isArray(args)) {
		return {}
	}
	const { lost, lives } = args as { lost?: unknown; lives?: unknown }
	return {
		...(typeof lost === 'number' ? { lost } : {}),
		...(typeof lives === 'number' ? { lives } : {}),
	}
}

export function reduceEventsToResultOnly(events: EventTuple[]): EventTuple[] {
	const out: EventTuple[] = []
	let inPvpBlind = false
	let pendingScore: EventTuple | null = null

	const flushScore = () => {
		if (pendingScore) out.push(pendingScore)
		pendingScore = null
	}

	for (const [t, opcode, args] of events) {
		const a = Array.isArray(args) ? args : []
		switch (opcode) {
			case RESULT_OPCODE.SELECT_BLIND:
			case RESULT_OPCODE.SKIP_BLIND: {
				flushScore()
				const key = typeof a[1] === 'string' ? a[1] : null
				inPvpBlind = key === PVP_BLIND_KEY
				out.push([t, opcode, [null, key]])
				break
			}
			case RESULT_OPCODE.HAND_RESULT: {
				if (!inPvpBlind || a[0] === undefined || a[0] === null) break
				const text = String(a[0])
				if (!scoreIsZero(text)) pendingScore = [t, opcode, [text]]
				break
			}
			case RESULT_OPCODE.LIFE_LOST:
				out.push([t, opcode, lifeLostFields(args)])
				break
			case RESULT_OPCODE.END:
				if (
					args !== null &&
					typeof args === 'object' &&
					!Array.isArray(args) &&
					typeof (args as { result?: unknown }).result === 'string'
				) {
					out.push([t, opcode, { result: (args as { result: string }).result }])
				}
				break
		}
	}
	flushScore()
	return out
}

// Takes and returns the stored block: base64(gzip(JSON events)).
export function reduceToResultOnly(compressedEvents: string): string {
	let events: EventTuple[] = []
	try {
		const parsed: unknown = JSON.parse(decompressFromBase64(compressedEvents))
		if (Array.isArray(parsed) && parsed.every(isEventTuple)) events = parsed
	} catch {
		events = []
	}
	return compressToBase64(JSON.stringify(reduceEventsToResultOnly(events)))
}
