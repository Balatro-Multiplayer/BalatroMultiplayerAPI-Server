import { describe, expect, it, vi } from 'vitest'
import { dismissAutomaticItems } from '../../features/service-queue/automatic.js'
import {
	AUTOMATIC_TYPES,
	PLAYER_MADE_TYPES,
	laneOf,
} from '../../features/service-queue/lanes.js'

const MOD = { playerId: 'mod', role: 'moderator' as const }

describe('queue lanes', () => {
	it('puts anti-cheat and integrity items in the automatic lane', () => {
		expect(laneOf('anti_cheat')).toBe('automatic')
		expect(laneOf('integrity')).toBe('automatic')
		expect([...AUTOMATIC_TYPES].sort()).toEqual(['anti_cheat', 'integrity'])
	})

	it('keeps every other type on the main tab', () => {
		expect(laneOf('report')).toBe('main')
		expect(laneOf('flagged_chat')).toBe('main')
	})

	it('treats reports, contests and appeals as made by players', () => {
		expect([...PLAYER_MADE_TYPES].sort()).toEqual(['appeal', 'contest', 'report'])
	})
})

describe('dismissAutomaticItems', () => {
	it('refuses a missing reason and dismisses nothing', async () => {
		const run = vi.fn()
		const result = await dismissAutomaticItems(
			{ openItemIds: async () => [1], run },
			'p1',
			MOD,
			'   ',
		)
		expect(result).toEqual({ ok: false, error: 'reason_required' })
		expect(run).not.toHaveBeenCalled()
	})

	it('dismisses each open item with the one reason as its note', async () => {
		const run = vi.fn(async () => ({ ok: true as const }))
		const result = await dismissAutomaticItems(
			{ openItemIds: async () => [3, 4], run },
			'p1',
			MOD,
			' known false positive ',
		)
		expect(run).toHaveBeenCalledTimes(2)
		expect(run).toHaveBeenCalledWith(3, 'dismiss', MOD, {
			note: 'known false positive',
		})
		expect(run).toHaveBeenCalledWith(4, 'dismiss', MOD, {
			note: 'known false positive',
		})
		expect(result).toEqual({ ok: true, dismissed: 2, failed: [] })
	})

	it('reports the items it could not dismiss and carries on', async () => {
		const run = vi.fn(async (id: number) =>
			id === 3
				? { ok: false as const, code: 'claimed' }
				: { ok: true as const },
		)
		const result = await dismissAutomaticItems(
			{ openItemIds: async () => [3, 4], run },
			'p1',
			MOD,
			'why',
		)
		expect(result).toEqual({
			ok: true,
			dismissed: 1,
			failed: [{ itemId: 3, code: 'claimed' }],
		})
	})
})
