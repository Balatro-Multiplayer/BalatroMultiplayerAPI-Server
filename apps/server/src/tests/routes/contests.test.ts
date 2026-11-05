import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { WITHDRAWN_ACTION, createContestPageService } from '../../features/contests/contest-page.service.js'
import type { ContestPageRow } from '../../features/contests/contest-page.service.js'
import { createWebsiteContestService } from '../../features/contests/website-contest.service.js'
import { createContestsRouter } from '../../features/contests/contests.route.js'
import { errorHandler } from '../../middleware/errorHandler.js'
import { createSession } from '../../state/index.js'

const RUN = '11111111-1111-4111-8111-111111111111'

// The page service over an in-memory Contest, queue item and match; a
// transaction is a snapshot that a throw restores.
interface World {
	contest: ContestPageRow & { pageOpenedAt: Date | null }
	// Null: the run is not stored yet.
	item: { id: number; status: string; resolutionAction: string | null; claimedBy: string | null } | null
	players: string[]
	original: { playerId: string; place: number }[]
	ranked: boolean
	forfeits: { playerId: string; place: number; rated?: boolean }[][]
	forfeitFails: boolean
	events: { itemId: number; kind: string; actor: string }[]
	told: string[]
}

let world: World

// These tests do not make website Contests.
const noWebsiteDeps = {
	matchFacts: async () => null,
	hasContested: async () => false,
	queueItemState: async () => 'none' as const,
	addContest: async () => false,
	joinQueueItem: async () => {},
	now: () => new Date('2026-11-05T12:00:00Z'),
}

function appOver(w: World) {
	const service = createContestPageService<World>({
		getContest: async (runId, contesterId) =>
			runId === w.contest.runId && contesterId === w.contest.contesterId ? { ...w.contest } : null,
		markPageOpened: async () => {
			if (w.contest.pageOpenedAt) return false
			w.contest.pageOpenedAt = new Date()
			return true
		},
		setDetail: async (_id, reason, detail) => {
			w.contest.reason = reason
			w.contest.detail = detail
		},
		findQueueItem: async () => (w.item ? { id: w.item.id, status: w.item.status } : null),
		gameOf: async (runId) => ({ runId, matchmade: true, ranked: w.ranked }),
		participantsOf: async () => w.players,
		originalResultOf: async () => w.original,
		flaggedPlayersOf: async () => new Set<string>(),
		forfeitGame: async (_game, placements) => {
			if (w.forfeitFails) return { ok: false, reason: 'nakama down' }
			w.forfeits.push(placements)
			return { ok: true }
		},
		transaction: async (fn) => {
			const before = structuredClone(w)
			try {
				return await fn(w)
			} catch (err) {
				Object.assign(w, before)
				throw err
			}
		},
		closeItem: async (tx) => {
			if (!tx.item || tx.item.status !== 'open') return false
			// A staff claim does not stop it.
			tx.item = { ...tx.item, status: 'resolved', resolutionAction: WITHDRAWN_ACTION, claimedBy: null }
			return true
		},
		markWithdrawn: async (tx, _id, now) => {
			if (tx.contest.withdrawnAt) return false
			tx.contest.withdrawnAt = now
			return true
		},
		liveContests: async (tx) =>
			tx.contest.withdrawnAt ? [] : [{ contesterId: tx.contest.contesterId, againstId: tx.contest.againstId }],
		repointItem: async () => {},
		recordWithdrawn: async (tx, itemId, actor) => {
			tx.events.push({ itemId, kind: 'withdrawn', actor })
		},
		notifyWithdrawn: async (_runId, contesterId) => {
			w.told.push(contesterId)
		},
		now: () => new Date('2026-11-05T12:00:00Z'),
	})
	const app = express()
	app.use(express.json())
	app.use('/api/contests', createContestsRouter(service, createWebsiteContestService(noWebsiteDeps)))
	app.use(errorHandler)
	return app
}

function auth(playerId: string) {
	createSession(playerId, { id: playerId })
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const placed = (list: { playerId: string; place: number }[], id: string) => list.find((p) => p.playerId === id)?.place

beforeEach(() => {
	world = {
		contest: {
			id: 3,
			runId: RUN,
			kind: 'in_game',
			contesterId: 'contester-1',
			againstId: 'opponent-1',
			reason: null,
			detail: null,
			withdrawnAt: null,
			createdAt: new Date('2026-11-05T11:00:00Z'),
			pageOpenedAt: null,
		},
		item: { id: 7, status: 'open', resolutionAction: null, claimedBy: 'moderator:m1' },
		players: ['contester-1', 'opponent-1'],
		original: [],
		ranked: true,
		forfeits: [],
		forfeitFails: false,
		events: [],
		told: [],
	}
})

describe('POST /api/contests/:runId/open', () => {
	it('returns 401 without a token and 400 for a bad match id', async () => {
		const app = appOver(world)
		expect((await request(app).post(`/api/contests/${RUN}/open`)).status).toBe(401)
		expect((await request(app).post('/api/contests/nope/open').set('Authorization', auth('contester-1'))).status).toBe(400)
	})

	it('answers pending, and uses nothing up, for a Contest that is not stored yet or is not theirs', async () => {
		const app = appOver(world)
		const other = await request(app).post(`/api/contests/${RUN}/open`).set('Authorization', auth('eve'))
		expect(other.body.page).toEqual({ pending: true })
		expect(world.contest.pageOpenedAt).toBeNull()
	})

	it('gives the page once, then only "Submitted"', async () => {
		const app = appOver(world)
		const first = await request(app).post(`/api/contests/${RUN}/open`).set('Authorization', auth('contester-1'))
		expect(first.body.page.submitted).toBe(false)
		expect(first.body.page.contest.state).toBe('open')
		const later = await request(app).post(`/api/contests/${RUN}/open`).set('Authorization', auth('contester-1'))
		expect(later.body.page).toEqual({ submitted: true })
	})
})

describe('PATCH /api/contests/:runId', () => {
	it('saves the reason and text while staff have not decided', async () => {
		const res = await request(appOver(world))
			.patch(`/api/contests/${RUN}`)
			.set('Authorization', auth('contester-1'))
			.send({ reason: 'stalling', detail: 'They waited out the clock.' })
		expect(res.status).toBe(200)
		expect(world.contest).toMatchObject({ reason: 'stalling', detail: 'They waited out the clock.' })
	})

	it('refuses an unknown reason or a text that is too long', async () => {
		const app = appOver(world)
		const bad = await request(app).patch(`/api/contests/${RUN}`).set('Authorization', auth('contester-1')).send({ reason: 'rude' })
		const long = await request(app).patch(`/api/contests/${RUN}`).set('Authorization', auth('contester-1')).send({ detail: 'x'.repeat(2001) })
		expect([bad.status, long.status]).toEqual([400, 400])
	})

	it('refuses after staff decided, and for a Contest that is not theirs', async () => {
		const app = appOver(world)
		const other = await request(app).patch(`/api/contests/${RUN}`).set('Authorization', auth('eve')).send({ reason: 'other' })
		expect(other.status).toBe(404)
		world.item = { ...(world.item as NonNullable<World['item']>), status: 'resolved' }
		const late = await request(app).patch(`/api/contests/${RUN}`).set('Authorization', auth('contester-1')).send({ reason: 'other' })
		expect(late.status).toBe(409)
	})
})

describe('POST /api/contests/:runId/withdraw', () => {
	it('in a match of 2 gives the opponent the win, closes the item over a claim and tells the opponent', async () => {
		world.original = [
			{ playerId: 'contester-1', place: 1 },
			{ playerId: 'opponent-1', place: 2 },
		]
		const res = await request(appOver(world)).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth('contester-1'))
		expect(res.status).toBe(200)
		expect(world.forfeits).toHaveLength(1)
		expect(placed(world.forfeits[0], 'opponent-1')).toBe(1)
		expect(placed(world.forfeits[0], 'contester-1')).toBe(2)
		expect(world.forfeits[0].every((p) => p.rated === true)).toBe(true)
		expect(world.item).toMatchObject({ status: 'resolved', resolutionAction: WITHDRAWN_ACTION, claimedBy: null })
		expect(world.contest.withdrawnAt).not.toBeNull()
		expect(world.events).toEqual([{ itemId: 7, kind: 'withdrawn', actor: 'player:contester-1' }])
		expect(world.told).toEqual(['contester-1'])
	})

	it('in a match of 3 puts the contester last and keeps the others as they were', async () => {
		world.players = ['contester-1', 'a', 'b']
		world.original = [
			{ playerId: 'contester-1', place: 1 },
			{ playerId: 'a', place: 2 },
			{ playerId: 'b', place: 3 },
		]
		const res = await request(appOver(world)).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth('contester-1'))
		expect(res.status).toBe(200)
		const [result] = world.forfeits
		expect([placed(result, 'a'), placed(result, 'b'), placed(result, 'contester-1')]).toEqual([1, 2, 3])
	})

	it('does not rate a casual match', async () => {
		world.ranked = false
		await request(appOver(world)).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth('contester-1'))
		expect(world.forfeits[0].every((p) => p.rated === undefined)).toBe(true)
	})

	it('refuses after a staff decision and changes nothing', async () => {
		world.item = { id: 7, status: 'resolved', resolutionAction: 'dismiss', claimedBy: null }
		const res = await request(appOver(world)).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth('contester-1'))
		expect(res.status).toBe(409)
		expect(world.forfeits).toEqual([])
		expect(world.contest.withdrawnAt).toBeNull()
		expect(world.told).toEqual([])
	})

	it('refuses while the run is not stored yet', async () => {
		world.item = null
		const res = await request(appOver(world)).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth('contester-1'))
		expect(res.status).toBe(409)
		expect(world.forfeits).toEqual([])
	})

	it('refuses a second withdraw and another player', async () => {
		const app = appOver(world)
		expect((await request(app).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth('eve'))).status).toBe(404)
		expect((await request(app).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth('contester-1'))).status).toBe(200)
		expect((await request(app).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth('contester-1'))).status).toBe(409)
		expect(world.forfeits).toHaveLength(1)
	})

	it('leaves the item open when the forfeit cannot be recorded', async () => {
		world.forfeitFails = true
		const res = await request(appOver(world)).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth('contester-1'))
		expect(res.status).toBe(502)
		expect(world.item?.status).toBe('open')
		expect(world.contest.withdrawnAt).toBeNull()
	})
})
