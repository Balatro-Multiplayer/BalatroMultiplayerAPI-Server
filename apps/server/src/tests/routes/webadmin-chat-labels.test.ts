import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as flaggedChat from '../../infrastructure/gateways/flagged-chat.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/flagged-chat.gateway.js', () => ({
	listChatLabels: vi.fn().mockResolvedValue([]),
}))

const app = createTestApp()

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges,
	} as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

describe('GET /api/webadmin/chat-labels/export', () => {
	it('refuses a moderator', async () => {
		const res = await request(app)
			.get('/api/webadmin/chat-labels/export')
			.set('Authorization', authAs('mod', ['moderator']))
		expect(res.status).toBe(403)
		expect(flaggedChat.listChatLabels).not.toHaveBeenCalled()
	})

	it('gives an admin every label as CSV', async () => {
		vi.mocked(flaggedChat.listChatLabels).mockResolvedValue([
			{
				message: 'hi',
				context: ['a'],
				score: 0.5,
				band: 'review',
				label: 'not_harmful',
				decidedAt: new Date('2026-01-01T00:00:00Z'),
			},
		] as any)
		const res = await request(app)
			.get('/api/webadmin/chat-labels/export')
			.set('Authorization', authAs('adm', ['admin']))
		expect(res.status).toBe(200)
		expect(res.headers['content-type']).toContain('text/csv')
		expect(res.text).toContain('message,context,score,band,label,decided_at')
		expect(res.text).toContain(
			'hi,"[""a""]",0.5,review,not_harmful,2026-01-01T00:00:00.000Z',
		)
	})
})
