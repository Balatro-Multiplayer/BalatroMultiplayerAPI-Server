import { describe, expect, it } from 'vitest'
import { RUNS_COLLECTION, SYSTEM_USER_ID } from '../lobby/protocol'
import { fakeLogger, fakeNk, playerCtx, serverCtx } from '../testing/fake_nk'
import { outcomeOf, rpcAdminContestWithdrawn } from './contest_withdrawn'

const asNk = (nk: unknown) => nk as nkruntime.Nakama

function runWith(nk: ReturnType<typeof fakeNk>, placements: { playerId: string; place: number }[]) {
	nk.storageWrite([
		{
			collection: RUNS_COLLECTION,
			key: 'run1',
			userId: SYSTEM_USER_ID,
			value: {
				runId: 'run1',
				players: placements.map((p) => ({ id: p.playerId })),
				placements,
			},
		},
	])
}

describe('outcomeOf', () => {
	it('is a win on the best place, a loss behind it, a draw when all tie', () => {
		const placed = [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 2 },
		]
		expect(outcomeOf(placed, 'a')).toBe('win')
		expect(outcomeOf(placed, 'b')).toBe('loss')
		expect(outcomeOf([{ playerId: 'a', place: 1 }, { playerId: 'b', place: 1 }], 'a')).toBe('draw')
		expect(outcomeOf(placed, 'z')).toBeNull()
	})
})

describe('admin_contest_withdrawn', () => {
	it('tells every other player their result, and not the contester', () => {
		const nk = fakeNk()
		runWith(nk, [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 1 },
			{ playerId: 'c', place: 2 },
		])
		const reply = JSON.parse(
			rpcAdminContestWithdrawn(serverCtx(), fakeLogger, asNk(nk), JSON.stringify({ runId: 'run1', contesterId: 'c' })),
		)
		expect(reply.told).toBe(2)
		const sent = nk.notifications.map((n) => [n.userId, n.content.kind, (n.content.params as { outcome: string }).outcome])
		expect(sent).toEqual([
			['a', 'contest_withdrawn', 'win'],
			['b', 'contest_withdrawn', 'win'],
		])
	})

	it('refuses a player session', () => {
		const nk = fakeNk()
		runWith(nk, [{ playerId: 'a', place: 1 }, { playerId: 'b', place: 2 }])
		expect(() =>
			rpcAdminContestWithdrawn(playerCtx('a'), fakeLogger, asNk(nk), JSON.stringify({ runId: 'run1', contesterId: 'b' })),
		).toThrow()
	})
})
