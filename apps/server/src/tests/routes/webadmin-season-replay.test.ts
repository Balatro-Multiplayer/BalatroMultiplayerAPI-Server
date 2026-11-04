import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../env.js'
import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as ratingGateway from '../../infrastructure/gateways/rating.gateway.js'
import { err, ok } from '../../shared/utils/result.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../features/ratings/season-replay.service.js', async (original) => ({
	...(await original<object>()),
	replaySeason: vi.fn(),
}))
vi.mock('../../infrastructure/gateways/rating.gateway.js', () => ({
	getSeasonForReplay: vi.fn(),
}))

vi.mock('../../features/ratings/active-ranked-games.js', () => ({
	activeRankedGames: vi.fn(),
}))

import { activeRankedGames } from '../../features/ratings/active-ranked-games.js'
import { replaySeason } from '../../features/ratings/season-replay.service.js'

const app = createTestApp()
const startedAt = new Date('2026-06-01T00:00:00Z')
const report = { games: 3, changedPlayers: 2, players: [] }

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges,
	} as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const post = (auth: string) =>
	request(app).post('/api/webadmin/ratings/season-replay').set('Authorization', auth)

beforeEach(() => {
	env.OWNER_PLAYER_ID = 'owner-1'
	vi.mocked(replaySeason).mockReset()
	vi.mocked(activeRankedGames).mockReset()
	vi.mocked(activeRankedGames).mockResolvedValue(ok(0))
	vi.mocked(ratingGateway.getSeasonForReplay).mockResolvedValue({
		id: 1,
		name: 'Season 1',
		startedAt,
	})
})

describe('POST /api/webadmin/ratings/season-replay', () => {
	it('replays the current season for the owner', async () => {
		vi.mocked(replaySeason).mockResolvedValue(ok(report))
		const res = await post(authAs('owner-1', ['admin']))
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ ...report, season: { id: 1, name: 'Season 1' } })
		expect(replaySeason).toHaveBeenCalledWith(startedAt)
	})

	it('shows the running ranked game count and warns about purged runs', async () => {
		vi.mocked(replaySeason).mockResolvedValue(ok(report))
		vi.mocked(activeRankedGames).mockResolvedValue(ok(2))
		vi.mocked(ratingGateway.getSeasonForReplay).mockResolvedValue({
			id: 1,
			name: 'Season 1',
			startedAt: new Date('2020-01-01T00:00:00Z'),
		})
		const res = await post(authAs('owner-1', ['admin']))
		expect(res.body).toMatchObject({ activeRankedGames: 2, retentionRisk: true })
		vi.mocked(ratingGateway.getSeasonForReplay).mockResolvedValue({
			id: 2,
			name: 'Season 2',
			startedAt: new Date(),
		})
		const fresh = await post(authAs('owner-1', ['admin']))
		expect(fresh.body.retentionRisk).toBe(false)
	})

	it('says when Nakama could not count the running games', async () => {
		vi.mocked(replaySeason).mockResolvedValue(ok(report))
		vi.mocked(activeRankedGames).mockResolvedValue(err('unreachable'))
		expect((await post(authAs('owner-1', ['admin']))).status).toBe(503)
	})

	it('refuses another admin', async () => {
		expect((await post(authAs('admin-2', ['admin']))).status).toBe(403)
		expect(replaySeason).not.toHaveBeenCalled()
	})

	it('counts the owner as an admin without the privilege', async () => {
		vi.mocked(replaySeason).mockResolvedValue(ok(report))
		expect((await post(authAs('owner-1', ['moderator']))).status).toBe(200)
	})

	it('refuses everyone while no owner is set', async () => {
		env.OWNER_PLAYER_ID = ''
		expect((await post(authAs('', ['admin']))).status).toBe(403)
		expect(replaySeason).not.toHaveBeenCalled()
	})

	it('says when Nakama could not run it', async () => {
		vi.mocked(replaySeason).mockResolvedValue(err('unreachable'))
		expect((await post(authAs('owner-1', ['admin']))).status).toBe(503)
	})
})
