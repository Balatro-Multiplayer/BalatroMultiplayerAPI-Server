import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as evidence from '../../features/service-queue/evidence/assemble.js'
import * as queue from '../../features/service-queue/queue.service.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as serviceQueueGateway from '../../infrastructure/gateways/service-queue.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/service-queue.gateway.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../infrastructure/gateways/service-queue.gateway.js')>()
	return {
		...actual,
		listServiceQueueItems: vi.fn(),
		getServiceQueueItemById: vi.fn(),
		openCountsByType: vi.fn(),
		countClaimedByOthers: vi.fn(),
		listItemEvents: vi.fn(),
		recordItemEvent: vi.fn(),
		actorNames: vi.fn(),
		viewedSince: vi.fn(),
	}
})

vi.mock('../../features/service-queue/evidence/assemble.js', () => ({
	evidenceOf: vi.fn(),
	subjectCard: vi.fn(),
}))

vi.mock('../../features/service-queue/queue.service.js', () => ({
	claim: vi.fn(),
	release: vi.fn(),
	serviceQueueDispatcher: { run: vi.fn() },
}))

const app = createTestApp()

function authAs(privilege: 'moderator' | 'admin', playerId: string) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ id: playerId, privileges: [privilege] } as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const ITEM = {
	id: 1,
	itemType: 'report' as const,
	sourceId: '42',
	subjectPlayerId: 'target-1',
	status: 'open' as const,
	priority: 40,
	summary: 'cheating report',
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
	vi.mocked(serviceQueueGateway.openCountsByType).mockResolvedValue({
		report: 1,
		flagged_chat: 0,
		match_conflict: 0,
		forfeit_reconciliation: 0,
		anti_cheat: 0,
		integrity: 0,
	})
	vi.mocked(serviceQueueGateway.viewedSince).mockResolvedValue(false)
	vi.mocked(serviceQueueGateway.actorNames).mockResolvedValue({})
	vi.mocked(serviceQueueGateway.recordItemEvent).mockResolvedValue(undefined as any)
})

describe('GET /api/webadmin/service-queue', () => {
	it('returns 403 for a non-privileged player', async () => {
		createSession('Plain', { id: 'plain-1' })
		vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ id: 'plain-1', privileges: [] } as any)
		const res = await request(app)
			.get('/api/webadmin/service-queue')
			.set('Authorization', `Bearer ${signJwt({ playerId: 'plain-1', steamName: 'Plain' })}`)
		expect(res.status).toBe(403)
	})

	it('lists by priority across every status by default, with the tab counts', async () => {
		const token = authAs('moderator', 'mod-1')
		vi.mocked(serviceQueueGateway.listServiceQueueItems).mockResolvedValue({
			items: [{ ...ITEM, subjectName: 'Target', subjectOpenItems: 2 }],
			total: 1,
		})
		const res = await request(app).get('/api/webadmin/service-queue').set('Authorization', token)
		expect(res.status).toBe(200)
		expect(res.body.total).toBe(1)
		expect(res.body.items[0]).toMatchObject({ subjectName: 'Target', subjectOpenItems: 2, claim: null })
		expect(res.body.counts.report).toBe(1)
		expect(serviceQueueGateway.listServiceQueueItems).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'all', sort: 'priority', claimedBy: undefined }),
		)
	})

	it('hides items other staff claimed and reports how many there are', async () => {
		const token = authAs('moderator', 'mod-1')
		vi.mocked(serviceQueueGateway.listServiceQueueItems).mockResolvedValue({ items: [], total: 0 })
		vi.mocked(serviceQueueGateway.countClaimedByOthers).mockResolvedValue(12)
		const res = await request(app).get('/api/webadmin/service-queue?status=open&hideClaimed=1').set('Authorization', token)
		expect(res.body.claimedByOthers).toBe(12)
		expect(serviceQueueGateway.listServiceQueueItems).toHaveBeenCalledWith(
			expect.objectContaining({ hideClaimedFrom: 'mod-1' }),
		)
		expect(serviceQueueGateway.countClaimedByOthers).toHaveBeenCalledWith('mod-1', expect.any(Date))
	})

	it('passes the filters through', async () => {
		const token = authAs('moderator', 'mod-1')
		vi.mocked(serviceQueueGateway.listServiceQueueItems).mockResolvedValue({ items: [], total: 0 })
		await request(app)
			.get('/api/webadmin/service-queue?status=open&itemType=anti_cheat&sort=age&olderThanHours=2&claimedByMe=1&subject=bob')
			.set('Authorization', token)
		expect(serviceQueueGateway.listServiceQueueItems).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'open',
				itemType: 'anti_cheat',
				sort: 'age',
				olderThanMs: 2 * 60 * 60 * 1000,
				claimedBy: 'mod-1',
				subject: 'bob',
			}),
		)
	})
})

describe('GET /api/webadmin/service-queue/:id', () => {
	it('returns 404 for an unknown id', async () => {
		const token = authAs('moderator', 'mod-2')
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue(null)
		const res = await request(app).get('/api/webadmin/service-queue/999').set('Authorization', token)
		expect(res.status).toBe(404)
		expect(res.body.code).toBe('not_found')
	})

	it('returns the subject card, evidence and the role-narrowed actions, and records the view', async () => {
		const token = authAs('moderator', 'mod-3')
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue(ITEM)
		vi.mocked(evidence.subjectCard).mockResolvedValue({ player: { id: 'target-1' } } as any)
		vi.mocked(evidence.evidenceOf).mockResolvedValue({ report: { id: 42 } } as any)

		const res = await request(app).get('/api/webadmin/service-queue/1').set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.evidence.report.id).toBe(42)
		expect(res.body.subject.player.id).toBe('target-1')
		expect(res.body.role).toBe('moderator')
		const actions = res.body.allowedActions.map((a: { action: string }) => a.action)
		expect(actions).toContain('warn')
		expect(actions).not.toContain('account_ban')
		expect(res.body.allowedActions.find((a: { action: string }) => a.action === 'queue_ban').presets).toEqual(['24h', '7d', '30d', 'permanent'])
		expect(serviceQueueGateway.recordItemEvent).toHaveBeenCalledWith(expect.anything(), {
			itemId: 1,
			kind: 'viewed',
			actor: 'moderator:mod-3',
		})
	})

	it("lists a report's targets (the reported player and the reporter) and names the claim holder", async () => {
		const token = authAs('moderator', 'mod-3')
		const until = new Date(Date.now() + 60_000)
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue({
			...ITEM,
			claimedBy: 'admin:adm-1',
			claimedUntil: until,
		})
		vi.mocked(evidence.subjectCard).mockResolvedValue(null as any)
		vi.mocked(evidence.evidenceOf).mockResolvedValue({ report: { id: 42, reporterId: 'rep-1', reportedId: 'target-1' } } as any)
		vi.mocked(serviceQueueGateway.actorNames).mockResolvedValue({ 'admin:adm-1': 'Alice' })

		const res = await request(app).get('/api/webadmin/service-queue/1').set('Authorization', token)

		expect(res.body.targets).toEqual([
			{ role: 'subject', playerId: 'target-1' },
			{ role: 'reporter', playerId: 'rep-1' },
		])
		expect(res.body.claim).toEqual({ claimedBy: 'admin:adm-1', claimedByName: 'Alice', claimedUntil: until.toISOString() })
	})

	it('records a view once per window', async () => {
		const token = authAs('admin', 'admin-1')
		vi.mocked(serviceQueueGateway.getServiceQueueItemById).mockResolvedValue(ITEM)
		vi.mocked(serviceQueueGateway.viewedSince).mockResolvedValue(true)
		vi.mocked(evidence.subjectCard).mockResolvedValue(null as any)
		vi.mocked(evidence.evidenceOf).mockResolvedValue({} as any)
		const res = await request(app).get('/api/webadmin/service-queue/1').set('Authorization', token)
		expect(res.status).toBe(200)
		expect(serviceQueueGateway.recordItemEvent).not.toHaveBeenCalled()
	})
})

describe('claims', () => {
	it('claims an item', async () => {
		const token = authAs('moderator', 'mod-1')
		const until = new Date(Date.now() + 15 * 60 * 1000)
		vi.mocked(queue.claim).mockResolvedValue({ ok: true, value: { ...ITEM, claimedBy: 'moderator:mod-1', claimedUntil: until } })
		const res = await request(app).post('/api/webadmin/service-queue/1/claim').set('Authorization', token)
		expect(res.status).toBe(200)
		expect(res.body.claim.claimedBy).toBe('moderator:mod-1')
	})

	it('answers 409 when someone else holds it', async () => {
		const token = authAs('moderator', 'mod-1')
		vi.mocked(queue.claim).mockResolvedValue({
			ok: false,
			refusal: { code: 'claimed', claimedBy: 'moderator:mod-2', claimedUntil: null },
		})
		vi.mocked(serviceQueueGateway.actorNames).mockResolvedValue({ 'moderator:mod-2': 'Bob' })
		const res = await request(app).post('/api/webadmin/service-queue/1/claim').set('Authorization', token)
		expect(res.status).toBe(409)
		expect(res.body).toMatchObject({ code: 'claimed', claimedBy: 'moderator:mod-2', claimedByName: 'Bob' })
	})

	it('passes force through on release', async () => {
		const token = authAs('admin', 'admin-1')
		vi.mocked(queue.release).mockResolvedValue({ ok: true, value: ITEM })
		const res = await request(app).delete('/api/webadmin/service-queue/1/claim?force=1').set('Authorization', token)
		expect(res.status).toBe(200)
		expect(res.body.claim).toBeNull()
		expect(queue.release).toHaveBeenCalledWith(1, { playerId: 'admin-1', role: 'admin' }, true)
	})
})

describe('POST /api/webadmin/service-queue/:id/actions/:action', () => {
	it("passes the dispatcher's refusal through as its HTTP status", async () => {
		const token = authAs('moderator', 'mod-1')
		vi.mocked(queue.serviceQueueDispatcher.run).mockResolvedValue({ ok: false, refusal: { code: 'forbidden' } })
		const res = await request(app)
			.post('/api/webadmin/service-queue/1/actions/account_ban')
			.set('Authorization', token)
			.send({ duration: '7d', reason: 'x' })
		expect(res.status).toBe(403)
		expect(res.body.code).toBe('forbidden')
		expect(queue.serviceQueueDispatcher.run).toHaveBeenCalledWith(
			1,
			'account_ban',
			{ playerId: 'mod-1', role: 'moderator' },
			{ duration: '7d', reason: 'x' },
		)
	})

	it('answers the updated item, its effects and the actions now allowed', async () => {
		const token = authAs('moderator', 'mod-1')
		vi.mocked(queue.serviceQueueDispatcher.run).mockResolvedValue({
			ok: true,
			value: { item: { ...ITEM, status: 'resolved' }, action: 'warn', effects: { warningId: 3, delivered: true } },
		})
		const res = await request(app)
			.post('/api/webadmin/service-queue/1/actions/warn')
			.set('Authorization', token)
			.send({ message: 'be nice' })
		expect(res.status).toBe(200)
		expect(res.body.effects).toEqual({ warningId: 3, delivered: true })
		expect(res.body.allowedActions.map((a: { action: string }) => a.action)).toEqual(['reopen', 'note'])
	})

	it('answers 404 for a malformed id without dispatching', async () => {
		const token = authAs('moderator', 'mod-1')
		const res = await request(app).post('/api/webadmin/service-queue/abc/actions/resolve').set('Authorization', token)
		expect(res.status).toBe(404)
		expect(queue.serviceQueueDispatcher.run).not.toHaveBeenCalled()
	})
})
