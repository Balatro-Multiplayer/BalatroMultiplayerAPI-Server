import { describe, expect, it } from 'vitest'
import { createBracket } from './engine/bracket'
import { presetSchedule, validateSchedule } from './engine/schedule'
import type { Bracket, Format } from './engine/types'
import { applyRoundTimings, validRoundTimings } from './round_timing'

function bracket(format: Format, players: number, options = {}): Bracket {
	const ids = Array.from({ length: players }, (_, i) => `p${i + 1}`)
	const r = createBracket(format, ids, options, 1)
	if (!r.ok) throw new Error(r.error.message)
	return r.value
}

const live = (n: number) => ({ kind: 'live' as const, readyUpMinutes: n })
const window = (n: number) => ({ kind: 'window' as const, durationMinutes: n })

describe('round-by-round timetable changes', () => {
	it('changes nothing without changes', () => {
		const b = bracket('single_elim', 16)
		const blocks = presetSchedule(b, 'live_event', {})
		expect(applyRoundTimings(b, blocks, undefined)).toBe(blocks)
		expect(applyRoundTimings(b, blocks, {})).toBe(blocks)
		const league = presetSchedule(b, 'league', {})
		expect(applyRoundTimings(b, league, { R9: { breakBefore: 10 } })).toEqual(league)
	})

	it('puts a break before a round and keeps the rest rolling', () => {
		// 16 players, live event without breaks: one rolling block of 4 rounds.
		const b = bracket('single_elim', 16)
		const out = applyRoundTimings(b, presetSchedule(b, 'live_event', {}), { R3: { breakBefore: 15 } })
		expect(out.map((x) => x.untilStep)).toEqual([2, 4])
		expect(out[1].start).toEqual({ kind: 'after_previous', breakMinutes: 15 })
		expect(out.every((x) => x.opening === 'rolling')).toBe(true)
		expect(validateSchedule(b, out).ok).toBe(true)
	})

	it('plays the final another way, and lets the organiser start it', () => {
		const b = bracket('single_elim', 16)
		const out = applyRoundTimings(b, presetSchedule(b, 'live_event', {}), { FINAL: { play: live(5), manualStart: true } })
		expect(out.map((x) => x.untilStep)).toEqual([3, 4])
		expect(out[1]).toMatchObject({ start: { kind: 'manual' }, play: live(5) })
		expect(validateSchedule(b, out).ok).toBe(true)
	})

	it('runs a league with live rounds from the semifinals on', () => {
		const b = bracket('single_elim', 16)
		const league = presetSchedule(b, 'league', { windowMinutes: 3 * 24 * 60 })
		const out = applyRoundTimings(b, league, { SEMI: { play: live(10), onward: true } })
		// Rounds 1-2 keep their windows; the semifinal and final are live.
		expect(out.map((x) => x.play.kind)).toEqual(['window', 'window', 'live', 'live'])
		expect(validateSchedule(b, out).ok).toBe(true)
		// A deadline in the middle of a live event opens its matches together.
		const ev = applyRoundTimings(b, presetSchedule(b, 'live_event', {}), { R2: { play: window(2 * 24 * 60) } })
		expect(ev.map((x) => [x.untilStep, x.play.kind, x.opening])).toEqual([
			[1, 'live', 'rolling'],
			[2, 'window', 'synchronized'],
			[4, 'live', 'rolling'],
		])
	})

	it('names rounds in double elimination', () => {
		// 8 players: W1 | W2+L1 | L2 | W3+L3 | L4 | GF | reset.
		const b = bracket('double_elim', 8, { grandFinalReset: true })
		const out = applyRoundTimings(b, presetSchedule(b, 'live_event', {}), { LOSERS_FINAL: { breakBefore: 10 }, FINAL: { breakBefore: 20 } })
		expect(out.map((x) => [x.untilStep, x.start])).toEqual([
			[4, { kind: 'after_previous', breakMinutes: 0 }],
			[5, { kind: 'after_previous', breakMinutes: 10 }],
			// The reset follows the grand final without another break.
			[7, { kind: 'after_previous', breakMinutes: 20 }],
		])
		expect(validateSchedule(b, out).ok).toBe(true)
	})

	it('keeps a carried way of playing through a repeated name', () => {
		const b = bracket('double_elim', 8, { grandFinalReset: true })
		const out = applyRoundTimings(b, presetSchedule(b, 'league', {}), { LOSERS_FINAL: { play: live(10), onward: true }, FINAL: { breakBefore: 20 } })
		// Losers final, grand final and reset are all live.
		expect(out.slice(-3).map((x) => x.play.kind)).toEqual(['live', 'live', 'live'])
	})

	it('continues at a set time after a long break', () => {
		const b = bracket('single_elim', 16)
		const at = Date.UTC(2027, 2, 14, 19, 0)
		const out = applyRoundTimings(b, presetSchedule(b, 'live_event', {}), { SEMI: { startAt: at } })
		expect(out.map((x) => [x.untilStep, x.start])).toEqual([
			[2, { kind: 'after_previous', breakMinutes: 0 }],
			[4, { kind: 'at', at }],
		])
		expect(validateSchedule(b, out).ok).toBe(true)
		expect(validRoundTimings({ SEMI: { startAt: 'tomorrow' } }).ok).toBe(false)
	})

	it('never breaks before round 1', () => {
		const b = bracket('single_elim', 8)
		const out = applyRoundTimings(b, presetSchedule(b, 'live_event', {}), { R1: { breakBefore: 30, manualStart: true } })
		expect(out[0].start).toEqual({ kind: 'after_previous', breakMinutes: 0 })
		expect(validateSchedule(b, out).ok).toBe(true)
	})

	it('checks what it is sent', () => {
		expect(validRoundTimings({ R3: { breakBefore: 15 }, FINAL: { play: live(5), manualStart: true, onward: false } }).ok).toBe(true)
		expect(validRoundTimings({ W3: { breakBefore: 15 } }).ok).toBe(false)
		expect(validRoundTimings({ R3: { breakBefore: -1 } }).ok).toBe(false)
		expect(validRoundTimings({ R3: { play: live(1) } }).ok).toBe(false)
		expect(validRoundTimings({ R3: { play: window(5) } }).ok).toBe(false)
		expect(validRoundTimings({ R3: { play: { kind: 'later' } } }).ok).toBe(false)
		expect(validRoundTimings([]).ok).toBe(false)
	})
})
