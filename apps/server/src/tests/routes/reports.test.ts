import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { errorHandler } from '../../middleware/errorHandler.js'
import {
	type ReportPageRow,
	WITHDRAWN_ACTION,
	createReportPageService,
} from '../../features/reports/report-page.service.js'
import { createReportsRouter } from '../../features/reports/reports.route.js'
import { createSession } from '../../state/index.js'

// The page service over an in-memory report and queue item; a transaction
// is a snapshot that a throw restores.
interface World {
	report: ReportPageRow & { pageOpenedAt: Date | null }
	item: { id: number; status: string; resolutionAction: string | null; claimedBy: string | null }
	events: { itemId: number; kind: string; actor: string }[]
}

let world: World

function appOver(w: World) {
	const service = createReportPageService<World>({
		getReport: async (id) => (id === w.report.id ? { ...w.report } : null),
		markPageOpened: async () => {
			if (w.report.pageOpenedAt) return false
			w.report.pageOpenedAt = new Date()
			return true
		},
		setAdditionalDetail: async (_id, text) => {
			w.report.additionalDetail = text
		},
		findQueueItem: async () => ({ id: w.item.id, status: w.item.status }),
		transaction: async (fn) => {
			const before = structuredClone(w)
			try {
				return await fn(w)
			} catch (err) {
				Object.assign(w, before)
				throw err
			}
		},
		closeItem: async (tx, _itemId, _actor, _now) => {
			if (tx.item.status !== 'open') return false
			// A staff claim does not stop it.
			tx.item = { ...tx.item, status: 'resolved', resolutionAction: WITHDRAWN_ACTION, claimedBy: null }
			return true
		},
		markWithdrawn: async (tx, _id, now) => {
			if (tx.report.withdrawnAt) return false
			tx.report.withdrawnAt = now
			tx.report.status = 'resolved'
			return true
		},
		recordWithdrawn: async (tx, itemId, actor) => {
			tx.events.push({ itemId, kind: 'withdrawn', actor })
		},
		now: () => new Date('2026-11-05T12:00:00Z'),
	})
	const app = express()
	app.use(express.json())
	app.use('/api/reports', createReportsRouter(service))
	app.use(errorHandler)
	return app
}

function auth(playerId: string) {
	createSession(playerId, { id: playerId })
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

beforeEach(() => {
	world = {
		report: {
			id: 1,
			type: 'cheating',
			reporterId: 'reporter-1',
			status: 'open',
			additionalDetail: null,
			withdrawnAt: null,
			createdAt: new Date('2026-11-05T11:00:00Z'),
			pageOpenedAt: null,
		},
		item: { id: 7, status: 'open', resolutionAction: null, claimedBy: 'moderator:m1' },
		events: [],
	}
})

describe('POST /api/reports/:id/open', () => {
	it('returns 401 without a token', async () => {
		const res = await request(appOver(world)).post('/api/reports/1/open')
		expect(res.status).toBe(401)
	})

	it('returns 404 for an unknown report and 403 for another player', async () => {
		const app = appOver(world)
		expect((await request(app).post('/api/reports/99/open').set('Authorization', auth('reporter-1'))).status).toBe(404)
		expect((await request(app).post('/api/reports/1/open').set('Authorization', auth('eve'))).status).toBe(403)
		expect(world.report.pageOpenedAt).toBeNull()
	})

	it('gives the page once, then only "Submitted"', async () => {
		const app = appOver(world)
		const first = await request(app).post('/api/reports/1/open').set('Authorization', auth('reporter-1'))
		expect(first.status).toBe(200)
		expect(first.body.page.submitted).toBe(false)
		expect(first.body.page.report).toMatchObject({ type: 'cheating', state: 'open' })

		const later = await request(app).post('/api/reports/1/open').set('Authorization', auth('reporter-1'))
		expect(later.status).toBe(200)
		expect(later.body.page).toEqual({ submitted: true })
	})
})

describe('PATCH /api/reports/:id', () => {
	it('returns 403 for another player and 400 for too long a text', async () => {
		const app = appOver(world)
		const long = { additionalDetail: 'x'.repeat(2001) }
		expect((await request(app).patch('/api/reports/1').set('Authorization', auth('eve')).send({ additionalDetail: 'a' })).status).toBe(403)
		expect((await request(app).patch('/api/reports/1').set('Authorization', auth('reporter-1')).send(long)).status).toBe(400)
	})

	it('saves the detail while the report is open', async () => {
		const res = await request(appOver(world))
			.patch('/api/reports/1')
			.set('Authorization', auth('reporter-1'))
			.send({ additionalDetail: 'more info' })
		expect(res.status).toBe(200)
		expect(world.report.additionalDetail).toBe('more info')
	})

	it('refuses detail after staff decided', async () => {
		world.report.status = 'resolved'
		const res = await request(appOver(world))
			.patch('/api/reports/1')
			.set('Authorization', auth('reporter-1'))
			.send({ additionalDetail: 'late' })
		expect(res.status).toBe(409)
		expect(world.report.additionalDetail).toBeNull()
	})
})

describe('POST /api/reports/:id/withdraw', () => {
	it('closes the item with no action, even when a moderator claimed it', async () => {
		const res = await request(appOver(world)).post('/api/reports/1/withdraw').set('Authorization', auth('reporter-1'))
		expect(res.status).toBe(200)
		expect(world.item).toMatchObject({ status: 'resolved', resolutionAction: WITHDRAWN_ACTION, claimedBy: null })
		expect(world.report.withdrawnAt).not.toBeNull()
		expect(world.report.status).toBe('resolved')
		expect(world.events).toEqual([{ itemId: 7, kind: 'withdrawn', actor: 'player:reporter-1' }])
	})

	it('shows the withdrawn state on the page and refuses a second withdraw', async () => {
		const app = appOver(world)
		await request(app).post('/api/reports/1/withdraw').set('Authorization', auth('reporter-1'))
		const again = await request(app).post('/api/reports/1/withdraw').set('Authorization', auth('reporter-1'))
		expect(again.status).toBe(409)
		const page = await request(app).post('/api/reports/1/open').set('Authorization', auth('reporter-1'))
		expect(page.body.page.report.state).toBe('withdrawn')
	})

	it('refuses after staff decided and leaves the decision as it was', async () => {
		world.item = { id: 7, status: 'resolved', resolutionAction: 'dismiss', claimedBy: null }
		world.report.status = 'resolved'
		const res = await request(appOver(world)).post('/api/reports/1/withdraw').set('Authorization', auth('reporter-1'))
		expect(res.status).toBe(409)
		expect(world.item.resolutionAction).toBe('dismiss')
		expect(world.report.withdrawnAt).toBeNull()
		expect(world.events).toEqual([])
	})

	it('refuses another player', async () => {
		const res = await request(appOver(world)).post('/api/reports/1/withdraw').set('Authorization', auth('eve'))
		expect(res.status).toBe(403)
		expect(world.item.status).toBe('open')
	})
})
