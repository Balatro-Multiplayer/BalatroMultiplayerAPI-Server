import { describe, expect, it } from 'vitest'
import { RATINGS_COLLECTION } from '../lobby/protocol'
import { fakeLogger, fakeNk, playerCtx, serverCtx } from '../testing/fake_nk'
import { NotificationKind } from './kinds'
import { rpcAdminSeasonEndNotify } from './season_end'
import { listNotifications } from './store'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const C = '33333333-3333-3333-3333-333333333333'

const record = (rating: number, wins = 3, gamesPlayed = 8) => ({
	rating,
	wins,
	losses: 1,
	gamesPlayed,
	seasonBest: null,
	lastMatchAt: 1,
})

function put(nk: any, key: string, userId: string, value: unknown) {
	nk.objects.set(`${RATINGS_COLLECTION}/${userId}/${key}`, { value, version: 1 })
}

const call = (nk: any, body: unknown, ctx = serverCtx()) =>
	JSON.parse(
		rpcAdminSeasonEndNotify(ctx, fakeLogger as any, nk, JSON.stringify(body)),
	)
const asNk = (nk: unknown) => nk as nkruntime.Nakama

describe('season end Notification', () => {
	it('tells a player on one board their place and rating', () => {
		const nk = fakeNk()
		put(nk, 'pvp:solo:4', A, record(1520))
		put(nk, 'pvp:solo:4', B, record(1700))
		expect(call(nk, { season: 4, name: 'Season 4' })).toEqual({
			notified: 2,
			repeated: false,
		})
		const [sent] = listNotifications(asNk(nk), A)
		expect(sent.kind).toBe(NotificationKind.SEASON_END)
		expect(sent.params).toEqual({
			season: 4,
			name: 'Season 4',
			boards: [{ modId: 'pvp', mode: 'solo', place: 2, rating: 1520 }],
		})
	})

	it('lists several boards in one Notification', () => {
		const nk = fakeNk()
		put(nk, 'pvp:solo:4', A, record(1520))
		put(nk, 'pvp:ranked:team:4', A, record(1400))
		put(nk, 'pvp:ranked:team:4', B, record(1450))
		call(nk, { season: 4 })
		const sent = listNotifications(asNk(nk), A)
		expect(sent).toHaveLength(1)
		expect(sent[0].params.boards).toEqual([
			{ modId: 'pvp', mode: 'ranked:team', place: 2, rating: 1400 },
			{ modId: 'pvp', mode: 'solo', place: 1, rating: 1520 },
		])
	})

	it('sends nothing to a player with no ranked entry', () => {
		const nk = fakeNk()
		put(nk, 'pvp:solo:4', A, record(1520))
		put(nk, 'pvp:solo:4', B, record(1300, 0, 3))
		put(nk, 'pvp:solo:3', C, record(1800))
		expect(call(nk, { season: 4 }).notified).toBe(1)
		expect(listNotifications(asNk(nk), B)).toEqual([])
		expect(listNotifications(asNk(nk), C)).toEqual([])
	})

	it('breaks a rating tie by wins', () => {
		const nk = fakeNk()
		put(nk, 'pvp:solo:4', A, record(1500, 2))
		put(nk, 'pvp:solo:4', B, record(1500, 5))
		call(nk, { season: 4 })
		expect(listNotifications(asNk(nk), B)[0].params.boards).toMatchObject([
			{ place: 1 },
		])
	})

	it('tells a season once', () => {
		const nk = fakeNk()
		put(nk, 'pvp:solo:4', A, record(1520))
		call(nk, { season: 4 })
		expect(call(nk, { season: 4 })).toEqual({ notified: 0, repeated: true })
		expect(listNotifications(asNk(nk), A)).toHaveLength(1)
	})

	it('refuses a player and a bad season', () => {
		const nk = fakeNk()
		expect(() => call(nk, { season: 4 }, playerCtx(A) as any)).toThrow()
		expect(() => call(nk, { season: 0 })).toThrow()
	})
})
