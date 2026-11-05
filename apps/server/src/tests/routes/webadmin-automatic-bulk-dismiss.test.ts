import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { db } from '../../infrastructure/db/index.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as serviceQueueGateway from '../../infrastructure/gateways/service-queue.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

// The route runs the real queue dispatcher; only the queue's storage is faked.
vi.mock('../../infrastructure/gateways/service-queue.gateway.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getServiceQueueItemById: vi.fn(),
	markServiceQueueItemResolved: vi.fn().mockResolvedValue({ id: 1 }),
	recordItemEvent: vi.fn().mockResolvedValue(undefined),
}))

const app = createTestApp()
const URL = '/api/webadmin/service-queue/automatic/dismiss'

type Row = { itemType: string; claimedBy?: string; subject?: string }
let rows: Record<number, Row>

function itemRow(id: number) {
	const row = rows[id]!
	return {
		id,
		itemType: row.itemType,
		sourceId: `src-${id}`,
		subjectPlayerId: row.subject ?? `target-${id}`,
		status: 'open',
		priority: 10,
		summary: 'flag',
		createdAt: new Date(),
		resolvedAt: null,
		resolvedBy: null,
		resolutionAction: null,
		resolutionNotes: null,
		claimedBy: row.claimedBy ?? null,
		claimedUntil: row.claimedBy ? new Date(Date.now() + 10 * 60 * 1000) : null,
		context: {},
		updatedAt: new Date(),
	}
}

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ id: playerId, privileges } as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

beforeEach(() => {
	;(db as any).transaction = vi.fn(async (run: (tx: unknown) => unknown) => run({ tx: true }))
	rows = {
		11: { itemType: 'anti_cheat' },
		12: { itemType: 'integrity' },
		13: { itemType: 'anti_cheat', claimedBy: 'someone-else' },
		14: { itemType: 'report' },
	}
	vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockImplementation((async (id: number) =>
		rows[id] ? itemRow(id) : undefined) as any)
	vi.mocked(recordStaffAction).mockClear()
	vi.mocked(serviceQueueGateway.markServiceQueueItemResolved).mockClear()
})

describe('POST /api/webadmin/service-queue/automatic/dismiss', () => {
	it('refuses a player with no staff role', async () => {
		const res = await request(app)
			.post(URL)
			.set('Authorization', authAs('plain', []))
			.send({ itemIds: [11], reason: 'noise' })
		expect(res.status).toBe(403)
		expect(recordStaffAction).not.toHaveBeenCalled()
	})

	it('needs a note and changes nothing without one', async () => {
		const token = authAs('mod-1', ['moderator'])
		for (const body of [{ itemIds: [11] }, { itemIds: [11], reason: '   ' }, { itemIds: [11], reason: 5 }]) {
			const res = await request(app).post(URL).set('Authorization', token).send(body)
			expect(res.status).toBe(400)
		}
		expect(recordStaffAction).not.toHaveBeenCalled()
	})

	it('needs a list of item ids', async () => {
		const token = authAs('mod-1', ['moderator'])
		for (const body of [{ reason: 'x' }, { itemIds: 'a', reason: 'x' }, { itemIds: [], reason: 'x' }, { itemIds: [1.5], reason: 'x' }]) {
			const res = await request(app).post(URL).set('Authorization', token).send(body)
			expect(res.status).toBe(400)
		}
	})

	it('dismisses each listed item with its own staff log entry', async () => {
		const res = await request(app)
			.post(URL)
			.set('Authorization', authAs('mod-1', ['moderator']))
			.send({ itemIds: [11, 12], reason: 'known false positive' })
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ ok: true, dismissed: 2, failed: [] })
		const entries = vi.mocked(recordStaffAction).mock.calls.map((c) => c[1])
		expect(entries.map((e) => e.itemId).sort()).toEqual([11, 12])
		for (const entry of entries)
			expect(entry).toMatchObject({
				action: 'dismiss',
				reason: 'known false positive',
				staff: { playerId: 'mod-1', role: 'moderator' },
			})
	})

	it('lets an admin do the same', async () => {
		const res = await request(app)
			.post(URL)
			.set('Authorization', authAs('adm-1', ['admin']))
			.send({ itemIds: [11, 12], reason: 'cleanup' })
		expect(res.status).toBe(200)
		expect(recordStaffAction).toHaveBeenCalledTimes(2)
	})

	it('skips an item claimed by someone else and reports it', async () => {
		const res = await request(app)
			.post(URL)
			.set('Authorization', authAs('mod-1', ['moderator']))
			.send({ itemIds: [11, 13], reason: 'noise' })
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ dismissed: 1, failed: [{ itemId: 13, code: 'claimed' }] })
		expect(vi.mocked(recordStaffAction).mock.calls.map((c) => c[1].itemId)).toEqual([11])
	})

	it('never dismisses an item that is not automatic', async () => {
		const res = await request(app)
			.post(URL)
			.set('Authorization', authAs('mod-1', ['moderator']))
			.send({ itemIds: [14, 11], reason: 'noise' })
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ dismissed: 1, failed: [{ itemId: 14, code: 'not_automatic' }] })
		expect(vi.mocked(recordStaffAction).mock.calls.map((c) => c[1].itemId)).toEqual([11])
	})

	it('reports an unknown item id', async () => {
		const res = await request(app)
			.post(URL)
			.set('Authorization', authAs('mod-1', ['moderator']))
			.send({ itemIds: [99], reason: 'noise' })
		expect(res.body).toMatchObject({ dismissed: 0, failed: [{ itemId: 99, code: 'not_found' }] })
	})
})
