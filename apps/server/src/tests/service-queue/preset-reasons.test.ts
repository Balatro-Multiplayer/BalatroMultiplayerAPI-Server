import { describe, expect, it } from 'vitest'
import {
	MAX_PRESET_LENGTH,
	MAX_PRESET_REASONS,
	parsePresetReasons,
} from '../../features/service-queue/preset-reasons.js'

describe('parsePresetReasons', () => {
	it('trims each note and keeps the order', () => {
		expect(parsePresetReasons(['  b ', 'a'])).toEqual({
			ok: true,
			reasons: ['b', 'a'],
		})
	})
	it('accepts an empty list', () => {
		expect(parsePresetReasons([])).toEqual({ ok: true, reasons: [] })
	})
	it('refuses empty text, a non-list, a long note, a repeat and a long list', () => {
		for (const bad of [
			['ok', '   '],
			['ok', 5],
			'text',
			['x'.repeat(MAX_PRESET_LENGTH + 1)],
			['same', ' same'],
			Array.from({ length: MAX_PRESET_REASONS + 1 }, (_, i) => `n${i}`),
		])
			expect(parsePresetReasons(bad).ok).toBe(false)
	})
	it('accepts a note at the length limit', () => {
		expect(parsePresetReasons(['x'.repeat(MAX_PRESET_LENGTH)]).ok).toBe(true)
	})
})
