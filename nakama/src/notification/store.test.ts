import { describe, expect, it } from 'vitest'
import { NotifyCode } from '../notify'
import { fakeLogger, fakeNk, playerCtx, serverCtx } from '../testing/fake_nk'
import { NotificationKind } from './kinds'
import { rpcAdminReportAction, rpcNotificationsPending, rpcNotificationsRead } from './rpc'
import {
	MAX_STORED_NOTIFICATIONS,
	NOTIFICATION_TTL_MS,
	listNotifications,
	markNotificationsRead,
	sendNotification,
} from './store'

const asNk = (nk: unknown) => nk as nkruntime.Nakama
const late = {
	runId: 'r',
	code: 'C',
	modId: 'm',
	status: 'partial',
	place: 2,
	rating: null,
}
const DAY = 24 * 60 * 60 * 1000

describe('Notification store', () => {
	it('stores a Notification and pushes it live with the same id', () => {
		const nk = fakeNk()
		const sent = sendNotification(
			asNk(nk),
			'a',
			NotificationKind.RESULT_LATE,
			late,
			1000,
		)
		expect(nk.notifications).toHaveLength(1)
		expect(nk.notifications[0].code).toBe(NotifyCode.NOTIFICATION)
		expect(nk.notifications[0].userId).toBe('a')
		expect(nk.notifications[0].content).toMatchObject({
			id: sent.id,
			kind: 'result_late',
			sentAt: 1000,
		})
		expect(listNotifications(asNk(nk), 'a', 2000)).toEqual([sent])
	})

	it('lists oldest first and only for the owner', () => {
		const nk = fakeNk()
		sendNotification(asNk(nk), 'a', NotificationKind.RESULT_LATE, late, 3000)
		sendNotification(
			asNk(nk),
			'a',
			NotificationKind.RESULT_RANKED,
			{ ...late, tied: false, players: 2 },
			1000,
		)
		sendNotification(asNk(nk), 'b', NotificationKind.RESULT_LATE, late, 2000)
		expect(listNotifications(asNk(nk), 'a', 4000).map((n) => n.sentAt)).toEqual(
			[1000, 3000],
		)
		expect(listNotifications(asNk(nk), 'b', 4000)).toHaveLength(1)
	})

	it('marks read: a read Notification is never listed again', () => {
		const nk = fakeNk()
		const first = sendNotification(
			asNk(nk),
			'a',
			NotificationKind.RESULT_LATE,
			late,
			1000,
		)
		const second = sendNotification(
			asNk(nk),
			'a',
			NotificationKind.RESULT_LATE,
			late,
			2000,
		)
		markNotificationsRead(asNk(nk), 'a', [first.id])
		expect(listNotifications(asNk(nk), 'a', 3000).map((n) => n.id)).toEqual([
			second.id,
		])
	})

	it('drops a Notification unread for 30 days, and keeps one just under', () => {
		const nk = fakeNk()
		sendNotification(asNk(nk), 'a', NotificationKind.RESULT_LATE, late, 0)
		const kept = sendNotification(
			asNk(nk),
			'a',
			NotificationKind.RESULT_LATE,
			late,
			1 * DAY,
		)
		expect(
			listNotifications(asNk(nk), 'a', NOTIFICATION_TTL_MS - 1),
		).toHaveLength(2)
		expect(
			listNotifications(asNk(nk), 'a', NOTIFICATION_TTL_MS).map((n) => n.id),
		).toEqual([kept.id])
		expect(nk.objects.size).toBe(1)
	})

	it('sending drops the expired ones and caps what waits', () => {
		const nk = fakeNk()
		sendNotification(asNk(nk), 'a', NotificationKind.RESULT_LATE, late, 0)
		sendNotification(
			asNk(nk),
			'a',
			NotificationKind.RESULT_LATE,
			late,
			31 * DAY,
		)
		expect(nk.objects.size).toBe(1)
		for (let i = 0; i < MAX_STORED_NOTIFICATIONS + 5; i++)
			sendNotification(
				asNk(nk),
				'a',
				NotificationKind.RESULT_LATE,
				late,
				31 * DAY + i,
			)
		expect(nk.objects.size).toBe(MAX_STORED_NOTIFICATIONS)
	})
})

describe('Notification RPCs', () => {
	it('pending lists the caller unread, read removes them', () => {
		const nk = fakeNk()
		const sent = sendNotification(
			asNk(nk),
			'a',
			NotificationKind.RESULT_LATE,
			late,
		)
		const ctx = playerCtx('a')
		const listed = JSON.parse(
			rpcNotificationsPending(ctx, fakeLogger, asNk(nk), ''),
		)
		expect(listed.notifications.map((n: { id: string }) => n.id)).toEqual([
			sent.id,
		])
		rpcNotificationsRead(
			ctx,
			fakeLogger,
			asNk(nk),
			JSON.stringify({ ids: [sent.id] }),
		)
		expect(
			JSON.parse(rpcNotificationsPending(ctx, fakeLogger, asNk(nk), ''))
				.notifications,
		).toEqual([])
	})

	it('read cannot remove another player Notification', () => {
		const nk = fakeNk()
		const sent = sendNotification(
			asNk(nk),
			'a',
			NotificationKind.RESULT_LATE,
			late,
		)
		rpcNotificationsRead(
			playerCtx('b'),
			fakeLogger,
			asNk(nk),
			JSON.stringify({ ids: [sent.id] }),
		)
		expect(listNotifications(asNk(nk), 'a')).toHaveLength(1)
	})

	it('read refuses bad ids and a server call', () => {
		const nk = fakeNk()
		expect(() =>
			rpcNotificationsRead(playerCtx('a'), fakeLogger, asNk(nk), '{"ids":[1]}'),
		).toThrow()
		expect(() =>
			rpcNotificationsPending(
				{ userId: '' } as nkruntime.Context,
				fakeLogger,
				asNk(nk),
				'',
			),
		).toThrow()
	})
})

describe('report action Notification', () => {
	it('stores one report_action Notification for the user', () => {
		const nk = fakeNk()
		rpcAdminReportAction(serverCtx(), fakeLogger, asNk(nk), JSON.stringify({ userId: 'a' }))
		expect(nk.notifications).toHaveLength(1)
		expect(nk.notifications[0].userId).toBe('a')
		expect(nk.notifications[0].content).toMatchObject({ kind: 'report_action' })
	})

	it('refuses a player caller and a missing user', () => {
		const nk = fakeNk()
		expect(() => rpcAdminReportAction(playerCtx('a'), fakeLogger, asNk(nk), '{"userId":"a"}')).toThrow(/server/)
		expect(() => rpcAdminReportAction(serverCtx(), fakeLogger, asNk(nk), '{}')).toThrow()
	})
})
