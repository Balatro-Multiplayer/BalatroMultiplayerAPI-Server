import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../infrastructure/gateways/match-staff.gateway.js', () => ({
	findRunWindow: vi.fn(),
	findRunMatch: vi.fn(),
	findRunRatings: vi.fn(),
	listQueueItemsAboutRun: vi.fn(),
	listRunChat: vi.fn(),
	listStaffActionsForRun: vi.fn(),
}))

import { signJwt } from '../../features/auth/jwt.js'
import * as gateway from '../../infrastructure/gateways/match-staff.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()
const RUN = '11111111-1111-4111-8111-111111111111'
const STARTED = new Date('2026-11-01T10:00:00Z')
const ENDED = new Date('2026-11-01T10:30:00Z')

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges,
	} as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

beforeEach(() => {
	vi.mocked(gateway.findRunWindow).mockResolvedValue({
		runId: RUN,
		lobbyCode: 'BG1MB',
		startedAt: STARTED,
		finalizedAt: ENDED,
	})
	vi.mocked(gateway.listRunChat).mockResolvedValue([
		{
			id: 1,
			playerId: 'p1',
			displayName: 'SWIM',
			message: 'gl',
			flagged: false,
			sentAt: new Date('2026-11-01T10:05:00Z'),
		},
	])
})

describe('GET /api/webadmin/matches/:runId/chat', () => {
	it('refuses a signed-out caller', async () => {
		const res = await request(app).get(`/api/webadmin/matches/${RUN}/chat`)
		expect(res.status).toBe(401)
		expect(gateway.listRunChat).not.toHaveBeenCalled()
	})

	it('refuses a player with no staff role', async () => {
		const res = await request(app)
			.get(`/api/webadmin/matches/${RUN}/chat`)
			.set('Authorization', authAs('plain', []))
		expect(res.status).toBe(403)
		expect(gateway.findRunWindow).not.toHaveBeenCalled()
		expect(gateway.listRunChat).not.toHaveBeenCalled()
	})

	it('gives a moderator the lobby lines of the match window', async () => {
		const res = await request(app)
			.get(`/api/webadmin/matches/${RUN}/chat`)
			.set('Authorization', authAs('mod-1', ['moderator']))
		expect(res.status).toBe(200)
		expect(res.body.lines).toHaveLength(1)
		expect(res.body.window).toEqual({
			from: STARTED.toISOString(),
			to: ENDED.toISOString(),
		})
		expect(gateway.listRunChat).toHaveBeenCalledWith(
			expect.objectContaining({
				lobbyCode: 'BG1MB',
				startedAt: STARTED,
				finalizedAt: ENDED,
			}),
			expect.any(Date),
		)
	})

	it('answers 404 for a run that does not exist', async () => {
		vi.mocked(gateway.findRunWindow).mockResolvedValue(null)
		const res = await request(app)
			.get(`/api/webadmin/matches/${RUN}/chat`)
			.set('Authorization', authAs('adm-1', ['admin']))
		expect(res.status).toBe(404)
		expect(gateway.listRunChat).not.toHaveBeenCalled()
	})
})

describe('GET /api/webadmin/matches/:runId/staff', () => {
	beforeEach(() => {
		vi.mocked(gateway.findRunMatch).mockResolvedValue({
			matchId: RUN,
			gameMode: 'ranked:pvp_ranked_expanded',
			modId: 'MultiplayerPvP',
			status: 'resolved',
			resultPlacements: [
				{ playerId: 'p2', place: 2 },
				{ playerId: 'p1', place: 1 },
			],
			playerNames: { p1: 'SWIM', p2: 'rdpaul1234' },
		})
		vi.mocked(gateway.findRunRatings).mockResolvedValue(
			new Map([['p1', { delta: 23, newRating: 767, isPlacement: false }]]),
		)
		vi.mocked(gateway.listQueueItemsAboutRun).mockResolvedValue([
			{
				id: 7,
				itemType: 'forfeit_reconciliation',
				status: 'open',
				summary: 'Forfeit: rdpaul1234',
				createdAt: new Date('2026-11-01T11:00:00Z'),
				claimedBy: 'moderator:mod-1',
				claimedUntil: new Date(Date.now() + 60_000),
			} as any,
		])
		vi.mocked(gateway.listStaffActionsForRun).mockResolvedValue([])
	})

	it('refuses a player with no staff role', async () => {
		const res = await request(app)
			.get(`/api/webadmin/matches/${RUN}/staff`)
			.set('Authorization', authAs('plain', []))
		expect(res.status).toBe(403)
		expect(gateway.findRunMatch).not.toHaveBeenCalled()
	})

	it('gives staff the result, the queue items and the staff actions', async () => {
		const res = await request(app)
			.get(`/api/webadmin/matches/${RUN}/staff`)
			.set('Authorization', authAs('mod-1', ['moderator']))
		expect(res.status).toBe(200)
		expect(res.body.result.map((r: any) => r.playerId)).toEqual(['p1', 'p2'])
		expect(res.body.result[0]).toMatchObject({
			displayName: 'SWIM',
			delta: 23,
			newRating: 767,
		})
		expect(res.body.result[1].delta).toBeNull()
		expect(res.body.queueItems).toEqual([
			expect.objectContaining({ id: 7, claim: 'you' }),
		])
		expect(gateway.listQueueItemsAboutRun).toHaveBeenCalledWith(
			RUN,
			'moderator',
		)
		expect(gateway.listStaffActionsForRun).toHaveBeenCalledWith(
			{ playerId: 'mod-1', role: 'moderator' },
			RUN,
			[7],
		)
	})

	it("marks another staff member's claim as other", async () => {
		const res = await request(app)
			.get(`/api/webadmin/matches/${RUN}/staff`)
			.set('Authorization', authAs('adm-1', ['admin']))
		expect(res.body.queueItems[0].claim).toBe('other')
	})
})
