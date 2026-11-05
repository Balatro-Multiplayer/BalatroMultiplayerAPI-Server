import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx, serverCtx } from '../testing/fake_nk'
import { NotificationKind } from './kinds'
import { rpcAdminSeasonEndNotify } from './season_end'
import { listNotifications } from './store'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const C = '33333333-3333-3333-3333-333333333333'

const call = (nk: any, body: unknown, ctx = serverCtx()) =>
	JSON.parse(
		rpcAdminSeasonEndNotify(ctx, fakeLogger as any, nk, JSON.stringify(body)),
	)
const asNk = (nk: unknown) => nk as nkruntime.Nakama
const board = (name: string, place: number, rating: number) => ({ name, place, rating })

describe('season end Notification', () => {
	it('tells a player on one board their place and rating', () => {
		const nk = fakeNk()
		expect(
			call(nk, {
				season: 4,
				name: 'Season 4',
				players: [{ userId: A, boards: [board('PvP Vanilla', 37, 1520)] }],
			}),
		).toEqual({ notified: 1, skipped: 0 })
		const [sent] = listNotifications(asNk(nk), A)
		expect(sent.kind).toBe(NotificationKind.SEASON_END)
		expect(sent.params).toEqual({
			season: 4,
			name: 'Season 4',
			boards: [board('PvP Vanilla', 37, 1520)],
		})
	})

	it('lists several boards in one Notification', () => {
		const nk = fakeNk()
		call(nk, {
			season: 4,
			players: [
				{ userId: A, boards: [board('PvP Balanced', 2, 1400), board('PvP Vanilla', 1, 1520)] },
			],
		})
		const sent = listNotifications(asNk(nk), A)
		expect(sent).toHaveLength(1)
		expect(sent[0].params.boards).toHaveLength(2)
		expect(sent[0].params.name).toBe('Season 4')
	})

	it('sends nothing to a player the API did not list', () => {
		const nk = fakeNk()
		call(nk, { season: 4, players: [{ userId: A, boards: [board('PvP Vanilla', 1, 1500)] }] })
		expect(listNotifications(asNk(nk), B)).toEqual([])
		expect(call(nk, { season: 4, players: [] })).toEqual({ notified: 0, skipped: 0 })
	})

	it('skips a player already told, so a repeated call sends no second one', () => {
		const nk = fakeNk()
		const players = [{ userId: A, boards: [board('PvP Vanilla', 1, 1500)] }]
		call(nk, { season: 4, players })
		expect(
			call(nk, { season: 4, players: [...players, { userId: C, boards: [board('PvP Vanilla', 2, 1400)] }] }),
		).toEqual({ notified: 1, skipped: 1 })
		expect(listNotifications(asNk(nk), A)).toHaveLength(1)
		expect(listNotifications(asNk(nk), C)).toHaveLength(1)
	})

	it('refuses a player caller and bad input', () => {
		const nk = fakeNk()
		const ok = { season: 4, players: [] }
		expect(() => call(nk, ok, playerCtx(A) as any)).toThrow()
		expect(() => call(nk, { ...ok, season: 0 })).toThrow()
		expect(() => call(nk, { season: 4, players: [{ userId: 'x', boards: [] }] })).toThrow()
		expect(() =>
			call(nk, { season: 4, players: [{ userId: A, boards: [board('', 1, 1)] }] }),
		).toThrow()
	})
})
