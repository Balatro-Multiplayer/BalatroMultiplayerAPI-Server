import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as banGateway from '../../infrastructure/gateways/ban.gateway.js'
import * as warningGateway from '../../infrastructure/gateways/warning.gateway.js'
import * as adminClient from '../../infrastructure/nakama/admin-client.js'
import { err, ok } from '../../shared/utils/result.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/warning.gateway.js', () => ({
	listWarnings: vi.fn(),
	insertWarning: vi.fn(),
}))
vi.mock('../../infrastructure/nakama/admin-client.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../infrastructure/nakama/admin-client.js')>()),
	callNakamaRpc: vi.fn(),
	isNakamaAdminEnabled: vi.fn(() => true),
}))

const app = createTestApp()
const token = (id: string) => {
	createSession('Alice', { id })
	return signJwt({ playerId: id, steamName: 'Alice' })
}

beforeEach(() => {
	vi.mocked(banGateway.listBans).mockResolvedValue([])
	vi.mocked(warningGateway.listWarnings).mockResolvedValue([])
	vi.mocked(adminClient.callNakamaRpc).mockResolvedValue(ok({ banned: false }))
})

describe('GET /api/auth/punishments', () => {
	it('needs a login', async () => {
		expect((await request(app).get('/api/auth/punishments')).status).toBe(401)
	})

	it('lists the punishments without the staff name, to a banned account', async () => {
		vi.mocked(banGateway.listBans).mockResolvedValue([
			{
				id: 'b1',
				playerId: 'pp-1',
				banType: 'account',
				expiresAt: null,
				issuedBy: 'admin:secret-staff-id',
				issuedAt: new Date('2026-05-01T00:00:00Z'),
				reason: 'Cheating',
				liftedAt: null,
				liftedBy: null,
			},
		])
		const res = await request(app)
			.get('/api/auth/punishments')
			.set('Authorization', `Bearer ${token('pp-1')}`)
		expect(res.status).toBe(200)
		expect(res.body.punishments).toHaveLength(1)
		expect(res.body.punishments[0]).toMatchObject({ type: 'account_ban', permanent: true, reason: 'Cheating' })
		expect(JSON.stringify(res.body)).not.toContain('secret-staff-id')
		expect(res.body.networkBanned).toBe(false)
	})

	it('tells a player on a banned network, with no punishment of their own', async () => {
		vi.mocked(adminClient.callNakamaRpc).mockResolvedValue(ok({ banned: true }))
		const res = await request(app)
			.get('/api/auth/punishments')
			.set('Authorization', `Bearer ${token('pp-2')}`)
		expect(res.body).toMatchObject({ punishments: [], networkBanned: true })
		expect(adminClient.callNakamaRpc).toHaveBeenCalledWith('admin_network_check', { ip: expect.any(String) })
	})

	it('says the network is not banned when Nakama cannot answer', async () => {
		vi.mocked(adminClient.callNakamaRpc).mockResolvedValue(err('unreachable'))
		const res = await request(app)
			.get('/api/auth/punishments')
			.set('Authorization', `Bearer ${token('pp-3')}`)
		expect(res.status).toBe(200)
		expect(res.body.networkBanned).toBe(false)
	})
})
