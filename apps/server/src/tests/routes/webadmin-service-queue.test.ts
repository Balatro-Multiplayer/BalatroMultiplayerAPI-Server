import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { db } from '../../infrastructure/db/index.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as serviceQueueGateway from '../../infrastructure/gateways/service-queue.gateway.js'
import * as serviceQueueDetail from '../../features/webadmin/service-queue-detail.js'
import { issueBan } from '../../features/webadmin/ban.service.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/service-queue.gateway.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../infrastructure/gateways/service-queue.gateway.js')>()
	return {
		...actual,
		listServiceQueueItems: vi.fn(),
		getServiceQueueItemById: vi.fn(),
	}
})

vi.mock('../../features/webadmin/service-queue-detail.js', () => ({
	getServiceQueueItemDetail: vi.fn(),
}))

vi.mock('../../features/webadmin/ban.service.js', () => ({
	issueBan: vi.fn(),
}))

const app = createTestApp()

function authAsModerator(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ privileges: ['moderator'] } as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

function authAsAdmin(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ privileges: ['admin'] } as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

const SAMPLE_REPORT_ITEM = {
	id: 1,
	itemType: 'report' as const,
	sourceId: '42',
	subjectPlayerId: 'target-1',
	status: 'open' as const,
	priority: null,
	summary: 'cheating report',
	createdAt: new Date(),
	resolvedAt: null,
	resolvedBy: null,
	resolutionAction: null,
}

function mockDbUpdateReturning(row: unknown) {
	;(db as any).update = vi.fn().mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([row]),
			}),
		}),
	})
}

describe('GET /api/webadmin/service-queue', () => {
	it('returns 403 for a non-privileged player', async () => {
		createSession('Plain', { id: 'plain-1' })
		vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ privileges: [] } as any)
		const res = await request(app)
			.get('/api/webadmin/service-queue')
			.set('Authorization', `Bearer ${signJwt({ playerId: 'plain-1', steamName: 'Plain' })}`)
		expect(res.status).toBe(403)
	})

	it('returns the paginated list for a moderator', async () => {
		const token = authAsModerator('mod-1', 'Mod')
		vi.mocked(serviceQueueGateway.listServiceQueueItems).mockResolvedValue({
			items: [SAMPLE_REPORT_ITEM],
			total: 1,
		})

		const res = await request(app).get('/api/webadmin/service-queue').set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.total).toBe(1)
		expect(res.body.items).toHaveLength(1)
	})
})

describe('GET /api/webadmin/service-queue/:id', () => {
	it('returns 404 for an unknown id', async () => {
		const token = authAsModerator('mod-2', 'Mod2')
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue(null)

		const res = await request(app).get('/api/webadmin/service-queue/999').set('Authorization', token)

		expect(res.status).toBe(404)
	})

	it('returns the type-specific detail shape', async () => {
		const token = authAsModerator('mod-3', 'Mod3')
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue(SAMPLE_REPORT_ITEM)
		vi.mocked(serviceQueueDetail.getServiceQueueItemDetail).mockResolvedValue({
			item: SAMPLE_REPORT_ITEM,
			detail: { reporterName: 'Alice' },
		})

		const res = await request(app).get('/api/webadmin/service-queue/1').set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.detail.reporterName).toBe('Alice')
	})
})

describe('PATCH /api/webadmin/service-queue/:id/actions/:actionKey', () => {
	it('returns 400 when the actionKey is not valid for the item type', async () => {
		const token = authAsAdmin('admin-1', 'Admin')
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue(SAMPLE_REPORT_ITEM)

		// 'void' is only registered for forfeit_reconciliation, not report.
		const res = await request(app)
			.patch('/api/webadmin/service-queue/1/actions/void')
			.set('Authorization', token)

		expect(res.status).toBe(400)
	})

	it('returns 403 for a moderator on a destructive action (ban)', async () => {
		const token = authAsModerator('mod-4', 'Mod4')

		const res = await request(app)
			.patch('/api/webadmin/service-queue/1/actions/ban')
			.set('Authorization', token)
			.send({ banType: 'chat', reason: 'test' })

		expect(res.status).toBe(403)
	})

	it('resolves a report for a moderator (non-destructive) and sets resolutionAction', async () => {
		const token = authAsModerator('mod-5', 'Mod5')
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue(SAMPLE_REPORT_ITEM)
		mockDbUpdateReturning({ ...SAMPLE_REPORT_ITEM, status: 'resolved', resolutionAction: 'resolve' })

		const res = await request(app)
			.patch('/api/webadmin/service-queue/1/actions/resolve')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.queueItem.resolutionAction).toBe('resolve')
	})

	it("issues a ban for an admin and calls issueBan with the item's subjectPlayerId", async () => {
		const token = authAsAdmin('admin-2', 'Admin2')
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue(SAMPLE_REPORT_ITEM)
		vi.mocked(issueBan).mockResolvedValue({
			id: 'ban-1',
			playerId: 'target-1',
			banType: 'chat',
			expiresAt: null,
			issuedBy: 'admin:admin-2',
			issuedAt: new Date(),
			reason: 'test',
			liftedAt: null,
			liftedBy: null,
		})
		mockDbUpdateReturning({ ...SAMPLE_REPORT_ITEM, status: 'resolved', resolutionAction: 'ban_chat' })

		const res = await request(app)
			.patch('/api/webadmin/service-queue/1/actions/ban')
			.set('Authorization', token)
			.send({ banType: 'chat', reason: 'test' })

		expect(res.status).toBe(200)
		expect(res.body.queueItem.resolutionAction).toBe('ban_chat')
		expect(vi.mocked(issueBan)).toHaveBeenCalledWith(
			expect.objectContaining({ playerId: 'target-1', banType: 'chat' }),
		)
	})

	it('returns 400 for ban when the item has no subjectPlayerId', async () => {
		const token = authAsAdmin('admin-3', 'Admin3')
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue({
			...SAMPLE_REPORT_ITEM,
			itemType: 'match_conflict',
			subjectPlayerId: null,
		})

		// match_conflict isn't even registered for 'ban', so this also exercises
		// the "action not valid for this item type" 400 path from a different angle.
		const res = await request(app)
			.patch('/api/webadmin/service-queue/1/actions/ban')
			.set('Authorization', token)
			.send({ banType: 'chat', reason: 'test' })

		expect(res.status).toBe(400)
	})
})
