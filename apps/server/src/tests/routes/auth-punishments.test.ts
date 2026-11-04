import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as banGateway from '../../infrastructure/gateways/ban.gateway.js'
import * as appealGateway from '../../infrastructure/gateways/appeal.gateway.js'
import * as warningGateway from '../../infrastructure/gateways/warning.gateway.js'
import * as adminClient from '../../infrastructure/nakama/admin-client.js'
import { err, ok } from '../../shared/utils/result.js'
import { appealService } from '../../features/appeals/appeals.deps.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/appeal.gateway.js', () => ({
	listAppealsOf: vi.fn(),
	appealHistory: vi.fn(),
	getAppealById: vi.fn(),
	insertAppeal: vi.fn(),
	findPunishmentRef: vi.fn(),
	settleAppealRow: vi.fn(),
	liftWarning: vi.fn(),
	setBanEnd: vi.fn(),
}))
vi.mock('../../features/appeals/appeals.deps.js', () => ({ appealService: { submit: vi.fn() } }))
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
	vi.mocked(appealGateway.listAppealsOf).mockResolvedValue([])
	vi.mocked(adminClient.callNakamaRpc).mockResolvedValue(ok({ banned: false, banIds: [] }))
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
		vi.mocked(adminClient.callNakamaRpc).mockResolvedValue(ok({ banned: true, banIds: ['nb-1'] }))
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

const appealRow = (over: Record<string, unknown>) => ({
	id: 'a1',
	playerId: 'pp-4',
	targetKind: 'network_ban',
	punishmentId: null,
	networkBanIds: ['nb-1'],
	message: 'Shared address',
	status: 'denied',
	decisionReason: 'Not shared',
	outcome: null,
	decidedBy: 'moderator:secret-mod',
	decidedAt: new Date(),
	createdAt: new Date(Date.now() - 86_400_000),
	...over,
})

describe('appeals on the account page', () => {
	it('shows the appeal state of a punishment and of the network ban, with no ban ids or staff names', async () => {
		vi.mocked(adminClient.callNakamaRpc).mockResolvedValue(ok({ banned: true, banIds: ['nb-1'] }))
		vi.mocked(appealGateway.listAppealsOf).mockResolvedValue([appealRow({}) as any])
		const res = await request(app)
			.get('/api/auth/punishments')
			.set('Authorization', `Bearer ${token('pp-4')}`)
		expect(res.body.networkAppeal).toMatchObject({ appeal: { status: 'denied', reason: 'Not shared' }, canAppeal: false })
		expect(JSON.stringify(res.body)).not.toContain('secret-mod')
		expect(JSON.stringify(res.body)).not.toContain('nb-1')
	})

	it('offers a network appeal to a blocked player with none yet', async () => {
		vi.mocked(adminClient.callNakamaRpc).mockResolvedValue(ok({ banned: true, banIds: ['nb-1'] }))
		const res = await request(app)
			.get('/api/auth/punishments')
			.set('Authorization', `Bearer ${token('pp-5')}`)
		expect(res.body.networkAppeal).toMatchObject({ appeal: null, canAppeal: true })
	})
})

describe('POST /api/auth/appeals', () => {
	const post = (id: string, body: unknown) =>
		request(app).post('/api/auth/appeals').set('Authorization', `Bearer ${token(id)}`).send(body as object)

	it('needs a login', async () => {
		expect((await request(app).post('/api/auth/appeals').send({})).status).toBe(401)
	})

	it('hands a punishment appeal to the service, for a banned account too', async () => {
		const id = '00000000-0000-4000-8000-0000000000b1'
		vi.mocked(appealService.submit).mockResolvedValue({ ok: true, value: appealRow({ status: 'open', decisionReason: null, decidedAt: null }) as any })
		const res = await post('pp-6', { punishmentId: id, message: 'Please look again' })
		expect(res.status).toBe(201)
		expect(appealService.submit).toHaveBeenCalledWith({ playerId: 'pp-6', punishmentId: id, message: 'Please look again', networkBanIds: [] })
		expect(res.body.appeal).toMatchObject({ status: 'open' })
	})

	it("asks Nakama which network bans cover the player's address for a network appeal", async () => {
		vi.mocked(adminClient.callNakamaRpc).mockResolvedValue(ok({ banned: true, banIds: ['nb-9'] }))
		vi.mocked(appealService.submit).mockResolvedValue({ ok: true, value: appealRow({ status: 'open' }) as any })
		await post('pp-7', { message: 'Shared address' })
		expect(appealService.submit).toHaveBeenCalledWith({ playerId: 'pp-7', punishmentId: null, message: 'Shared address', networkBanIds: ['nb-9'] })
	})

	it('refuses an id that is not a punishment id, and a message that is not text', async () => {
		expect((await post('pp-8', { punishmentId: 'nope', message: 'x' })).status).toBe(404)
		expect((await post('pp-8', { message: 5 })).status).toBe(400)
	})

	it('answers each refusal with a status and a code', async () => {
		const id = '00000000-0000-4000-8000-0000000000b1'
		const refuse = async (refusal: object) => {
			vi.mocked(appealService.submit).mockResolvedValue({ ok: false, refusal } as any)
			return post('pp-9', { punishmentId: id, message: 'x' })
		}
		expect((await refuse({ code: 'open' })).status).toBe(409)
		expect((await refuse({ code: 'not_found' })).status).toBe(404)
		expect((await refuse({ code: 'invalid_message', message: 'message is required' })).status).toBe(400)
		const waiting = await refuse({ code: 'cooling_down', availableAt: new Date('2026-12-01T00:00:00Z') })
		expect(waiting.status).toBe(409)
		expect(waiting.body).toMatchObject({ code: 'cooling_down', availableAt: '2026-12-01T00:00:00.000Z' })
	})
})
