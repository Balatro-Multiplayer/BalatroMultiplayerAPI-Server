import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock(
	'../../infrastructure/gateways/player-page.gateway.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		listPlayerChatPage: vi.fn(),
	}),
)

import { signJwt } from '../../features/auth/jwt.js'
import * as pageGateway from '../../infrastructure/gateways/player-page.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()
const TARGET = 'target-1'
const RUN = '11111111-1111-4111-8111-111111111111'

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockImplementation((async (
		id: string,
	) => (id === TARGET || id === playerId ? { id, privileges } : null)) as never)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const line = (
	id: number,
	lobbyId: string | null,
	lobbyCode: string,
	flagged = false,
	runId: string | null = null,
) => ({
	id,
	lobbyId,
	lobbyCode,
	runId,
	message: `m${id}`,
	flagged,
	sentAt: new Date(`2026-11-01T10:0${id}:00Z`),
})

beforeEach(() => {
	vi.mocked(pageGateway.listPlayerChatPage).mockResolvedValue({
		lines: [],
		total: 0,
	})
})

describe('GET /api/webadmin/players/:id/chat', () => {
	it('refuses a player with no staff role', async () => {
		const res = await request(app)
			.get(`/api/webadmin/players/${TARGET}/chat`)
			.set('Authorization', authAs('plain', []))
		expect(res.status).toBe(403)
	})

	it('answers 404 for an unknown player', async () => {
		const res = await request(app)
			.get('/api/webadmin/players/nobody/chat')
			.set('Authorization', authAs('mod-1', ['moderator']))
		expect(res.status).toBe(404)
	})

	it('pages the player chat and passes the page, size and flagged-first choice on', async () => {
		vi.mocked(pageGateway.listPlayerChatPage).mockResolvedValue({
			lines: [],
			total: 205,
		})
		const res = await request(app)
			.get(
				`/api/webadmin/players/${TARGET}/chat?page=2&limit=50&flaggedFirst=true`,
			)
			.set('Authorization', authAs('mod-1', ['moderator']))
		expect(res.status).toBe(200)
		expect(pageGateway.listPlayerChatPage).toHaveBeenCalledWith(TARGET, {
			page: 2,
			limit: 50,
			flaggedFirst: true,
		})
		expect(res.body).toMatchObject({ total: 205, page: 2, limit: 50, pages: 5 })
	})

	it('defaults to page 1, 100 lines, newest first, and clamps a bad size', async () => {
		await request(app)
			.get(`/api/webadmin/players/${TARGET}/chat?limit=9999`)
			.set('Authorization', authAs('mod-1', ['moderator']))
		expect(pageGateway.listPlayerChatPage).toHaveBeenCalledWith(TARGET, {
			page: 1,
			limit: 200,
			flaggedFirst: false,
		})
	})

	it('groups the lines by lobby and links a group to its match', async () => {
		vi.mocked(pageGateway.listPlayerChatPage).mockResolvedValue({
			lines: [
				line(5, 'lobby-b', 'BBB', true, RUN),
				line(4, 'lobby-b', 'BBB', false, RUN),
				line(3, 'lobby-a', 'AAA'),
				line(2, null, 'CCC'),
			],
			total: 4,
		})
		const res = await request(app)
			.get(`/api/webadmin/players/${TARGET}/chat`)
			.set('Authorization', authAs('mod-1', ['moderator']))
		const groups = res.body.groups
		expect(groups).toHaveLength(3)
		expect(groups[0]).toMatchObject({
			lobbyCode: 'BBB',
			runId: RUN,
			flagged: true,
		})
		expect(groups[0].lines.map((l: { id: number }) => l.id)).toEqual([5, 4])
		expect(groups[1]).toMatchObject({
			lobbyCode: 'AAA',
			runId: null,
			flagged: false,
		})
		expect(groups[2]).toMatchObject({ lobbyCode: 'CCC', runId: null })
	})
})
