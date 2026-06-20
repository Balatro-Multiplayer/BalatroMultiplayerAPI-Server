import { describe, expect, it } from 'vitest'
import {
	getMetricConfig,
	isBetterMetric,
	withinMetricBounds,
} from '../../features/matchmaking/metrics.config.js'

describe('metrics.config', () => {
	describe('getMetricConfig', () => {
		it('returns score (higher-better, client-reported) for PvP', () => {
			expect(getMetricConfig('MultiplayerPvP')).toEqual({
				kind: 'score',
				direction: 'desc',
				serverMeasured: false,
			})
		})

		it('returns time (lower-better, server-measured) for speedrun', () => {
			expect(getMetricConfig('MultiplayerSpeedrunning')).toEqual({
				kind: 'time_ms',
				direction: 'asc',
				serverMeasured: true,
			})
		})

		it('returns undefined for mods without a secondary board', () => {
			expect(getMetricConfig('SomeOtherMod')).toBeUndefined()
		})
	})

	describe('withinMetricBounds', () => {
		it('rejects negative and non-finite scores', () => {
			expect(withinMetricBounds('score', -1)).toBe(false)
			expect(withinMetricBounds('score', Number.POSITIVE_INFINITY)).toBe(false)
			expect(withinMetricBounds('score', Number.NaN)).toBe(false)
		})

		it('accepts a plausible score and rejects an absurd one', () => {
			expect(withinMetricBounds('score', 1_000_000)).toBe(true)
			expect(withinMetricBounds('score', 1e18)).toBe(false)
		})

		it('rejects times below the floor and above the ceiling', () => {
			expect(withinMetricBounds('time_ms', 500)).toBe(false)
			expect(withinMetricBounds('time_ms', 7 * 60 * 60 * 1000)).toBe(false)
		})

		it('accepts a plausible run time', () => {
			expect(withinMetricBounds('time_ms', 4 * 60 * 1000)).toBe(true)
		})
	})

	describe('isBetterMetric', () => {
		const score = { kind: 'score', direction: 'desc', serverMeasured: false } as const
		const time = { kind: 'time_ms', direction: 'asc', serverMeasured: true } as const

		it('treats any value as better than a null personal best', () => {
			expect(isBetterMetric(score, 10, null)).toBe(true)
			expect(isBetterMetric(time, 99999, undefined)).toBe(true)
		})

		it('higher is better for desc (score)', () => {
			expect(isBetterMetric(score, 200, 100)).toBe(true)
			expect(isBetterMetric(score, 50, 100)).toBe(false)
			expect(isBetterMetric(score, 100, 100)).toBe(false)
		})

		it('lower is better for asc (time)', () => {
			expect(isBetterMetric(time, 5000, 8000)).toBe(true)
			expect(isBetterMetric(time, 9000, 8000)).toBe(false)
			expect(isBetterMetric(time, 8000, 8000)).toBe(false)
		})
	})
})
