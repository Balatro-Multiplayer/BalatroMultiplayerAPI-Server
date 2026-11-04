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
	openAutomaticItemIds: vi.fn(),
	getServiceQueueItemById: vi.fn(),
	markServiceQueueItemResolved: vi.fn().mockResolvedValue({ id: 1 }),
	recordItemEvent: vi.fn().mockResolvedValue(undefined),
}))

const app = createTestApp()
const PLAYER = 'target-1'
const URL = `/api/webadmin/service-queue/automatic/${PLAYER}/dismiss`

function itemRow(id: number, itemType: 'anti_cheat' | 'integrity') {
	return {
		id,
		itemType,
		sourceId: `src-${id}`,
		subjectPlayerId: PLAYER,
		status: 'open',
		priority: 10,
		summary: 'flag',
		createdAt: new Date(),
		resolvedAt: null,
		resolvedBy: null,
		resolutionAction: null,
		resolutionNotes: null,
		claimedBy: null,
		claimedUntil: null,
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
	vi.mocked(serviceQueueGateway.openAutomaticItemIds).mockResolvedValue([11, 12])
	vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockImplementation((async (id: number) =>
		itemRow(id, id === 11 ? 'anti_cheat' : 'integrity')) as any)
	vi.mocked(recordStaffAction).mockClear()
})

describe('POST /api/webadmin/service-queue/automatic/:playerId/dismiss', () => {
	it('refuses a player with no staff role', async () => {
		const res = await request(app).post(URL).set('Authorization', authAs('plain', [])).send({ reason: 'noise' })
		expect(res.status).toBe(403)
		expect(recordStaffAction).not.toHaveBeenCalled()
	})

	it('needs a reason and changes nothing without one', async () => {
		const token = authAs('mod-1', ['moderator'])
		for (const body of [{}, { reason: '   ' }, { reason: 5 }]) {
			const res = await request(app).post(URL).set('Authorization', token).send(body)
			expect(res.status).toBe(400)
		}
		expect(recordStaffAction).not.toHaveBeenCalled()
		expect(serviceQueueGateway.markServiceQueueItemResolved).not.toHaveBeenCalled()
	})

	it('lets a moderator dismiss every open item with one staff log entry each', async () => {
		const res = await request(app)
			.post(URL)
			.set('Authorization', authAs('mod-1', ['moderator']))
			.send({ reason: 'known false positive' })
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ ok: true, dismissed: 2, failed: [] })
		expect(recordStaffAction).toHaveBeenCalledTimes(2)
		const entries = vi.mocked(recordStaffAction).mock.calls.map((c) => c[1])
		expect(entries.map((e) => e.itemId).sort()).toEqual([11, 12])
		for (const entry of entries)
			expect(entry).toMatchObject({
				action: 'dismiss',
				reason: 'known false positive',
				targetPlayerId: PLAYER,
				staff: { playerId: 'mod-1', role: 'moderator' },
			})
	})

	it('lets an admin do the same', async () => {
		const res = await request(app)
			.post(URL)
			.set('Authorization', authAs('adm-1', ['admin']))
			.send({ reason: 'cleanup' })
		expect(res.status).toBe(200)
		expect(recordStaffAction).toHaveBeenCalledTimes(2)
		expect(vi.mocked(recordStaffAction).mock.calls[0]![1].staff).toEqual({ playerId: 'adm-1', role: 'admin' })
	})
})
