import { describe, expect, it } from 'vitest'
import {
	DEFAULT_LADDER_STEPS,
	type Strike,
	appliedStepOf,
	countingStrikes,
	judgePunishment,
	parseLadderSteps,
	recommendedStep,
	stepOfExpiry,
	strikeStopsCountingAt,
} from '../../features/strikes/ladder.js'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const fresh = (): Strike => ({
	issuedAt: new Date('2026-10-01T00:00:00.000Z'),
	liftedAt: null,
})
const strikes = (n: number) => Array.from({ length: n }, fresh)
const play = DEFAULT_LADDER_STEPS.play

describe('recommendedStep', () => {
	it.each([
		[0, 'warning'],
		[1, '24h'],
		[2, '7d'],
		[3, '30d'],
		[4, 'permanent'],
		[5, 'permanent'],
	])('recommends the step for %i counting strikes', (count, step) => {
		expect(recommendedStep(play, strikes(count), NOW)).toBe(step)
	})

	it('follows the admin-edited steps', () => {
		expect(recommendedStep(['7d', 'permanent'], strikes(0), NOW)).toBe('7d')
		expect(recommendedStep(['7d', 'permanent'], strikes(1), NOW)).toBe(
			'permanent',
		)
	})
})

describe('strikes that count', () => {
	it('stops counting 3 months after it was issued', () => {
		const issuedAt = new Date('2026-07-21T12:00:00.000Z')
		expect(strikeStopsCountingAt(issuedAt)).toEqual(
			new Date('2026-10-21T12:00:00.000Z'),
		)
		expect(
			countingStrikes(
				[{ issuedAt, liftedAt: null }],
				new Date('2026-10-21T11:59:59.000Z'),
			),
		).toHaveLength(1)
		expect(
			countingStrikes(
				[{ issuedAt, liftedAt: null }],
				new Date('2026-10-21T12:00:00.000Z'),
			),
		).toHaveLength(0)
	})

	it('does not count a strike whose punishment was lifted', () => {
		const lifted = {
			...fresh(),
			liftedAt: new Date('2026-10-02T00:00:00.000Z'),
		}
		expect(countingStrikes([lifted, fresh()], NOW)).toHaveLength(1)
		expect(recommendedStep(play, [lifted], NOW)).toBe('warning')
	})

	it('moves the recommendation back when a strike decays', () => {
		const old = {
			issuedAt: new Date('2026-06-01T00:00:00.000Z'),
			liftedAt: null,
		}
		expect(recommendedStep(play, [old, fresh()], NOW)).toBe('24h')
	})
})

describe('appliedStepOf', () => {
	it('is warning for a warning and the preset for a ban', () => {
		expect(appliedStepOf({ kind: 'warning' })).toBe('warning')
		expect(appliedStepOf({ kind: 'ban', duration: '7d' })).toBe('7d')
	})
})

describe('stepOfExpiry', () => {
	it('matches a preset length, null as permanent, and anything else as custom', () => {
		const day = 24 * 3600 * 1000
		expect(stepOfExpiry(null, NOW)).toBe('permanent')
		expect(stepOfExpiry(new Date(NOW.getTime() + day), NOW)).toBe('24h')
		expect(stepOfExpiry(new Date(NOW.getTime() + 7 * day + 60_000), NOW)).toBe(
			'7d',
		)
		expect(stepOfExpiry(new Date(NOW.getTime() + 30 * day), NOW)).toBe('30d')
		expect(stepOfExpiry(new Date(NOW.getTime() + 10 * day), NOW)).toBe('custom')
	})
})

describe('parseLadderSteps', () => {
	it('accepts known steps that end in permanent', () => {
		expect(parseLadderSteps(['warning', '7d', 'permanent'])).toEqual({
			ok: true,
			steps: ['warning', '7d', 'permanent'],
		})
	})
	it.each([
		['not a list', 'x'],
		['empty', []],
		['unknown step', ['1h', 'permanent']],
		['not ending in permanent', ['warning', '7d']],
		['too long', Array(9).fill('7d').concat('permanent')],
	])('refuses %s', (_name, value) => {
		expect(parseLadderSteps(value).ok).toBe(false)
	})
})

describe('judgePunishment', () => {
	it('records the recommendation and no reason when the staff follow it', () => {
		expect(judgePunishment(play, strikes(1), NOW, '24h', null)).toEqual({
			ok: true,
			recommended: '24h',
			applied: '24h',
			deviationReason: null,
		})
	})

	it('needs a reason when the step differs', () => {
		expect(judgePunishment(play, strikes(1), NOW, '30d', null).ok).toBe(false)
		expect(judgePunishment(play, strikes(1), NOW, '30d', '  ').ok).toBe(false)
		expect(
			judgePunishment(
				play,
				strikes(1),
				NOW,
				'30d',
				'Threatened another player',
			),
		).toEqual({
			ok: true,
			recommended: '24h',
			applied: '30d',
			deviationReason: 'Threatened another player',
		})
	})

	it('treats a custom length as a different step', () => {
		expect(judgePunishment(play, strikes(0), NOW, 'custom', null).ok).toBe(
			false,
		)
	})
})
