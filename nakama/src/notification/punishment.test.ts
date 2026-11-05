import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx, serverCtx } from '../testing/fake_nk'
import { NotificationKind } from './kinds'
import { rpcAdminPunishmentNotify } from './punishment'
import { listNotifications } from './store'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

const call = (nk: any, body: unknown, ctx = serverCtx()) =>
	JSON.parse(rpcAdminPunishmentNotify(ctx, fakeLogger as any, nk, JSON.stringify(body)))
const asNk = (nk: unknown) => nk as nkruntime.Nakama

describe('appeal decided Notification', () => {
	it('tells an accepted appeal and what it did', () => {
		const nk = fakeNk()
		expect(
			call(nk, {
				userId: A,
				kind: 'appeal_decided',
				key: 'appeal-1',
				params: { accepted: true, target: 'chat', result: 'lifted' },
			}),
		).toEqual({ sent: true })
		const [sent] = listNotifications(asNk(nk), A)
		expect(sent.kind).toBe(NotificationKind.APPEAL_DECIDED)
		expect(sent.params).toEqual({ accepted: true, target: 'chat', result: 'lifted' })
	})

	it('tells a declined appeal with no result', () => {
		const nk = fakeNk()
		call(nk, {
			userId: A,
			kind: 'appeal_decided',
			key: 'appeal-2',
			params: { accepted: false, target: 'queue', result: 'lifted' },
		})
		const [sent] = listNotifications(asNk(nk), A)
		expect(sent.params).toEqual({ accepted: false, target: 'queue', result: null })
	})

	it('sends once for the same appeal', () => {
		const nk = fakeNk()
		const body = {
			userId: A,
			kind: 'appeal_decided',
			key: 'appeal-1',
			params: { accepted: true, target: 'account', result: 'shortened' },
		}
		expect(call(nk, body)).toEqual({ sent: true })
		expect(call(nk, body)).toEqual({ sent: false })
		expect(listNotifications(asNk(nk), A)).toHaveLength(1)
	})

	it('refuses an accepted appeal with no result', () => {
		expect(() =>
			call(fakeNk(), {
				userId: A,
				kind: 'appeal_decided',
				key: 'k',
				params: { accepted: true, target: 'chat' },
			}),
		).toThrow()
	})
})

describe('punishment ended Notification', () => {
	const ended = (ban: string, key = 'ban-1', userId = A) => ({
		userId,
		kind: 'punishment_ended',
		key,
		params: { ban },
	})

	it.each(['chat', 'queue', 'account'])('tells a %s ban ended', (ban) => {
		const nk = fakeNk()
		expect(call(nk, ended(ban))).toEqual({ sent: true })
		const [sent] = listNotifications(asNk(nk), A)
		expect(sent.kind).toBe(NotificationKind.PUNISHMENT_ENDED)
		expect(sent.params).toEqual({ ban })
	})

	it('sends once per ban and per player', () => {
		const nk = fakeNk()
		call(nk, ended('chat'))
		expect(call(nk, ended('chat'))).toEqual({ sent: false })
		expect(call(nk, ended('chat', 'ban-1', B))).toEqual({ sent: true })
		expect(call(nk, ended('chat', 'ban-2'))).toEqual({ sent: true })
		expect(listNotifications(asNk(nk), A)).toHaveLength(2)
	})

	it('does not treat an appeal and a ban with the same id as one', () => {
		const nk = fakeNk()
		call(nk, ended('chat', 'x'))
		expect(
			call(nk, { userId: A, kind: 'appeal_decided', key: 'x', params: { accepted: false, target: 'chat' } }),
		).toEqual({ sent: true })
	})

	it('refuses an unknown ban kind, a bad user and a player caller', () => {
		expect(() => call(fakeNk(), ended('warning'))).toThrow()
		expect(() => call(fakeNk(), ended('chat', 'k', 'nope'))).toThrow()
		expect(() => call(fakeNk(), ended('chat'), playerCtx(A))).toThrow()
	})
})
