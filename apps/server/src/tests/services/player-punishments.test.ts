import { describe, expect, it } from 'vitest'
import { buildPunishmentList } from '../../features/punishments/player-punishments.js'

const NOW = new Date('2026-06-01T12:00:00Z')
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

const ban = (over: Record<string, unknown>) => ({
	id: 'b1',
	playerId: 'p',
	banType: 'chat',
	expiresAt: day(7),
	issuedBy: 'moderator:staff-1',
	issuedAt: day(-1),
	reason: 'Spam',
	liftedAt: null,
	liftedBy: null,
	...over,
})

describe('buildPunishmentList', () => {
	it('lists type, start, end and reason, and never the staff member', () => {
		const list = buildPunishmentList([ban({}) as any], [], NOW)
		expect(list).toEqual([
			{
				id: 'b1',
				type: 'chat_ban',
				startsAt: day(-1).toISOString(),
				endsAt: day(7).toISOString(),
				permanent: false,
				status: 'active',
				reason: 'Spam',
			},
		])
		expect(JSON.stringify(list)).not.toContain('staff-1')
	})

	it('marks a ban with no end as permanent', () => {
		const [p] = buildPunishmentList([ban({ banType: 'account', expiresAt: null }) as any], [], NOW)
		expect(p).toMatchObject({ type: 'account_ban', endsAt: null, permanent: true, status: 'active' })
	})

	it('marks an ended ban and a lifted ban', () => {
		const list = buildPunishmentList(
			[
				ban({ id: 'old', banType: 'queue', expiresAt: day(-1) }) as any,
				ban({ id: 'lifted', liftedAt: day(-0.5), liftedBy: 'admin:a' }) as any,
			],
			[],
			NOW,
		)
		expect(list.map((p) => [p.id, p.type, p.status])).toEqual([
			['old', 'queue_ban', 'ended'],
			['lifted', 'chat_ban', 'lifted'],
		])
	})

	it('lists a warning with its message as the reason, and sorts newest first', () => {
		const list = buildPunishmentList(
			[ban({ issuedAt: day(-5) }) as any],
			[{ id: 'w1', playerId: 'p', itemId: null, message: 'Be kind', issuedBy: 'moderator:x', issuedAt: day(-2) }],
			NOW,
		)
		expect(list.map((p) => p.id)).toEqual(['w1', 'b1'])
		expect(list[0]).toMatchObject({ type: 'warning', endsAt: null, permanent: false, reason: 'Be kind' })
	})
})
