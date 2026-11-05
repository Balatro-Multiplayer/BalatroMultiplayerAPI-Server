import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../infrastructure/gateways/ban.gateway.js', () => ({
	listEndedBansToTell: vi.fn(),
	markBanEndNotified: vi.fn(),
}))
vi.mock('../../infrastructure/nakama/moderation-sync.js', () => ({
	notifyBanEndedInNakama: vi.fn(),
}))

import { tellEndedBans } from '../../features/punishments/ban-end.job.js'
import {
	listEndedBansToTell,
	markBanEndNotified,
} from '../../infrastructure/gateways/ban.gateway.js'
import { notifyBanEndedInNakama } from '../../infrastructure/nakama/moderation-sync.js'

const ban = (id: string, banType: 'chat' | 'queue' | 'account') => ({
	id,
	playerId: `p-${id}`,
	banType,
})

beforeEach(() => {
	vi.resetAllMocks()
})

describe('tellEndedBans', () => {
	it('tells each ended ban once and marks it told', async () => {
		vi.mocked(listEndedBansToTell).mockResolvedValue([
			ban('a', 'chat'),
			ban('b', 'queue'),
			ban('c', 'account'),
		])
		vi.mocked(notifyBanEndedInNakama).mockResolvedValue(true)
		expect(await tellEndedBans()).toBe(3)
		expect(notifyBanEndedInNakama).toHaveBeenCalledTimes(3)
		expect(notifyBanEndedInNakama).toHaveBeenCalledWith(ban('c', 'account'))
		expect(vi.mocked(markBanEndNotified).mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
	})

	it('does nothing when no ban ended', async () => {
		vi.mocked(listEndedBansToTell).mockResolvedValue([])
		expect(await tellEndedBans()).toBe(0)
		expect(notifyBanEndedInNakama).not.toHaveBeenCalled()
	})

	it('leaves a ban untold when Nakama does not confirm, so the next run retries it', async () => {
		vi.mocked(listEndedBansToTell).mockResolvedValue([ban('a', 'chat'), ban('b', 'queue')])
		vi.mocked(notifyBanEndedInNakama).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
		expect(await tellEndedBans()).toBe(1)
		expect(vi.mocked(markBanEndNotified).mock.calls.map((c) => c[0])).toEqual(['a'])
	})
})
