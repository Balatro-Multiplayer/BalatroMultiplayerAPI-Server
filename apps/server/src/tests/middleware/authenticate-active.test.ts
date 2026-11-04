import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as banGateway from '../../infrastructure/gateways/ban.gateway.js'
import * as reportGateway from '../../infrastructure/gateways/report.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from '../routes/app.js'

vi.mock('../../infrastructure/gateways/report.gateway.js', () => ({
	getReportById: vi.fn(),
	setAdditionalDetail: vi.fn(),
}))

const app = createTestApp()

function tokenFor(id: string) {
	createSession('Alice', { id })
	return signJwt({ playerId: id, steamName: 'Alice' })
}

beforeEach(() => {
	vi.mocked(reportGateway.getReportById).mockResolvedValue(null)
})

describe('a player with an account ban', () => {
	it('is refused by routes that need a login but are not account pages', async () => {
		vi.mocked(banGateway.hasActiveBan).mockResolvedValue(true)
		const res = await request(app)
			.get('/api/reports/1')
			.set('Authorization', `Bearer ${tokenFor('banned-1')}`)
		expect(res.status).toBe(403)
		expect(res.body.code).toBe('account_banned')
		expect(banGateway.hasActiveBan).toHaveBeenCalledWith('banned-1', 'account')
	})

	it('is refused by the staff routes too', async () => {
		vi.mocked(banGateway.hasActiveBan).mockResolvedValue(true)
		const res = await request(app)
			.get('/api/webadmin/players')
			.set('Authorization', `Bearer ${tokenFor('banned-2')}`)
		expect(res.status).toBe(403)
		expect(res.body.code).toBe('account_banned')
	})

	it('still reaches the account pages', async () => {
		vi.mocked(banGateway.hasActiveBan).mockResolvedValue(true)
		const res = await request(app)
			.get('/api/auth/me')
			.set('Authorization', `Bearer ${tokenFor('banned-3')}`)
		expect(res.status).toBe(200)
	})
})

describe('a player without an account ban', () => {
	it('reaches routes that need a login', async () => {
		vi.mocked(banGateway.hasActiveBan).mockResolvedValue(false)
		const res = await request(app)
			.get('/api/reports/1')
			.set('Authorization', `Bearer ${tokenFor('free-1')}`)
		expect(res.status).toBe(404)
	})
})
