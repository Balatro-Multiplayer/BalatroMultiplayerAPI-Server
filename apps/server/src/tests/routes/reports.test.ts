import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as reportGateway from '../../infrastructure/gateways/report.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/report.gateway.js', () => ({
	getReportById: vi.fn(),
	setAdditionalDetail: vi.fn(),
}))

const app = createTestApp()

const REPORT_ROW = {
	id: 1,
	lobbyId: 'lobby-uuid-1',
	lobbyCode: 'ABCDEF',
	reporterId: 'reporter-1',
	reportedId: 'reported-1',
	type: 'cheating',
	runId: null,
	status: 'open',
	message: null,
	additionalDetail: null,
	createdAt: new Date(),
}

beforeEach(() => {
	vi.mocked(reportGateway.getReportById).mockResolvedValue(REPORT_ROW as any)
})

describe('GET /api/reports/:id', () => {
	it('returns 401 when Authorization header is missing', async () => {
		const res = await request(app).get('/api/reports/1')
		expect(res.status).toBe(401)
	})

	it('returns 404 for an unknown report id', async () => {
		vi.mocked(reportGateway.getReportById).mockResolvedValueOnce(null)
		createSession('Alice', { id: 'reporter-1' })
		const token = signJwt({ playerId: 'reporter-1', steamName: 'Alice' })

		const res = await request(app).get('/api/reports/999').set('Authorization', `Bearer ${token}`)
		expect(res.status).toBe(404)
	})

	it('returns 403 when the requester is not the reporter', async () => {
		createSession('Eve', { id: 'someone-else' })
		const token = signJwt({ playerId: 'someone-else', steamName: 'Eve' })

		const res = await request(app).get('/api/reports/1').set('Authorization', `Bearer ${token}`)
		expect(res.status).toBe(403)
	})

	it('returns the report when the requester is the reporter', async () => {
		createSession('Alice', { id: 'reporter-1' })
		const token = signJwt({ playerId: 'reporter-1', steamName: 'Alice' })

		const res = await request(app).get('/api/reports/1').set('Authorization', `Bearer ${token}`)
		expect(res.status).toBe(200)
		expect(res.body.report.id).toBe(1)
	})
})

describe('PATCH /api/reports/:id', () => {
	it('returns 403 when the requester is not the reporter', async () => {
		createSession('Eve', { id: 'someone-else' })
		const token = signJwt({ playerId: 'someone-else', steamName: 'Eve' })

		const res = await request(app)
			.patch('/api/reports/1')
			.set('Authorization', `Bearer ${token}`)
			.send({ additionalDetail: 'more info' })
		expect(res.status).toBe(403)
	})

	it('returns 400 when additionalDetail exceeds the length cap', async () => {
		createSession('Alice', { id: 'reporter-1' })
		const token = signJwt({ playerId: 'reporter-1', steamName: 'Alice' })

		const res = await request(app)
			.patch('/api/reports/1')
			.set('Authorization', `Bearer ${token}`)
			.send({ additionalDetail: 'x'.repeat(2001) })
		expect(res.status).toBe(400)
	})

	it('updates additionalDetail when the requester is the reporter', async () => {
		createSession('Alice', { id: 'reporter-1' })
		const token = signJwt({ playerId: 'reporter-1', steamName: 'Alice' })
		vi.mocked(reportGateway.setAdditionalDetail).mockResolvedValue({
			...REPORT_ROW,
			additionalDetail: 'more info',
		} as any)

		const res = await request(app)
			.patch('/api/reports/1')
			.set('Authorization', `Bearer ${token}`)
			.send({ additionalDetail: 'more info' })

		expect(res.status).toBe(200)
		expect(res.body.report.additionalDetail).toBe('more info')
		expect(vi.mocked(reportGateway.setAdditionalDetail)).toHaveBeenCalledWith(1, 'more info')
	})
})
