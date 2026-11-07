import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appealService } from '../../features/appeals/appeals.deps.js'
import { signJwt } from '../../features/auth/jwt.js'
import * as evidence from '../../features/service-queue/evidence/assemble.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as serviceQueueGateway from '../../infrastructure/gateways/service-queue.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/service-queue.gateway.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../infrastructure/gateways/service-queue.gateway.js')>()),
	getServiceQueueItemById: vi.fn(),
	recordItemEvent: vi.fn(),
	actorNames: vi.fn(),
	viewedSince: vi.fn(),
}))
vi.mock('../../features/service-queue/evidence/assemble.js', () => ({ evidenceOf: vi.fn(), subjectCard: vi.fn() }))
vi.mock('../../features/appeals/appeals.deps.js', () => ({ appealService: { submit: vi.fn(), decide: vi.fn() } }))

const app = createTestApp()

function authAs(privilege: 'moderator' | 'admin', playerId: string) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ id: playerId, privileges: [privilege] } as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const ITEM = {
	id: 7,
	itemType: 'appeal' as const,
	sourceId: 'appeal-1',
	subjectPlayerId: 'p1',
	status: 'open' as const,
	priority: 50,
	summary: 'Appeal of a queue ban',
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

beforeEach(() => {
	vi.mocked(serviceQueueGateway.viewedSince).mockResolvedValue(false)
	vi.mocked(serviceQueueGateway.actorNames).mockResolvedValue({})
	vi.mocked(serviceQueueGateway.recordItemEvent).mockResolvedValue(undefined as any)
	vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue(ITEM as any)
	vi.mocked(evidence.subjectCard).mockResolvedValue(null as any)
})

describe('GET /api/webadmin/service-queue/:id for an appeal', () => {
	it('tells a moderator they can deny but not grant', async () => {
		vi.mocked(evidence.evidenceOf).mockResolvedValue({ punishment: { issuedBy: 'admin:a1' } })
		const res = await request(app).get('/api/webadmin/service-queue/7').set('Authorization', authAs('moderator', 'mod-1'))
		expect(res.status).toBe(200)
		expect(res.body.appealDecisions).toEqual({ deny: true, grant: false })
	})

	it("tells a moderator they can do neither on an appeal of their own punishment", async () => {
		vi.mocked(evidence.evidenceOf).mockResolvedValue({ punishment: { issuedBy: 'moderator:mod-1' } })
		const res = await request(app).get('/api/webadmin/service-queue/7').set('Authorization', authAs('moderator', 'mod-1'))
		expect(res.body.appealDecisions).toEqual({ deny: false, grant: false })
	})

	it('tells an admin they can do both', async () => {
		vi.mocked(evidence.evidenceOf).mockResolvedValue({ punishment: null })
		const res = await request(app).get('/api/webadmin/service-queue/7').set('Authorization', authAs('admin', 'adm-1'))
		expect(res.body.appealDecisions).toEqual({ deny: true, grant: true })
	})
})

describe('POST /api/webadmin/service-queue/:id/appeal', () => {
	it('needs a staff role', async () => {
		createSession('plain', { id: 'plain' })
		vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ id: 'plain', privileges: [] } as any)
		const res = await request(app)
			.post('/api/webadmin/service-queue/7/appeal')
			.set('Authorization', `Bearer ${signJwt({ playerId: 'plain', steamName: 'plain' })}`)
			.send({ decision: 'deny', reason: 'x' })
		expect(res.status).toBe(403)
		expect(appealService.decide).not.toHaveBeenCalled()
	})

	it('passes the decision to the service with the signed-in staff member', async () => {
		vi.mocked(appealService.decide).mockResolvedValue({ ok: true, value: { appeal: { id: 'appeal-1', status: 'denied' } as any } })
		const res = await request(app)
			.post('/api/webadmin/service-queue/7/appeal')
			.set('Authorization', authAs('moderator', 'mod-1'))
			.send({ decision: 'deny', reason: 'No evidence' })
		expect(res.status).toBe(200)
		expect(appealService.decide).toHaveBeenCalledWith(7, { playerId: 'mod-1', role: 'moderator' }, { decision: 'deny', reason: 'No evidence' })
		expect(res.body.appeal).toMatchObject({ status: 'denied' })
	})

	it("passes the service's refusal through as its HTTP status", async () => {
		vi.mocked(appealService.decide).mockResolvedValue({ ok: false, refusal: { code: 'forbidden' } })
		const res = await request(app)
			.post('/api/webadmin/service-queue/7/appeal')
			.set('Authorization', authAs('moderator', 'mod-1'))
			.send({ decision: 'grant', outcome: 'lift', reason: 'x' })
		expect(res.status).toBe(403)
		expect(res.body.code).toBe('forbidden')
	})

	it('answers 404 for a malformed id', async () => {
		const res = await request(app)
			.post('/api/webadmin/service-queue/abc/appeal')
			.set('Authorization', authAs('admin', 'adm-1'))
			.send({})
		expect(res.status).toBe(404)
	})
})
