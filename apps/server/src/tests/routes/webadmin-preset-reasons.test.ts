import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PRESET_LENGTH } from '../../features/service-queue/preset-reasons.js'
import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as presets from '../../infrastructure/gateways/preset-reasons.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock(
	'../../infrastructure/gateways/preset-reasons.gateway.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		getPresetReasons: vi.fn(),
		editPresetReasons: vi.fn(),
	}),
)

const app = createTestApp()
const TARGET = '11111111-1111-4111-8111-111111111111'
const LISTS = { flagged_chat: ['Spam.'], report: [] }

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		id: TARGET,
		privileges,
	} as never)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

beforeEach(() => {
	vi.mocked(presets.getPresetReasons).mockResolvedValue(LISTS as never)
	vi.mocked(presets.editPresetReasons)
		.mockReset()
		.mockResolvedValue(LISTS as never)
})

describe('GET /api/webadmin/preset-reasons', () => {
	it('gives the lists to a moderator and to an admin', async () => {
		for (const [id, role] of [
			['mod-p1', 'moderator'],
			['adm-p1', 'admin'],
		]) {
			const res = await request(app)
				.get('/api/webadmin/preset-reasons')
				.set('Authorization', authAs(id, [role]))
			expect(res.status).toBe(200)
			expect(res.body.presetReasons).toEqual(LISTS)
		}
	})
	it('refuses a player with no staff role', async () => {
		const res = await request(app)
			.get('/api/webadmin/preset-reasons')
			.set('Authorization', authAs('plain-p1', []))
		expect(res.status).toBe(403)
	})
})

describe('PUT /api/webadmin/config/preset-reasons/:itemType', () => {
	const put = (token: string, body: unknown, type = 'flagged_chat') =>
		request(app)
			.put(`/api/webadmin/config/preset-reasons/${type}`)
			.set('Authorization', token)
			.send(body as object)

	it('saves the list with the note and returns the saved lists', async () => {
		const res = await put(authAs('adm-p2', ['admin']), {
			reasons: [' Slur. ', 'Spam.'],
			reason: 'Reworded',
		})
		expect(res.status).toBe(200)
		expect(res.body.presetReasons).toEqual(LISTS)
		expect(presets.editPresetReasons).toHaveBeenCalledWith(
			{ playerId: 'adm-p2', role: 'admin' },
			'flagged_chat',
			['Slur.', 'Spam.'],
			'Reworded',
		)
	})

	it('refuses a moderator', async () => {
		const res = await put(authAs('mod-p2', ['moderator']), {
			reasons: ['a'],
			reason: 'r',
		})
		expect(res.status).toBe(403)
		expect(presets.editPresetReasons).not.toHaveBeenCalled()
	})

	it('refuses an unknown type, a missing note and bad lists', async () => {
		const admin = authAs('adm-p3', ['admin'])
		expect(
			(await put(admin, { reasons: ['a'], reason: 'r' }, 'voice')).status,
		).toBe(404)
		expect((await put(admin, { reasons: ['a'] })).status).toBe(400)
		expect((await put(admin, { reasons: ['a'], reason: '  ' })).status).toBe(
			400,
		)
		expect(
			(await put(admin, { reasons: ['a', ' '], reason: 'r' })).status,
		).toBe(400)
		expect(
			(
				await put(admin, {
					reasons: ['x'.repeat(MAX_PRESET_LENGTH + 1)],
					reason: 'r',
				})
			).status,
		).toBe(400)
		expect((await put(admin, { reason: 'r' })).status).toBe(400)
		expect(presets.editPresetReasons).not.toHaveBeenCalled()
	})
})
