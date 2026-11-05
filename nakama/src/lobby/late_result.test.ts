import { describe, expect, it } from 'vitest'
import { NotificationKind } from '../notification/kinds'
import { listNotifications } from '../notification/store'
import { NotifyCode } from '../notify'
import { fakeNk } from '../testing/fake_nk'
import {
	lateResultContent,
	rankedResultContent,
	sendLateResults,
	sendRankedResults,
} from './late_result'
import type { RunRecord } from './protocol'

const run = {
	runId: 'r1',
	code: 'ABC123',
	modId: 'MultiplayerPvP',
	status: 'partial',
	placements: [
		{ playerId: 'b', place: 1 },
		{ playerId: 'a', place: 2 },
	],
	ratings: {
		a: { delta: -12, newRating: 988, isPlacement: false, gamesPlayed: 9 },
	},
} as unknown as RunRecord

describe('lateResultContent', () => {
	it('carries the place and the rating change of the player who left', () => {
		expect(lateResultContent(run, 'a')).toEqual({
			runId: 'r1',
			code: 'ABC123',
			modId: 'MultiplayerPvP',
			status: 'partial',
			place: 2,
			rating: {
				delta: -12,
				newRating: 988,
				isPlacement: false,
				gamesPlayed: 9,
			},
		})
	})

	it('has a null rating for an unrated run', () => {
		expect(lateResultContent(run, 'b').rating).toBeNull()
	})
})

describe('sendLateResults', () => {
	it('stores a RESULT_LATE Notification for each player owed one, and pushes it live', () => {
		const nk = fakeNk()
		sendLateResults(nk as unknown as nkruntime.Nakama, run, ['a'])
		const waiting = listNotifications(nk as unknown as nkruntime.Nakama, 'a')
		expect(waiting).toHaveLength(1)
		expect(waiting[0].kind).toBe(NotificationKind.RESULT_LATE)
		expect((waiting[0].params as { place: number }).place).toBe(2)
		expect(nk.notifications).toHaveLength(1)
		expect(nk.notifications[0].code).toBe(NotifyCode.NOTIFICATION)
		expect(nk.notifications[0].persistent).toBe(false)
		expect(
			listNotifications(nk as unknown as nkruntime.Nakama, 'b'),
		).toHaveLength(0)
	})
})

describe('ranked results', () => {
	const ranked = {
		...run,
		rankedMode: 'ranked',
		players: [{ id: 'a' }, { id: 'b' }],
		ratings: {
			a: { delta: -12, newRating: 988, isPlacement: false, gamesPlayed: 9 },
			b: { delta: 12, newRating: 1012, isPlacement: false, gamesPlayed: 9 },
		},
	} as unknown as RunRecord
	const collect = (r: RunRecord) => {
		const nk = fakeNk()
		sendRankedResults(nk as unknown as nkruntime.Nakama, r)
		return nk
	}
	const told = (nk: ReturnType<typeof fakeNk>, id: string) =>
		listNotifications(nk as unknown as nkruntime.Nakama, id)

	it('stores a RESULT_RANKED Notification with the rating change for every rated player', () => {
		const nk = collect(ranked)
		expect(told(nk, 'a').map((n) => n.kind)).toEqual([
			NotificationKind.RESULT_RANKED,
		])
		expect(told(nk, 'b')).toHaveLength(1)
		expect(
			(told(nk, 'a')[0].params as { rating: { delta: number } }).rating.delta,
		).toBe(-12)
	})

	it('carries the number of players', () => {
		expect(rankedResultContent(ranked, 'a').players).toBe(2)
	})

	it('says tied when first place is shared', () => {
		const drawn = {
			...ranked,
			placements: [
				{ playerId: 'a', place: 1 },
				{ playerId: 'b', place: 1 },
			],
		} as unknown as RunRecord
		expect(rankedResultContent(drawn, 'a').tied).toBe(true)
		expect(rankedResultContent(ranked, 'a').tied).toBe(false)
	})

	it('sends nothing for an unranked run or a player with no rating', () => {
		const unranked = collect({
			...ranked,
			rankedMode: null,
		} as unknown as RunRecord)
		expect(told(unranked, 'a')).toHaveLength(0)
		const partial = {
			...ranked,
			ratings: {
				a: { delta: -12, newRating: 988, isPlacement: false, gamesPlayed: 9 },
			},
		} as unknown as RunRecord
		const nk = collect(partial)
		expect(told(nk, 'a')).toHaveLength(1)
		expect(told(nk, 'b')).toHaveLength(0)
	})
})
