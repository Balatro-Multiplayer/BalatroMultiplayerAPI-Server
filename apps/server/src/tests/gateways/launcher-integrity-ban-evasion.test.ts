import { describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import { findBanEvasionMatches } from '../../infrastructure/gateways/launcher-integrity.gateway.js'

// findBanEvasionMatches() makes exactly two db calls: a selectDistinct for
// currently-banned player IDs, then (only if that's non-empty) a select with
// a self-join for the actual matches. Mocked at that level, same
// chain-mocking convention mods-gateway.test.ts already uses for this
// codebase's other multi-step Drizzle queries - the query itself was
// separately verified against a real local Postgres instance while
// implementing this (real shared-component/active-ban/unrelated-player
// cases all behaved correctly), so this test's job is the function's own
// grouping/sorting logic once rows come back, not the SQL itself.
function mockBannedIds(ids: string[]) {
	;(db as any).selectDistinct = vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(ids.map((playerId) => ({ playerId }))),
		}),
	})
}

function mockJoinRows(rows: unknown[]) {
	;(db as any).select = vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			innerJoin: vi.fn().mockReturnThis(),
			where: vi.fn().mockResolvedValue(rows),
		}),
	})
}

describe('findBanEvasionMatches', () => {
	it('returns no matches and skips the join query when nobody is currently banned', async () => {
		mockBannedIds([])
		const joinSpy = vi.fn()
		;(db as any).select = joinSpy

		const matches = await findBanEvasionMatches()

		expect(matches).toEqual([])
		expect(joinSpy).not.toHaveBeenCalled()
	})

	it('groups rows by (bannedPlayerId, matchedPlayerId), collecting every shared component with its hash', async () => {
		mockBannedIds(['p1'])
		mockJoinRows([
			{
				bannedPlayerId: 'p1',
				bannedPlayerName: 'Banned',
				matchedPlayerId: 'p2',
				matchedPlayerName: 'Matched',
				componentName: 'machine_guid',
				componentHash: 'hash-guid',
			},
			{
				bannedPlayerId: 'p1',
				bannedPlayerName: 'Banned',
				matchedPlayerId: 'p2',
				matchedPlayerName: 'Matched',
				componentName: 'disk_serial',
				componentHash: 'hash-disk',
			},
		])

		const matches = await findBanEvasionMatches()

		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({
			bannedPlayerId: 'p1',
			matchedPlayerId: 'p2',
			matchedPlayerHasActiveBan: false,
		})
		expect(
			[...matches[0].matchedComponents].sort((a, b) =>
				a.componentName.localeCompare(b.componentName),
			),
		).toEqual([
			{ componentName: 'disk_serial', componentHash: 'hash-disk' },
			{ componentName: 'machine_guid', componentHash: 'hash-guid' },
		])
	})

	it('marks matchedPlayerHasActiveBan true when the matched player is also currently banned', async () => {
		mockBannedIds(['p1', 'p2'])
		mockJoinRows([
			{
				bannedPlayerId: 'p1',
				bannedPlayerName: 'Banned',
				matchedPlayerId: 'p2',
				matchedPlayerName: 'AlsoBanned',
				componentName: 'mac_address',
				componentHash: 'hash-mac',
			},
		])

		const matches = await findBanEvasionMatches()

		expect(matches[0].matchedPlayerHasActiveBan).toBe(true)
	})

	it('sorts matches by shared-component count, descending', async () => {
		mockBannedIds(['p1'])
		mockJoinRows([
			{
				bannedPlayerId: 'p1',
				bannedPlayerName: 'B',
				matchedPlayerId: 'weak',
				matchedPlayerName: 'Weak',
				componentName: 'mac_address',
				componentHash: 'hash-mac',
			},
			{
				bannedPlayerId: 'p1',
				bannedPlayerName: 'B',
				matchedPlayerId: 'strong',
				matchedPlayerName: 'Strong',
				componentName: 'machine_guid',
				componentHash: 'hash-guid',
			},
			{
				bannedPlayerId: 'p1',
				bannedPlayerName: 'B',
				matchedPlayerId: 'strong',
				matchedPlayerName: 'Strong',
				componentName: 'disk_serial',
				componentHash: 'hash-disk',
			},
		])

		const matches = await findBanEvasionMatches()

		expect(matches.map((m) => m.matchedPlayerId)).toEqual(['strong', 'weak'])
	})
})
