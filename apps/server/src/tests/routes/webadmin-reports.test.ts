import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as reportGateway from '../../infrastructure/gateways/report.gateway.js'
import { db } from '../../infrastructure/db/index.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/report.gateway.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../infrastructure/gateways/report.gateway.js')>()
	return { ...actual, resolveReport: vi.fn() }
})

const app = createTestApp()

function authAsModerator(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: ['moderator'],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

function authAsPlainPlayer(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ privileges: [] } as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

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
	;(db as any).select = vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue([REPORT_ROW]),
				orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
			}),
		}),
	})
})

describe('GET /api/webadmin/reports/:id', () => {
	it('returns 403 for a non-privileged player', async () => {
		const token = authAsPlainPlayer('p1', 'Alice')
		const res = await request(app).get('/api/webadmin/reports/1').set('Authorization', token)
		expect(res.status).toBe(403)
	})

	it('returns 200 for a moderator', async () => {
		const token = authAsModerator('mod1', 'Mod')
		const res = await request(app).get('/api/webadmin/reports/1').set('Authorization', token)
		expect(res.status).toBe(200)
		expect(res.body.report.id).toBe(1)
	})
})

describe('PATCH /api/webadmin/reports/:id/resolve', () => {
	it('returns 403 for a non-privileged player', async () => {
		const token = authAsPlainPlayer('p1', 'Alice')
		const res = await request(app).patch('/api/webadmin/reports/1/resolve').set('Authorization', token)
		expect(res.status).toBe(403)
	})

	it('returns 200 and the resolved report for a moderator', async () => {
		vi.mocked(reportGateway.resolveReport).mockResolvedValue({ ...REPORT_ROW, status: 'resolved' } as any)
		const token = authAsModerator('mod1', 'Mod')
		const res = await request(app).patch('/api/webadmin/reports/1/resolve').set('Authorization', token)
		expect(res.status).toBe(200)
		expect(res.body.report.status).toBe('resolved')
	})
})
