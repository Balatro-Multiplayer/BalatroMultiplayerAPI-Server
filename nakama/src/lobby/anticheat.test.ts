import { describe, expect, it } from 'vitest'
import { MIN_MS_PER_HAND, handCount, runFlags } from './anticheat'
import type { RunRecord } from './protocol'
import { eventsOf, type LogEvent } from '../shared/replay/events'

function log(...opcodes: string[]): LogEvent[] {
	const lines = opcodes.map((op, t) => JSON.stringify([t, op, null]))
	return eventsOf({ lines, bytes: 0, truncated: false })
}

const run = (elapsedMs: number) =>
	({
		runId: 'r',
		startedAt: 1000,
		endedAt: 1000 + elapsedMs,
		players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
	}) as unknown as RunRecord

describe('anti-cheat flags', () => {
	it('counts scored hands', () => {
		expect(handCount(log('match_manifest', 'hand_result', 'play', 'hand_result'))).toBe(2)
		expect(handCount(undefined)).toBe(0)
	})

	it('flags a hash mismatch, then hands faster than the game allows', () => {
		const logs = { a: log('hand_result', 'hand_result'), b: log('hand_result', 'hand_result', 'hand_result'), c: log('hand_result') }
		const flags = runFlags(run(2 * MIN_MS_PER_HAND), logs, { a: 'match', b: 'match', c: 'mismatch' })
		expect(flags).toEqual({ b: 'elapsed_time_gate', c: 'hash_mismatch' })
	})

	it('flags a ranked player who reported and whose log is missing, cut off or could not be checked', () => {
		const ranked = { ...run(60_000), rankedMode: 'nemesis', status: 'agreed', reports: { a: [], b: [], c: [] } } as unknown as RunRecord
		const flags = runFlags(ranked, { a: log('hand_result') }, { a: 'match', b: 'unavailable', c: 'mismatch' })
		expect(flags).toEqual({ b: 'unverified_log', c: 'hash_mismatch' })
	})

	it('gives an incomplete log no hash mismatch, only an unverified log when it was reported', () => {
		const ranked = { ...run(60_000), rankedMode: 'nemesis', status: 'agreed', reports: { a: [] } } as unknown as RunRecord
		expect(runFlags(ranked, {}, { a: 'incomplete', b: 'incomplete', c: 'match' })).toEqual({ a: 'unverified_log' })
		expect(runFlags(run(60_000), {}, { a: 'incomplete', b: 'incomplete', c: 'match' })).toEqual({})
	})

	it('flags nobody in a clean game', () => {
		expect(runFlags(run(60_000), { a: log('hand_result') }, { a: 'match', b: 'unavailable', c: 'match' })).toEqual({})
	})

	describe('unverified log', () => {
		const ranked = (status: string, reports: object) =>
			({ ...run(60_000), rankedMode: 'nemesis', status, reports }) as unknown as RunRecord
		const unavailable = { a: 'unavailable', b: 'unavailable', c: 'unavailable' } as const

		it('is not flagged in a restarted or abandoned game', () => {
			for (const status of ['restarted', 'abandoned'])
				expect(runFlags(ranked(status, { a: [], b: [], c: [] }), {}, unavailable)).toEqual({})
		})

		it('is not flagged for a player who sent no result', () => {
			expect(runFlags(ranked('partial', { a: [] }), {}, unavailable)).toEqual({ a: 'unverified_log' })
		})

		it('is flagged for a player who reported, in a game that settled', () => {
			expect(runFlags(ranked('agreed', { b: [] }), {}, unavailable)).toEqual({ b: 'unverified_log' })
		})

		it('still flags a hash mismatch in a restarted game', () => {
			expect(runFlags(ranked('restarted', {}), {}, { a: 'mismatch', b: 'match', c: 'match' })).toEqual({ a: 'hash_mismatch' })
		})
	})
})
