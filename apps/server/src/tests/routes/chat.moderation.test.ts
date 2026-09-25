import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import type { ChatResult } from '../../features/chat/chat.service.js'
import { processAndPublishMessage } from '../../features/chat/chat.service.js'
import { setConfig } from '../../state/config.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

// The route's job is the reason -> status -> copy mapping; the decision
// matrix behind each reason (local obscenity filter vs. the moderation
// bridge, band handling, ...) is covered where it's made, in
// moderation.test.ts and chat.service.test.ts.
vi.mock('../../features/chat/chat.service.js', () => ({
	processAndPublishMessage: vi.fn(),
}))

const mockProcessAndPublishMessage = vi.mocked(processAndPublishMessage)

const app = createTestApp()

function authHeader(playerId: string, steamName: string, lobbyCode?: string) {
	createSession(steamName, { id: playerId, chatEnabled: true })
	const token = signJwt({ playerId, steamName, lobbyCode })
	return `Bearer ${token}`
}

async function createLobby(hostId: string, hostName: string) {
	const res = await request(app)
		.post('/api/lobbies')
		.set('Authorization', authHeader(hostId, hostName))
		.send({ modId: 'mod1' })
	return res.body.lobby.code as string
}

describe('POST /api/lobbies/:code/chat', () => {
	beforeEach(() => {
		setConfig({
			tosVersion: 0,
			mods: [],
			chatAllowlist: new Set(),
			chatEnabled: true,
		})
	})

	// 'moderated' fires identically whether processAndPublishMessage reached
	// it via the dormant local obscenity filter (MODERATION_SERVICE_URL unset,
	// the default) or the remote bridge — the route maps on `reason`, not on
	// which path produced it, so this one case stands in for both. Every
	// string here is the pre-existing/legacy copy and must not change: an
	// upgrade to the bridge must not alter what a dormant-config deployment
	// already sends.
	it.each([
		['empty', 400, 'Message cannot be empty'],
		['moderated', 403, 'Message was rejected by moderation'],
		[
			'unavailable',
			503,
			'Chat moderation is unavailable. Try again in a moment.',
		],
	] as const)(
		'maps reason %s to status %i with the exact player-facing string',
		async (reason, status, message) => {
			const code = await createLobby('host1', 'Alice')
			mockProcessAndPublishMessage.mockResolvedValue({ ok: false, reason })

			const res = await request(app)
				.post(`/api/lobbies/${code}/chat`)
				.set('Authorization', authHeader('host1', 'Alice', code))
				.send({ message: 'hello' })

			expect(res.status).toBe(status)
			expect(res.body).toEqual({ error: message })
		},
	)

	it('falls back to a 500 with the generic copy for an unrecognised reason', async () => {
		const code = await createLobby('host1', 'Alice')
		// Outside the typed ChatBlockReason union on purpose — this exercises
		// the defensive fallback a caller can only reach by disagreeing with the
		// type checker (e.g. a stale build of chat.service.js).
		mockProcessAndPublishMessage.mockResolvedValue({
			ok: false,
			reason: 'something_else',
		} as unknown as ChatResult)

		const res = await request(app)
			.post(`/api/lobbies/${code}/chat`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ message: 'hello' })

		expect(res.status).toBe(500)
		expect(res.body).toEqual({
			error: 'Failed to send message',
		})
	})

	it('returns { ok: true } with no publishText when nothing was rewritten', async () => {
		const code = await createLobby('host1', 'Alice')
		mockProcessAndPublishMessage.mockResolvedValue({ ok: true })

		const res = await request(app)
			.post(`/api/lobbies/${code}/chat`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ message: 'hello there' })

		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true })
	})

	it('returns { ok: true, publishText } when the message was rewritten', async () => {
		const code = await createLobby('host1', 'Alice')
		mockProcessAndPublishMessage.mockResolvedValue({
			ok: true,
			publishText: '**** you',
		})

		const res = await request(app)
			.post(`/api/lobbies/${code}/chat`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ message: 'not repeating that here' })

		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true, publishText: '**** you' })
	})
})
