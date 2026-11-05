import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../infrastructure/gateways/appeal.gateway.js', () => ({
	listDecidedAppealsToTell: vi.fn(),
	markAppealNotified: vi.fn(),
	findPunishmentRef: vi.fn(),
}))
vi.mock('../../infrastructure/nakama/moderation-sync.js', () => ({
	notifyBanEndedInNakama: vi.fn(),
	notifyAppealDecidedInNakama: vi.fn(),
}))

import { readFileSync } from 'node:fs'
import { tellDecidedAppeals, tellEndedBans } from '../../features/punishments/ban-end.job.js'
import {
	listEndedBansToTell,
	markBanEndNotified,
} from '../../infrastructure/gateways/ban.gateway.js'
import {
	findPunishmentRef,
	listDecidedAppealsToTell,
	markAppealNotified,
} from '../../infrastructure/gateways/appeal.gateway.js'
import { notifyAppealDecidedInNakama, notifyBanEndedInNakama } from '../../infrastructure/nakama/moderation-sync.js'

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

describe('tellDecidedAppeals', () => {
	const appeal = (over: Record<string, unknown> = {}) =>
		({ id: 'ap1', playerId: 'p1', punishmentId: 'b1', status: 'granted', outcome: 'lifted', ...over }) as never

	it('retries a decided appeal and marks it once Nakama confirms', async () => {
		vi.mocked(listDecidedAppealsToTell).mockResolvedValue([appeal()])
		vi.mocked(findPunishmentRef).mockResolvedValue({ banType: 'chat' } as never)
		vi.mocked(notifyAppealDecidedInNakama).mockResolvedValue(true)
		expect(await tellDecidedAppeals()).toBe(1)
		expect(notifyAppealDecidedInNakama).toHaveBeenCalledWith({
			playerId: 'p1',
			appealId: 'ap1',
			accepted: true,
			target: 'chat',
			result: 'lifted',
		})
		expect(markAppealNotified).toHaveBeenCalledWith('ap1')
	})

	it('tells a declined appeal with no result, and leaves one untold when Nakama fails', async () => {
		vi.mocked(listDecidedAppealsToTell).mockResolvedValue([appeal({ status: 'denied', outcome: null, punishmentId: null })])
		vi.mocked(notifyAppealDecidedInNakama).mockResolvedValue(false)
		expect(await tellDecidedAppeals()).toBe(0)
		expect(notifyAppealDecidedInNakama).toHaveBeenCalledWith(
			expect.objectContaining({ accepted: false, target: 'network', result: null }),
		)
		expect(markAppealNotified).not.toHaveBeenCalled()
	})
})

describe('migration for the end marks', () => {
	const sql = readFileSync(new URL('../../../drizzle/0071_ban_end_notified.sql', import.meta.url), 'utf8')

	it('marks every ban already over, and every decided appeal, so the first run tells none of them', () => {
		expect(sql).toMatch(/UPDATE "player_bans" SET "end_notified_at" = now\(\) WHERE[^;]*"lifted_at" IS NOT NULL[^;]*"expires_at" <= now\(\)/)
		expect(sql).toMatch(/UPDATE "appeals" SET "notified_at" = now\(\) WHERE[^;]*"status" <> 'open'/)
	})
})
