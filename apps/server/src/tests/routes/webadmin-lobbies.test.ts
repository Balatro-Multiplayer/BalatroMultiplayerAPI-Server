import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()

function authHeader(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	return `Bearer ${signJwt({ playerId, steamName })}`
}

function authAsModerator(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: ['moderator'],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

function authAsAdmin(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: ['admin'],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

async function createRealLobby(
	hostId: string,
	steamName: string,
	modId = 'mod1',
) {
	const res = await request(app)
		.post('/api/lobbies')
		.set('Authorization', authHeader(hostId, steamName))
		.send({ modId })
	return res.body.lobby.code as string
}

describe('GET /api/webadmin/lobbies', () => {
	it('returns 403 for a non-admin/moderator', async () => {
		const token = authHeader('plain-1', 'Plain')
		vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
			privileges: [],
		} as any)

		const res = await request(app)
			.get('/api/webadmin/lobbies')
			.set('Authorization', token)
		expect(res.status).toBe(403)
	})

	it('finds a lobby by code', async () => {
		const code = await createRealLobby('host-search-1', 'HostSearch1')
		const token = authAsAdmin('admin-search-1', 'AdminSearch1')

		const res = await request(app)
			.get(`/api/webadmin/lobbies?search=${code}`)
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(
			res.body.lobbies.some((l: { code: string }) => l.code === code),
		).toBe(true)
	})

	it('finds a lobby by a member username, case-insensitively', async () => {
		const code = await createRealLobby('host-search-2', 'FindMeByName')
		const token = authAsAdmin('admin-search-2', 'AdminSearch2')

		const res = await request(app)
			.get('/api/webadmin/lobbies?search=findmeby')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(
			res.body.lobbies.some((l: { code: string }) => l.code === code),
		).toBe(true)
	})

	it('a moderator (not just an admin) can search', async () => {
		const code = await createRealLobby('host-search-3', 'HostSearch3')
		const token = authAsModerator('mod-search-1', 'ModSearch1')

		const res = await request(app)
			.get(`/api/webadmin/lobbies?search=${code}`)
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(
			res.body.lobbies.some((l: { code: string }) => l.code === code),
		).toBe(true)
	})
})

describe('GET /api/webadmin/lobbies/:code', () => {
	it('returns lobby detail including players', async () => {
		const code = await createRealLobby('host-detail-1', 'HostDetail1')
		const token = authAsAdmin('admin-detail-1', 'AdminDetail1')

		const res = await request(app)
			.get(`/api/webadmin/lobbies/${code}`)
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.lobby.code).toBe(code)
		expect(res.body.lobby.hostId).toBe('host-detail-1')
		expect(res.body.players).toEqual([
			expect.objectContaining({
				id: 'host-detail-1',
				displayName: 'HostDetail1',
			}),
		])
	})

	it('returns 404 for a lobby that does not exist', async () => {
		const token = authAsAdmin('admin-detail-2', 'AdminDetail2')
		const res = await request(app)
			.get('/api/webadmin/lobbies/ZZZZZZ')
			.set('Authorization', token)
		expect(res.status).toBe(404)
	})
})

describe('POST /api/webadmin/lobbies/:code/kick/:playerId', () => {
	it('removes the target player and returns ok', async () => {
		const code = await createRealLobby('host-kick-1', 'HostKick1')
		await request(app)
			.post(`/api/lobbies/${code}/join`)
			.set('Authorization', authHeader('guest-kick-1', 'GuestKick1'))
		const token = authAsAdmin('admin-kick-1', 'AdminKick1')

		const res = await request(app)
			.post(`/api/webadmin/lobbies/${code}/kick/guest-kick-1`)
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.ok).toBe(true)

		const detail = await request(app)
			.get(`/api/webadmin/lobbies/${code}`)
			.set('Authorization', token)
		expect(
			detail.body.players.some((p: { id: string }) => p.id === 'guest-kick-1'),
		).toBe(false)
	})

	it('a moderator (not just an admin) can kick', async () => {
		const code = await createRealLobby('host-kick-2', 'HostKick2')
		await request(app)
			.post(`/api/lobbies/${code}/join`)
			.set('Authorization', authHeader('guest-kick-2', 'GuestKick2'))
		const token = authAsModerator('mod-kick-1', 'ModKick1')

		const res = await request(app)
			.post(`/api/webadmin/lobbies/${code}/kick/guest-kick-2`)
			.set('Authorization', token)

		expect(res.status).toBe(200)
	})

	it('can kick the host, who is not the acting admin', async () => {
		const code = await createRealLobby('host-kick-3', 'HostKick3')
		const token = authAsAdmin('admin-kick-2', 'AdminKick2')

		const res = await request(app)
			.post(`/api/webadmin/lobbies/${code}/kick/host-kick-3`)
			.set('Authorization', token)

		expect(res.status).toBe(200)
		// The lobby had one member (the host) -- kicking them closes it.
		const detail = await request(app)
			.get(`/api/webadmin/lobbies/${code}`)
			.set('Authorization', token)
		expect(detail.status).toBe(404)
	})

	it('returns 400 for a player not in the lobby', async () => {
		const code = await createRealLobby('host-kick-4', 'HostKick4')
		const token = authAsAdmin('admin-kick-3', 'AdminKick3')

		const res = await request(app)
			.post(`/api/webadmin/lobbies/${code}/kick/nobody`)
			.set('Authorization', token)

		expect(res.status).toBe(400)
	})
})

describe('POST /api/webadmin/lobbies/:code/close', () => {
	it('removes every member and the lobby subsequently 404s', async () => {
		const code = await createRealLobby('host-close-1', 'HostClose1')
		await request(app)
			.post(`/api/lobbies/${code}/join`)
			.set('Authorization', authHeader('guest-close-1', 'GuestClose1'))
		const token = authAsAdmin('admin-close-1', 'AdminClose1')

		const res = await request(app)
			.post(`/api/webadmin/lobbies/${code}/close`)
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.ok).toBe(true)

		const detail = await request(app)
			.get(`/api/webadmin/lobbies/${code}`)
			.set('Authorization', token)
		expect(detail.status).toBe(404)
	})

	it('returns 404 for a lobby that does not exist', async () => {
		const token = authAsAdmin('admin-close-2', 'AdminClose2')
		const res = await request(app)
			.post('/api/webadmin/lobbies/ZZZZZZ/close')
			.set('Authorization', token)
		expect(res.status).toBe(404)
	})
})
