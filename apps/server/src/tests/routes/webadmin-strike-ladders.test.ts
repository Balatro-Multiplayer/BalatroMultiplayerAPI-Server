import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { db } from '../../infrastructure/db/index.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import * as strikes from '../../infrastructure/gateways/strike.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock(
	'../../infrastructure/gateways/strike.gateway.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		getLadderSteps: vi.fn(),
		setLadderSteps: vi.fn().mockResolvedValue(undefined),
		listStrikes: vi.fn(),
	}),
)

const app = createTestApp()
const TARGET = '11111111-1111-4111-8111-111111111111'
const STEPS = ['warning', '24h', '7d', '30d', 'permanent'] as const

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		id: TARGET,
		privileges,
	} as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

beforeEach(() => {
	vi.mocked(strikes.getLadderSteps).mockResolvedValue({
		chat: STEPS,
		play: STEPS,
	})
	vi.mocked(strikes.listStrikes).mockResolvedValue([])
	;(db as any).transaction = vi.fn(async (run: (tx: unknown) => unknown) =>
		run({ tx: true }),
	)
})

describe('GET /api/webadmin/players/:id/strikes', () => {
	it('gives each ladder its recommended step and the strikes that count', async () => {
		const issuedAt = new Date()
		vi.mocked(strikes.listStrikes).mockResolvedValue([
			{
				id: 's1',
				ladder: 'play',
				issuedAt,
				liftedAt: null,
				appliedStep: 'warning',
				recommendedStep: 'warning',
				deviationReason: null,
			},
			{
				id: 's2',
				ladder: 'play',
				issuedAt,
				liftedAt: new Date(),
				appliedStep: '24h',
				recommendedStep: '24h',
				deviationReason: null,
			},
		] as any)
		const res = await request(app)
			.get(`/api/webadmin/players/${TARGET}/strikes`)
			.set('Authorization', authAs('mod-s1', ['moderator']))
		expect(res.status).toBe(200)
		expect(res.body.strikes.play.recommended).toBe('24h')
		expect(
			res.body.strikes.play.counting.map((s: { id: string }) => s.id),
		).toEqual(['s1'])
		expect(res.body.strikes.chat.recommended).toBe('warning')
	})
})

describe('PUT /api/webadmin/config/strike-ladders/:ladder', () => {
	const put = (token: string, body: unknown, ladder = 'play') =>
		request(app)
			.put(`/api/webadmin/config/strike-ladders/${ladder}`)
			.set('Authorization', token)
			.send(body as object)

	it('saves the steps and writes a staff log entry', async () => {
		const res = await put(authAs('adm-s1', ['admin']), {
			steps: ['24h', 'permanent'],
			reason: 'Gentler start',
		})
		expect(res.status).toBe(200)
		expect(strikes.setLadderSteps).toHaveBeenCalledWith({ tx: true }, 'play', [
			'24h',
			'permanent',
		])
		expect(recordStaffAction).toHaveBeenCalledWith(
			{ tx: true },
			expect.objectContaining({
				action: 'ladder_edit',
				reason: 'Gentler start',
				detail: { ladder: 'play', before: STEPS, after: ['24h', 'permanent'] },
			}),
		)
	})

	it('refuses a moderator, a bad ladder, bad steps and a missing reason', async () => {
		expect(
			(
				await put(authAs('mod-s2', ['moderator']), {
					steps: ['permanent'],
					reason: 'r',
				})
			).status,
		).toBe(403)
		const admin = authAs('adm-s2', ['admin'])
		expect(
			(await put(admin, { steps: ['permanent'], reason: 'r' }, 'voice')).status,
		).toBe(404)
		expect((await put(admin, { steps: ['24h'], reason: 'r' })).status).toBe(400)
		expect((await put(admin, { steps: ['permanent'] })).status).toBe(400)
		expect(strikes.setLadderSteps).not.toHaveBeenCalled()
	})
})

describe('POST /api/webadmin/players/:id/bans', () => {
	it('asks for a reason when the length differs from the recommended step', async () => {
		const res = await request(app)
			.post(`/api/webadmin/players/${TARGET}/bans`)
			.set('Authorization', authAs('mod-s3', ['moderator']))
			.send({ type: 'queue', reason: 'cheating' })
		expect(res.status).toBe(400)
		expect(res.body.error ?? res.body.message).toMatch(
			/recommended step is warning/,
		)
	})
})
