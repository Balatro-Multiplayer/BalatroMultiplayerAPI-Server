import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Tournaments live in Nakama; the route only relays to these admin RPC wrappers.
vi.mock(
	'../../infrastructure/nakama/tournament-sync.js',
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		listNakamaTournaments: vi.fn(),
		getNakamaTournament: vi.fn(),
		closeNakamaTournament: vi.fn(),
	}),
)

import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import {
	type NakamaTournamentDetail,
	type NakamaTournamentSummary,
	closeNakamaTournament,
	getNakamaTournament,
	listNakamaTournaments,
} from '../../infrastructure/nakama/tournament-sync.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()
const ID = 'cccccccc-0000-4000-8000-000000000001'

function authWith(privileges: string[], playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges,
	} as Awaited<ReturnType<typeof playerGateway.findPlayerById>>)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

function summary(n: number): NakamaTournamentSummary {
	return {
		id: `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`,
		name: `Cup ${n}`,
		format: 'single_elim',
		status: 'registration',
		visibility: 'public',
		organiserId: 'org-1',
		organiserName: 'Organiser',
		players: 3,
		maxPlayers: 8,
		waitlist: 0,
		startsAt: Date.UTC(2026, 0, 1),
		official: false,
		requireRanked: false,
		finishedAt: null,
	}
}

const DETAIL: NakamaTournamentDetail = {
	...summary(1),
	description: 'Bring snacks',
	notice: '',
	inviteCode: 'ABC123',
	gameMode: 'pvp_nemesis',
	ruleset: 'ruleset_mp_balanced',
	organiser: { id: 'org-1', name: 'Organiser' },
	coOrganisers: [],
	entrants: [],
	waitlist: [],
	createdAt: Date.UTC(2025, 11, 1),
	startedAt: null,
	closed: null,
}

beforeEach(() => {
	vi.mocked(listNakamaTournaments).mockResolvedValue({ ok: true, value: [] })
	vi.mocked(getNakamaTournament).mockResolvedValue({
		ok: false,
		error: 'not_found',
	})
	vi.mocked(closeNakamaTournament).mockResolvedValue({
		ok: false,
		error: 'not_found',
	})
	vi.mocked(recordStaffAction).mockClear()
})

describe('GET /api/webadmin/tournaments', () => {
	it('returns 403 for a non-admin/moderator', async () => {
		const res = await request(app)
			.get('/api/webadmin/tournaments')
			.set('Authorization', authWith([], 'p1', 'Player'))
		expect(res.status).toBe(403)
	})

	it("pages Nakama's list, passing the filter and search on", async () => {
		vi.mocked(listNakamaTournaments).mockResolvedValue({
			ok: true,
			value: [1, 2, 3].map(summary),
		})
		const res = await request(app)
			.get('/api/webadmin/tournaments?status=all&search=cup&limit=2&page=2')
			.set('Authorization', authWith(['moderator'], 'mod-1', 'Mod'))
		expect(res.status).toBe(200)
		expect(listNakamaTournaments).toHaveBeenCalledWith('all', 'cup')
		expect(res.body.total).toBe(3)
		expect(res.body.tournaments.map((t: { name: string }) => t.name)).toEqual([
			'Cup 3',
		])
	})

	it('says when the game server is unreachable', async () => {
		vi.mocked(listNakamaTournaments).mockResolvedValue({
			ok: false,
			error: 'unavailable',
		})
		const res = await request(app)
			.get('/api/webadmin/tournaments')
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))
		expect(res.status).toBe(503)
	})
})

describe('GET /api/webadmin/tournaments/:id', () => {
	it('returns the details', async () => {
		vi.mocked(getNakamaTournament).mockResolvedValue({
			ok: true,
			value: DETAIL,
		})
		const res = await request(app)
			.get(`/api/webadmin/tournaments/${ID}`)
			.set('Authorization', authWith(['moderator'], 'mod-1', 'Mod'))
		expect(res.status).toBe(200)
		expect(res.body.tournament.description).toBe('Bring snacks')
	})

	it('returns 404 for an unknown or malformed id', async () => {
		const auth = authWith(['moderator'], 'mod-1', 'Mod')
		expect(
			(
				await request(app)
					.get(`/api/webadmin/tournaments/${ID}`)
					.set('Authorization', auth)
			).status,
		).toBe(404)
		expect(
			(
				await request(app)
					.get('/api/webadmin/tournaments/nope')
					.set('Authorization', auth)
			).status,
		).toBe(404)
	})
})

describe('POST /api/webadmin/tournaments/:id/close', () => {
	it('closes through Nakama and writes the staff log', async () => {
		vi.mocked(getNakamaTournament).mockResolvedValue({
			ok: true,
			value: DETAIL,
		})
		vi.mocked(closeNakamaTournament).mockResolvedValue({
			ok: true,
			value: null,
		})
		const res = await request(app)
			.post(`/api/webadmin/tournaments/${ID}/close`)
			.set('Authorization', authWith(['moderator'], 'mod-1', 'Mod'))
			.send({ reason: '  Abusive name ' })
		expect(res.status).toBe(200)
		expect(closeNakamaTournament).toHaveBeenCalledWith(ID, 'Abusive name')
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				action: 'tournament_close',
				reason: 'Abusive name',
				detail: {
					tournamentId: ID,
					name: 'Cup 1',
					organiser: { id: 'org-1', name: 'Organiser' },
				},
			}),
		)
	})

	it('needs a reason players can read', async () => {
		const auth = authWith(['admin'], 'admin-1', 'Admin')
		expect(
			(
				await request(app)
					.post(`/api/webadmin/tournaments/${ID}/close`)
					.set('Authorization', auth)
					.send({})
			).status,
		).toBe(400)
		expect(
			(
				await request(app)
					.post(`/api/webadmin/tournaments/${ID}/close`)
					.set('Authorization', auth)
					.send({ reason: 'x'.repeat(201) })
			).status,
		).toBe(400)
		expect(closeNakamaTournament).not.toHaveBeenCalled()
	})

	it('refuses one that has already ended, and logs nothing', async () => {
		vi.mocked(closeNakamaTournament).mockResolvedValue({
			ok: false,
			error: 'refused',
		})
		const res = await request(app)
			.post(`/api/webadmin/tournaments/${ID}/close`)
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))
			.send({ reason: 'test' })
		expect(res.status).toBe(409)
		expect(recordStaffAction).not.toHaveBeenCalled()
	})

	it('returns 404 for a tournament that does not exist', async () => {
		const res = await request(app)
			.post(`/api/webadmin/tournaments/${ID}/close`)
			.set('Authorization', authWith(['admin'], 'admin-1', 'Admin'))
			.send({ reason: 'test' })
		expect(res.status).toBe(404)
	})
})
