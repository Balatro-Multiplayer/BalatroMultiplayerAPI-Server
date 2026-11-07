import { describe, expect, it } from 'vitest'
import { appealStateOf, buildPunishmentList } from '../../features/punishments/player-punishments.js'

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
				appeal: null,
				canAppeal: true,
				appealAvailableAt: null,
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

const appeal = (over: Record<string, unknown>) => ({
	id: 'a1',
	playerId: 'p',
	targetKind: 'punishment',
	punishmentId: 'b1',
	networkBanIds: [],
	message: 'Please',
	status: 'open',
	decisionReason: null,
	outcome: null,
	decidedBy: null,
	decidedAt: null,
	createdAt: day(-1),
	...over,
})

describe('appeals on the punishment list', () => {
	it('shows an open appeal and offers no second one', () => {
		const [p] = buildPunishmentList([ban({}) as any], [], NOW, [appeal({}) as any])
		expect(p).toMatchObject({ canAppeal: false, appeal: { status: 'open', reason: null } })
	})

	it('shows the reason of a denial, and when the player can appeal again, without the staff name', () => {
		const denied = appeal({ status: 'denied', decisionReason: 'Chat logs are clear', decidedAt: day(-2), decidedBy: 'moderator:staff-9' })
		const [p] = buildPunishmentList([ban({}) as any], [], NOW, [denied as any])
		expect(p).toMatchObject({
			canAppeal: false,
			appeal: { status: 'denied', reason: 'Chat logs are clear' },
			appealAvailableAt: day(28).toISOString(),
		})
		expect(JSON.stringify(p)).not.toContain('staff-9')
	})

	it('offers another appeal once 30 days have passed', () => {
		const denied = appeal({ status: 'denied', decisionReason: 'No', decidedAt: day(-31) })
		const [p] = buildPunishmentList([ban({}) as any], [], NOW, [denied as any])
		expect(p).toMatchObject({ canAppeal: true, appeal: { status: 'denied' }, appealAvailableAt: null })
	})

	it('offers no appeal for a lifted punishment, and counts a lifted warning as lifted', () => {
		const list = buildPunishmentList(
			[ban({ liftedAt: day(-1) }) as any],
			[{ id: 'w1', playerId: 'p', itemId: null, message: 'm', issuedBy: 'x:y', issuedAt: day(-2), liftedAt: day(-1), liftedBy: 'admin:a' }],
			NOW,
		)
		expect(list.map((p) => [p.status, p.canAppeal])).toEqual([
			['lifted', false],
			['lifted', false],
		])
	})

	it('reads the appeal of the network ban the same way', () => {
		const state = appealStateOf([appeal({ targetKind: 'network_ban', punishmentId: null, status: 'granted', decisionReason: 'Shared address', decidedAt: day(-1), outcome: 'lifted' }) as any], NOW)
		expect(state).toMatchObject({ appeal: { status: 'granted', reason: 'Shared address' }, canAppeal: false })
	})
})
