import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../infrastructure/gateways/rating.gateway.js', () => ({
	checkSeasonRollover: vi.fn(),
}))
vi.mock('../../infrastructure/nakama/season-sync.js', () => ({
	notifySeasonEndInNakama: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../infrastructure/gateways/config.gateway.js', () => ({
	loadConfigFromDb: vi.fn().mockResolvedValue(undefined),
}))

import { rollSeasons } from '../../features/ratings/season.job.js'
import { loadConfigFromDb } from '../../infrastructure/gateways/config.gateway.js'
import { notifySeasonEndInNakama } from '../../infrastructure/nakama/season-sync.js'
import { checkSeasonRollover } from '../../infrastructure/gateways/rating.gateway.js'

beforeEach(() => {
	vi.mocked(loadConfigFromDb).mockClear()
	vi.mocked(notifySeasonEndInNakama).mockClear()
})

describe('rollSeasons', () => {
	it('reloads the config, pushing the new season to Nakama, after a rollover', async () => {
		vi.mocked(checkSeasonRollover).mockResolvedValue([{ id: 4, name: 'Season 4' }])
		expect(await rollSeasons()).toBe(1)
		expect(loadConfigFromDb).toHaveBeenCalledOnce()
	})

	it('tells Nakama about each ended season', async () => {
		vi.mocked(checkSeasonRollover).mockResolvedValue([
			{ id: 3, name: 'Season 3' },
			{ id: 4, name: 'Season 4' },
		])
		await rollSeasons()
		expect(vi.mocked(notifySeasonEndInNakama).mock.calls.map(([s]) => s.id)).toEqual([3, 4])
	})

	it('leaves the config alone when no season expired', async () => {
		vi.mocked(checkSeasonRollover).mockResolvedValue([])
		expect(await rollSeasons()).toBe(0)
		expect(loadConfigFromDb).not.toHaveBeenCalled()
		expect(notifySeasonEndInNakama).not.toHaveBeenCalled()
	})
})
