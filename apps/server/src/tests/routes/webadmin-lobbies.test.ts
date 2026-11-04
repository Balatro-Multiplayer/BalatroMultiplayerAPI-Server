import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Lobbies live in Nakama; the route only relays to these admin RPC wrappers.
vi.mock(
	'../../infrastructure/nakama/moderation-sync.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		listNakamaLobbies: vi.fn(),
		getNakamaLobby: vi.fn(),
		kickFromNakamaLobby: vi.fn(),
		closeNakamaLobby: vi.fn(),
	}),
)

import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import {
	closeNakamaLobby,
	getNakamaLobby,
	kickFromNakamaLobby,
	listNakamaLobbies,
} from '../../infrastructure/nakama/moderation-sync.js'
import type {
	NakamaLobbyDetail,
	NakamaLobbySummary,
} from '../../infrastructure/nakama/moderation-sync.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()

function authWith(privileges: string[], playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges,
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

function summary(code: string): NakamaLobbySummary {
	return {
		code,
		modId: 'mod1',
		type: 'private',
		mode: 'default',
		started: false,
		size: 2,
		max: 4,
		matchId: `match-${code}`,
	}
}

const DETAIL: NakamaLobbyDetail = {
	code: 'ABCDE',
	modId: 'mod1',
	hostId: 'host-1',
	maxPlayers: 4,
	createdAt: Date.UTC(2026, 0, 1),
	metadata: { ruleset: 'standard' },
	started: true,
	players: [
		{ id: 'host-1', displayName: 'Host', connected: true },
		{ id: 'guest-1', displayName: 'Guest', connected: false },
	],
	spectators: [],
	matchId: 'match-ABCDE',
}

beforeEach(() => {
	vi.mocked(listNakamaLobbies).mockResolvedValue([])
	vi.mocked(getNakamaLobby).mockResolvedValue(null)
	vi.mocked(kickFromNakamaLobby).mockResolvedValue(false)
	vi.mocked(closeNakamaLobby).mockResolvedValue(false)
})

describe('GET /api/webadmin/lobbies', () => {
	it('returns 403 for a non-admin/moderator', async () => {
		const res = await request(app)
			.get('/api/webadmin/lobbies')
			.set('Authorization', authWith([], 'plain-1', 'Plain'))
		expect(res.status).toBe(403)
	})

	it("lists Nakama's lobbies", async () => {
		vi.mocked(listNakamaLobbies).mockResolvedValue([
			summary('ABCDE'),
			summary('FGHIJ'),
		])

		const res = await request(app)
			.get('/api/webadmin/lobbies')
			.set('Authorization', authWith(['moderator'], 'mod-1', 'Mod'))

		expect(res.status).toBe(200)
		expect(res.body.total).toBe(2)
		expect(res.body.lobbies[0]).toMatchObject({
			source: 'nakama',
			code: 'ABCDE',
			playerCount: 2,
			maxPlayers: 4,
		})
	})

	it('filters by code, case-insensitively', async () => {
		vi.mocked(listNakamaLobbies).mockResolvedValue([
			summary('ABCDE'),
			summary('FGHIJ'),
		])

		const res = await request(app)
			.get('/api/webadmin/lobbies?search=fgh')
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))

		expect(res.body.total).toBe(1)
		expect(res.body.lobbies[0].code).toBe('FGHIJ')
	})

	it('pages the list', async () => {
		vi.mocked(listNakamaLobbies).mockResolvedValue(
			['AAAAA', 'BBBBB', 'CCCCC'].map(summary),
		)

		const res = await request(app)
			.get('/api/webadmin/lobbies?page=2&limit=2')
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))

		expect(res.body.total).toBe(3)
		expect(res.body.lobbies.map((l: { code: string }) => l.code)).toEqual([
			'CCCCC',
		])
	})
})

describe('GET /api/webadmin/lobbies/:code', () => {
	it('returns lobby detail including players', async () => {
		vi.mocked(getNakamaLobby).mockResolvedValue(DETAIL)

		const res = await request(app)
			.get('/api/webadmin/lobbies/ABCDE')
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))

		expect(res.status).toBe(200)
		expect(getNakamaLobby).toHaveBeenCalledWith('ABCDE')
		expect(res.body.lobby).toMatchObject({
			code: 'ABCDE',
			hostId: 'host-1',
			playerCount: 2,
			started: true,
			createdAt: '2026-01-01T00:00:00.000Z',
		})
		expect(res.body.players).toHaveLength(2)
	})

	it('returns 404 for a lobby that does not exist', async () => {
		const res = await request(app)
			.get('/api/webadmin/lobbies/ZZZZZ')
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))
		expect(res.status).toBe(404)
	})
})

describe('POST /api/webadmin/lobbies/:code/kick/:playerId', () => {
	it('kicks through Nakama, naming the acting moderator', async () => {
		vi.mocked(kickFromNakamaLobby).mockResolvedValue(true)

		const res = await request(app)
			.post('/api/webadmin/lobbies/ABCDE/kick/guest-1')
			.set('Authorization', authWith(['moderator'], 'mod-1', 'Mod'))
			.send({ reason: 'test' })

		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true })
		expect(kickFromNakamaLobby).toHaveBeenCalledWith(
			'ABCDE',
			'guest-1',
			'admin:mod-1',
		)
	})

	it('returns 404 when Nakama has no such lobby or player', async () => {
		const res = await request(app)
			.post('/api/webadmin/lobbies/ABCDE/kick/nobody')
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))
			.send({ reason: 'test' })
		expect(res.status).toBe(404)
	})

	it('returns 403 for a non-admin/moderator', async () => {
		const res = await request(app)
			.post('/api/webadmin/lobbies/ABCDE/kick/guest-1')
			.set('Authorization', authWith([], 'plain-1', 'Plain'))
			.send({ reason: 'test' })
		expect(res.status).toBe(403)
		expect(kickFromNakamaLobby).not.toHaveBeenCalled()
	})
})

describe('POST /api/webadmin/lobbies/:code/close', () => {
	it('closes through Nakama', async () => {
		vi.mocked(closeNakamaLobby).mockResolvedValue(true)

		const res = await request(app)
			.post('/api/webadmin/lobbies/ABCDE/close')
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))
			.send({ reason: 'test' })

		expect(res.status).toBe(200)
		expect(closeNakamaLobby).toHaveBeenCalledWith('ABCDE')
	})

	it('returns 404 for a lobby that does not exist', async () => {
		const res = await request(app)
			.post('/api/webadmin/lobbies/ZZZZZ/close')
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))
			.send({ reason: 'test' })
		expect(res.status).toBe(404)
	})
})
