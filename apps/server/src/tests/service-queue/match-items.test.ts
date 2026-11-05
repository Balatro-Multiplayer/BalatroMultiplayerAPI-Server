import { describe, expect, it, vi } from 'vitest'
import {
	type MatchItemsDeps,
	type OpenItem,
	mayEditMatch,
	resolveItemsOfVoid,
} from '../../features/service-queue/match-items.js'

const item = (id: number, itemType: string, sourceId = String(id)): OpenItem => ({
	id,
	itemType,
	sourceId,
	subjectPlayerId: null,
	status: 'open',
	claimedBy: null,
	claimedUntil: null,
})

function fakeDeps(items: OpenItem[], open = true) {
	const deps = {
		hasOpenItemFor: vi.fn(async () => open),
		openItems: vi.fn(async () => items),
		markResolved: vi.fn(async () => true),
		setSourceStatus: vi.fn(async () => true),
		recordEvent: vi.fn(async () => {}),
		enqueue: vi.fn(),
		now: () => new Date('2026-11-04T10:00:00Z'),
	}
	return deps satisfies MatchItemsDeps<string>
}

describe('who may edit a match', () => {
	it('lets an admin always, without asking about items', async () => {
		const deps = fakeDeps([], false)
		expect(await mayEditMatch(deps, 'admin', 'r')).toBe(true)
		expect(deps.hasOpenItemFor).not.toHaveBeenCalled()
	})

	it('lets a moderator only with an open item', async () => {
		expect(await mayEditMatch(fakeDeps([], true), 'moderator', 'r')).toBe(true)
		expect(await mayEditMatch(fakeDeps([], false), 'moderator', 'r')).toBe(false)
	})
})

describe('resolving the items of a void', () => {
	it('closes each open item with the action void and the same note', async () => {
		const deps = fakeDeps([item(1, 'report'), item(2, 'forfeit_reconciliation'), item(3, 'contest', 'r')])
		const closed = await resolveItemsOfVoid(deps, 'tx', 'r', { playerId: 'a', role: 'admin' }, 'cheat')
		expect(closed).toEqual([1, 2, 3])
		expect(deps.markResolved.mock.calls.map((c) => c.slice(1, 5))).toEqual([
			[1, 'admin:a', 'cheat', expect.any(Date)],
			[2, 'admin:a', 'cheat', expect.any(Date)],
			[3, 'admin:a', 'cheat', expect.any(Date)],
		])
		// A report follows as resolved, a forfeit flag as voided, a contest has no source row.
		expect(deps.setSourceStatus.mock.calls.map((c) => [c[1].id, c[2]])).toEqual([
			[1, 'resolved'],
			[2, 'voided'],
		])
		expect(deps.recordEvent).toHaveBeenCalledTimes(3)
	})

	it('skips an item someone closed in the meantime', async () => {
		const deps = fakeDeps([item(1, 'report'), item(2, 'report')])
		deps.markResolved.mockResolvedValueOnce(false)
		const closed = await resolveItemsOfVoid(deps, 'tx', 'r', { playerId: 'a', role: 'moderator' }, 'n')
		expect(closed).toEqual([2])
		expect(deps.setSourceStatus).toHaveBeenCalledTimes(1)
	})
})
