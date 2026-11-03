import {
	compressToBase64,
	decompressFromBase64,
} from '../../shared/utils/compression.js'

// What a viewer gets for a side its player has not shared: only the events
// that give the result, lives lost and PvP blind scores. The match view reads
// these in apps/web/src/app/(home)/matches/lib/game-log/build-game-log.ts, so
// keep the whitelist in step with it.
//
// Kept, and in what shape:
//   select_blind, skip_blind  [null, blindKey]  (rounds, and which blind is PvP)
//   hand_result               [scoreText]       (only the last non-zero score of
//                                               each PvP blind: its final score)
//   life_lost                 as recorded       (lives lost)
//   end                       { result }        (who won)
// Everything else is dropped: hands, discards, shop actions, money, jokers,
// Idol rolls, deck snapshots, run info and match framing events.

type EventTuple = [number, string, unknown]

const PVP_BLIND_KEY = 'bl_mp_nemesis'

// Same reading as the web's score text parser, for the zero check only.
function scoreIsZero(text: unknown): boolean {
	if (typeof text !== 'string' && typeof text !== 'number') return false
	const value =
		typeof text === 'number'
			? text
			: Number(text.trim().replace(/,/g, '').toLowerCase())
	return value === 0
}

function isEventTuple(value: unknown): value is EventTuple {
	return (
		Array.isArray(value) &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'string'
	)
}

export function reduceEventsToResultOnly(events: EventTuple[]): EventTuple[] {
	const out: EventTuple[] = []
	let blindOrdinal = 0
	let inPvpBlind = false
	let pendingScore: EventTuple | null = null

	const flushScore = () => {
		if (pendingScore) out.push(pendingScore)
		pendingScore = null
	}

	for (const [t, opcode, args] of events) {
		const a = Array.isArray(args) ? args : []
		switch (opcode) {
			case 'select_blind':
			case 'skip_blind': {
				flushScore()
				blindOrdinal++
				const key = typeof a[1] === 'string' ? a[1] : null
				inPvpBlind = key ? key === PVP_BLIND_KEY : (blindOrdinal - 1) % 3 === 2
				out.push([t, opcode, [null, key]])
				break
			}
			case 'hand_result': {
				if (!inPvpBlind || a[0] === undefined || a[0] === null) break
				const text = String(a[0])
				if (!scoreIsZero(text)) pendingScore = [t, opcode, [text]]
				break
			}
			case 'life_lost':
				out.push([t, opcode, args])
				break
			case 'end':
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
