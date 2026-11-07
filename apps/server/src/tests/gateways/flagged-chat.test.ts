import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../infrastructure/db/index.js'
import { addToFlaggedChatItem } from '../../infrastructure/gateways/flagged-chat.gateway.js'

// A drizzle builder stand-in: every method chains, awaiting gives `result`.
function query(result: unknown) {
	const calls: { method: string; args: unknown[] }[] = []
	const proxy: any = new Proxy(
		{},
		{
			get(_, method: string) {
				if (method === 'then')
					return (resolve: (v: unknown) => void) => resolve(result)
				return (...args: unknown[]) => {
					calls.push({ method, args })
					return proxy
				}
			},
		},
	)
	return {
		proxy,
		argsOf: (method: string) => calls.find((c) => c.method === method)?.args,
	}
}

const row = (over: Record<string, unknown>) => ({
	id: 1,
	itemType: 'flagged_chat',
	sourceId: 'L1:p1',
	subjectPlayerId: 'p1',
	status: 'open',
	summary: 'Flagged chat, 1 message',
	context: { flaggedMessageIds: [10] },
	...over,
})

// db.transaction runs its callback against a tx whose select/insert/update answer in turn.
function world(existing: unknown[], inserted: unknown[] = [row({ id: 9 })]) {
	const select = query(existing)
	const insert = query(inserted)
	const update = query([])
	const tx = {
		select: vi.fn(() => select.proxy),
		insert: vi.fn(() => insert.proxy),
		update: vi.fn(() => update.proxy),
	}
	;(db as any).transaction = vi.fn(async (fn: (t: unknown) => unknown) =>
		fn(tx),
	)
	return { tx, insert, update }
}

const input = { flaggedMessageId: 11, playerId: 'p1', lobbyId: 'L1' }

describe('addToFlaggedChatItem', () => {
	beforeEach(() => vi.clearAllMocks())

	it('makes an item for a player and lobby with none', async () => {
		const w = world([])
		const made = await addToFlaggedChatItem(input)
		expect(made).toMatchObject({ id: 9 })
		expect(w.insert.argsOf('values')?.[0]).toMatchObject({
			itemType: 'flagged_chat',
			sourceId: 'L1:p1',
			subjectPlayerId: 'p1',
			context: { flaggedMessageIds: [11] },
		})
	})

	it('adds a second message to the open item', async () => {
		const w = world([row({})])
		expect(await addToFlaggedChatItem(input)).toBeNull()
		expect(w.tx.insert).not.toHaveBeenCalled()
		expect(w.update.argsOf('set')?.[0]).toMatchObject({
			context: { flaggedMessageIds: [10, 11] },
			summary: 'Flagged chat, 2 messages',
		})
	})

	it('makes a separate item for another player or another lobby', async () => {
		const w = world([
			row({ sourceId: 'L2:p1', context: { flaggedMessageIds: [3] } }),
			row({ id: 2, sourceId: 'L1:p2', subjectPlayerId: 'p2' }),
		])
		await addToFlaggedChatItem(input)
		expect(w.insert.argsOf('values')?.[0]).toMatchObject({ sourceId: 'L1:p1' })
	})

	it('opens a second round when the earlier item is decided', async () => {
		const w = world([row({ status: 'resolved' })])
		await addToFlaggedChatItem(input)
		expect(w.insert.argsOf('values')?.[0]).toMatchObject({
			sourceId: 'L1:p1:2',
		})
	})

	it('does nothing for a message an item already holds', async () => {
		const w = world([
			row({ status: 'resolved', context: { flaggedMessageIds: [11] } }),
		])
		expect(await addToFlaggedChatItem(input)).toBeNull()
		expect(w.tx.insert).not.toHaveBeenCalled()
		expect(w.tx.update).not.toHaveBeenCalled()
	})
})
