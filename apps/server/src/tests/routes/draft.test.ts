// Draft route tests: route -> validation -> service -> response wiring for the
// server-generated draft pool, plus the weekly-cocktail admin endpoints. The
// pure cores (generate-draft-pool, draft.request parsers, weekly-cocktail's
// validateWeeklyCocktail) are already covered by
// src/tests/services/draft*.test.ts -- this file only exercises the wiring and
// a couple of representative validation cases per endpoint.
//
// No real test DB: setup.ts mocks `infrastructure/db/index.js` with a minimal
// `db.insert().values()` chain that does NOT support `.onConflictDoUpdate`, the
// call weekly-cocktail.gateway.ts's `saveWeeklyCocktailToDb` makes. So the PUT
// /admin/weekly-cocktail HAPPY PATH (valid rotation, which write-throughs to the
// DB via the real gateway -- the route never injects a fake) is intentionally
// OMITTED here to avoid depending on real DB behavior; it is covered by
// e2e/DB-integration tests instead. The INVALID-body PUT case is safe to test
// here because `validateWeeklyCocktail` throws before any DB call is made.

import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { signJwt } from '../../features/auth/jwt.js'
import { createSession } from '../../state/index.js'
import { matches } from '../../state/matchmaking.js'
import type { Match } from '../../shared/types/index.js'

const app = createTestApp()
const ADMIN_SECRET = 'test-admin-secret' // matches setup.ts's env.ADMIN_SECRET

function authHeader(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	const token = signJwt({ playerId, steamName })
	return `Bearer ${token}`
}

// MultiplayerPvP queues resolve a draft policy via the mod-wide default
// (see draft-policy.ts); any other modId has no policy registered at all.
function makePolicedMatch(matchId: string, playerIds: string[]): Match {
	const match: Match = {
		matchId,
		lobbyCode: `LOBBY-${matchId}`,
		modId: 'MultiplayerPvP',
		gameMode: 'pvp_standard',
		playerIds,
		createdAt: new Date(),
	}
	matches.set(matchId, match)
	return match
}

function makeUnpolicedMatch(matchId: string, playerIds: string[]): Match {
	const match: Match = {
		matchId,
		lobbyCode: `LOBBY-${matchId}`,
		modId: 'mod1',
		gameMode: 'mode1',
		playerIds,
		createdAt: new Date(),
	}
	matches.set(matchId, match)
	return match
}

describe('draft routes', () => {
	describe('POST /api/matches/:matchId/draft-pool', () => {
		it('returns 401 without auth', async () => {
			makePolicedMatch('dp-noauth', ['p1', 'p2'])
			const res = await request(app).post('/api/matches/dp-noauth/draft-pool')
			expect(res.status).toBe(401)
		})

		it('returns 401 with an invalid token', async () => {
			makePolicedMatch('dp-badauth', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matches/dp-badauth/draft-pool')
				.set('Authorization', 'Bearer not.a.valid.token')
			expect(res.status).toBe(401)
		})

		it('returns 200 with a full-size pool for a participant on a policied queue', async () => {
			makePolicedMatch('dp-1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matches/dp-1/draft-pool')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({})

			expect(res.status).toBe(200)
			expect(res.body.reused).toBe(false)
			expect(Array.isArray(res.body.pool)).toBe(true)
			expect(res.body.pool).toHaveLength(9)
		})

		it('returns the identical pool on a second call (idempotent)', async () => {
			makePolicedMatch('dp-2', ['p1', 'p2'])
			const auth = authHeader('p1', 'Alice')

			const first = await request(app)
				.post('/api/matches/dp-2/draft-pool')
				.set('Authorization', auth)
				.send({})
			const second = await request(app)
				.post('/api/matches/dp-2/draft-pool')
				.set('Authorization', auth)
				.send({})

			expect(first.status).toBe(200)
			expect(second.status).toBe(200)
			expect(second.body.reused).toBe(true)
			expect(second.body.pool).toEqual(first.body.pool)
		})

		it('returns 404 no_draft_policy when the match queue has no policy', async () => {
			makeUnpolicedMatch('dp-3', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matches/dp-3/draft-pool')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({})

			expect(res.status).toBe(404)
		})

		it('returns 403 not_a_participant for a non-participant player', async () => {
			makePolicedMatch('dp-4', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matches/dp-4/draft-pool')
				.set('Authorization', authHeader('outsider', 'Eve'))
				.send({})

			expect(res.status).toBe(403)
		})
	})

	describe('GET /admin/weekly-cocktail', () => {
		it('returns 401 when x-admin-secret is missing', async () => {
			const res = await request(app).get('/admin/weekly-cocktail')
			expect(res.status).toBe(401)
		})

		it('returns 401 when x-admin-secret is wrong', async () => {
			const res = await request(app)
				.get('/admin/weekly-cocktail')
				.set('x-admin-secret', 'wrong-secret')
			expect(res.status).toBe(401)
		})

		it('returns 200 with the current in-memory cocktail when the secret is correct', async () => {
			const res = await request(app)
				.get('/admin/weekly-cocktail')
				.set('x-admin-secret', ADMIN_SECRET)

			expect(res.status).toBe(200)
			expect(typeof res.body.name).toBe('string')
			expect(Array.isArray(res.body.decks)).toBe(true)
		})
	})

	describe('PUT /admin/weekly-cocktail', () => {
		it('returns 401 when x-admin-secret is wrong', async () => {
			const res = await request(app)
				.put('/admin/weekly-cocktail')
				.set('x-admin-secret', 'wrong-secret')
				.send({ name: 'Test', decks: ['b_green'] })
			expect(res.status).toBe(401)
		})

		it('returns 400 invalid_input for too many decks (4)', async () => {
			const res = await request(app)
				.put('/admin/weekly-cocktail')
				.set('x-admin-secret', ADMIN_SECRET)
				.send({
					name: 'Test',
					decks: ['b_green', 'b_black', 'b_mp_orange', 'b_red'],
				})

			expect(res.status).toBe(400)
		})

		it('returns 400 invalid_input for a non-eligible deck', async () => {
			const res = await request(app)
				.put('/admin/weekly-cocktail')
				.set('x-admin-secret', ADMIN_SECRET)
				.send({ name: 'Test', decks: ['b_mp_cocktail'] })

			expect(res.status).toBe(400)
		})
	})
})
