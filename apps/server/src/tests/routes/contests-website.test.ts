import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { WITHDRAWN_ACTION, createContestPageService } from '../../features/contests/contest-page.service.js'
import type { ContestPageRow } from '../../features/contests/contest-page.service.js'
import { createContestsRouter } from '../../features/contests/contests.route.js'
import { type MatchFacts, createWebsiteContestService } from '../../features/contests/website-contest.service.js'
import { errorHandler } from '../../middleware/errorHandler.js'
import { createSession } from '../../state/index.js'

const RUN = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-11-05T12:00:00Z')
const HOUR = 60 * 60 * 1000

type Row = ContestPageRow & { pageOpenedAt: Date | null }
interface Item {
	id: number
	status: 'open' | 'resolved'
	resolutionAction: string | null
	contesterId: string | null
}

// An in-memory match, its Contests and its one queue item.
interface World {
	match: MatchFacts | null
	contests: Row[]
	item: Item | null
	events: { kind: string; actor: string }[]
	forfeits: unknown[]
	told: string[]
	joins: { contesterId: string; lobbyKind: string }[]
}

let world: World

const row = (id: number, contesterId: string, kind: 'in_game' | 'website'): Row => ({
	id,
	runId: RUN,
	kind,
	contesterId,
	againstId: kind === 'in_game' ? 'p2' : null,
	reason: null,
	detail: null,
	withdrawnAt: null,
	createdAt: NOW,
	pageOpenedAt: null,
})

function appOver(w: World) {
	let nextId = 100
	const page = createContestPageService<World>({
		getContest: async (_runId, contesterId) => w.contests.find((c) => c.contesterId === contesterId) ?? null,
		markPageOpened: async (id) => {
			const c = w.contests.find((x) => x.id === id) as Row
			if (c.pageOpenedAt) return false
			c.pageOpenedAt = NOW
			return true
		},
		setDetail: async (id, reason, detail) => {
			Object.assign(w.contests.find((x) => x.id === id) as Row, { reason, detail })
		},
		findQueueItem: async () => w.item && { id: w.item.id, status: w.item.status, contesterId: w.item.contesterId },
		gameOf: async (runId) => ({ runId, matchmade: true, ranked: true }),
		participantsOf: async () => w.match?.players ?? [],
		originalResultOf: async () => [],
		flaggedPlayersOf: async () => new Set<string>(),
		forfeitGame: async (_game, placements) => {
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
			tx.item = { ...tx.item, status: 'resolved', resolutionAction: WITHDRAWN_ACTION }
			return true
		},
		markWithdrawn: async (tx, id, now) => {
			const c = tx.contests.find((x) => x.id === id) as Row
			if (c.withdrawnAt) return false
			c.withdrawnAt = now
			return true
		},
		liveContests: async (tx) => tx.contests.filter((c) => !c.withdrawnAt).map((c) => ({ contesterId: c.contesterId, againstId: c.againstId })),
		repointItem: async (tx, _itemId, contest) => {
			if (tx.item) tx.item.contesterId = contest.contesterId
		},
		recordWithdrawn: async (tx, _itemId, actor) => {
			tx.events.push({ kind: 'withdrawn', actor })
		},
		notifyWithdrawn: async (_runId, contesterId) => {
			w.told.push(contesterId)
		},
		now: () => NOW,
	})
	const website = createWebsiteContestService({
		matchFacts: async () => w.match,
		hasContested: async (_runId, playerId) => w.contests.some((c) => c.contesterId === playerId),
		queueItemState: async () => {
			if (!w.item) return 'none'
			if (w.item.status === 'open') return 'open'
			return w.item.resolutionAction === WITHDRAWN_ACTION ? 'withdrawn' : 'decided'
		},
		addContest: async (_runId, playerId) => {
			if (w.contests.some((c) => c.contesterId === playerId)) return false
			w.contests.push(row(nextId++, playerId, 'website'))
			return true
		},
		joinQueueItem: async ({ contesterId, lobbyKind }) => {
			w.joins.push({ contesterId, lobbyKind })
			if (!w.item) w.item = { id: 9, status: 'open', resolutionAction: null, contesterId }
			else if (w.item.status === 'resolved') w.item = { ...w.item, status: 'open', resolutionAction: null, contesterId }
		},
		now: () => NOW,
	})
	const app = express()
	app.use(express.json())
	app.use('/api/contests', createContestsRouter(page, website))
	app.use(errorHandler)
	return app
}

function auth(playerId: string) {
	createSession(playerId, { id: playerId })
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const contest = (app: express.Express, who: string) => request(app).post(`/api/contests/${RUN}`).set('Authorization', auth(who))
const eligibility = (app: express.Express, who: string) =>
	request(app).get(`/api/contests/${RUN}/eligibility`).set('Authorization', auth(who))

beforeEach(() => {
	world = {
		match: {
			lobbyCode: 'ABCDEF',
			endedAt: new Date(NOW.getTime() - HOUR),
			matchmade: true,
			ranked: true,
			players: ['p1', 'p2'],
			voided: false,
		},
		contests: [],
		item: null,
		events: [],
		forfeits: [],
		told: [],
		joins: [],
	}
})

describe('POST /api/contests/:runId (website Contest)', () => {
	it('opens the queue item and stores a website Contest', async () => {
		const res = await contest(appOver(world), 'p1')
		expect(res.status).toBe(201)
		expect(world.contests).toHaveLength(1)
		expect(world.contests[0]).toMatchObject({ kind: 'website', contesterId: 'p1', againstId: null })
		expect(world.joins).toEqual([{ contesterId: 'p1', lobbyKind: 'ranked' }])
		expect(world.item).toMatchObject({ status: 'open' })
	})

	it('leaves the result alone: no forfeit, no Notification', async () => {
		await contest(appOver(world), 'p1')
		expect(world.forfeits).toEqual([])
		expect(world.told).toEqual([])
	})

	it('joins a casual match as casual', async () => {
		world.match = { ...(world.match as MatchFacts), ranked: false }
		await contest(appOver(world), 'p1')
		expect(world.joins[0].lobbyKind).toBe('casual')
	})

	it('needs a login', async () => {
		expect((await request(appOver(world)).post(`/api/contests/${RUN}`)).status).toBe(401)
	})

	it('accepts a Contest 24 hours after the match ended, and refuses one later', async () => {
		const app = appOver(world)
		world.match = { ...(world.match as MatchFacts), endedAt: new Date(NOW.getTime() - 24 * HOUR) }
		expect((await contest(app, 'p1')).status).toBe(201)
		world.match = { ...(world.match as MatchFacts), endedAt: new Date(NOW.getTime() - 24 * HOUR - 1) }
		const late = await contest(app, 'p2')
		expect(late.status).toBe(409)
		expect(world.contests).toHaveLength(1)
	})

	it('refuses a match that is not over, voided, private or of one player', async () => {
		const app = appOver(world)
		const base = world.match as MatchFacts
		for (const change of [{ endedAt: null }, { voided: true }, { matchmade: false }, { players: ['p1'] }]) {
			world.match = { ...base, ...change }
			expect((await contest(app, 'p1')).status).toBe(409)
		}
		expect(world.contests).toEqual([])
		expect(world.item).toBeNull()
	})

	it('refuses a player who was not in the match, and an unknown match', async () => {
		const app = appOver(world)
		expect((await contest(app, 'eve')).status).toBe(404)
		world.match = null
		expect((await contest(app, 'p1')).status).toBe(404)
	})

	it('refuses a second Contest by the same player', async () => {
		const app = appOver(world)
		expect((await contest(app, 'p1')).status).toBe(201)
		expect((await contest(app, 'p1')).status).toBe(409)
		expect(world.contests).toHaveLength(1)
	})

	it('refuses after staff decided the match', async () => {
		world.item = { id: 9, status: 'resolved', resolutionAction: 'dismiss', contesterId: 'p2' }
		expect((await contest(appOver(world), 'p1')).status).toBe(409)
		expect(world.contests).toEqual([])
	})

	it('joins the item an in-game Contest opened', async () => {
		world.contests = [row(1, 'p2', 'in_game')]
		world.item = { id: 9, status: 'open', resolutionAction: null, contesterId: 'p2' }
		expect((await contest(appOver(world), 'p1')).status).toBe(201)
		expect(world.contests.map((c) => c.kind)).toEqual(['in_game', 'website'])
		expect(world.item?.id).toBe(9)
	})

	it('joins the item a website Contest opened', async () => {
		const app = appOver(world)
		await contest(app, 'p1')
		await contest(app, 'p2')
		expect(world.contests).toHaveLength(2)
		expect(world.item).toMatchObject({ id: 9, status: 'open' })
	})
})

describe('GET /api/contests/:runId/eligibility', () => {
	it('tells a player of an eligible match yes', async () => {
		const res = await eligibility(appOver(world), 'p1')
		expect(res.body).toEqual({ eligible: true })
	})

	it('tells everyone else no, with the reason', async () => {
		const app = appOver(world)
		expect((await eligibility(app, 'eve')).body).toEqual({ eligible: false, reason: 'not_found' })
		world.match = { ...(world.match as MatchFacts), endedAt: new Date(NOW.getTime() - 25 * HOUR) }
		expect((await eligibility(app, 'p1')).body).toEqual({ eligible: false, reason: 'window_closed' })
		world.match = { ...(world.match as MatchFacts), endedAt: NOW, voided: true }
		expect((await eligibility(app, 'p1')).body).toEqual({ eligible: false, reason: 'voided' })
	})

	it('says no once the player contested', async () => {
		const app = appOver(world)
		await contest(app, 'p1')
		expect((await eligibility(app, 'p1')).body).toEqual({ eligible: false, reason: 'already_contested' })
	})
})

describe('opening and withdrawing a website Contest', () => {
	const withdraw = (app: express.Express, who: string) => request(app).post(`/api/contests/${RUN}/withdraw`).set('Authorization', auth(who))

	it('shows the page once with the Contest kind', async () => {
		const app = appOver(world)
		await contest(app, 'p1')
		const first = await request(app).post(`/api/contests/${RUN}/open`).set('Authorization', auth('p1'))
		expect(first.body.page.contest).toMatchObject({ kind: 'website', state: 'open' })
		const later = await request(app).post(`/api/contests/${RUN}/open`).set('Authorization', auth('p1'))
		expect(later.body.page).toEqual({ submitted: true })
	})

	it('closes the item when the only Contest goes, with no forfeit and no Notification', async () => {
		const app = appOver(world)
		await contest(app, 'p1')
		const res = await withdraw(app, 'p1')
		expect(res.status).toBe(200)
		expect(world.item).toMatchObject({ status: 'resolved', resolutionAction: WITHDRAWN_ACTION })
		expect(world.contests[0].withdrawnAt).not.toBeNull()
		expect(world.forfeits).toEqual([])
		expect(world.told).toEqual([])
	})

	it('only removes that Contest while another one stands', async () => {
		const app = appOver(world)
		await contest(app, 'p1')
		await contest(app, 'p2')
		expect((await withdraw(app, 'p1')).status).toBe(200)
		expect(world.item).toMatchObject({ status: 'open', contesterId: 'p2' })
		expect(world.contests.map((c) => c.withdrawnAt !== null)).toEqual([true, false])
		expect(world.forfeits).toEqual([])
		expect(world.told).toEqual([])
		// The last one takes the item with it.
		expect((await withdraw(app, 'p2')).status).toBe(200)
		expect(world.item?.status).toBe('resolved')
	})

	it('leaves an in-game Contest standing and the item open', async () => {
		world.contests = [row(1, 'p2', 'in_game')]
		world.item = { id: 9, status: 'open', resolutionAction: null, contesterId: 'p2' }
		const app = appOver(world)
		await contest(app, 'p1')
		expect((await withdraw(app, 'p1')).status).toBe(200)
		expect(world.item).toMatchObject({ status: 'open', contesterId: 'p2' })
	})

	it('refuses after staff decided, and a second withdraw', async () => {
		const app = appOver(world)
		await contest(app, 'p1')
		await contest(app, 'p2')
		expect((await withdraw(app, 'p1')).status).toBe(200)
		expect((await withdraw(app, 'p1')).status).toBe(409)
		world.item = { ...(world.item as Item), status: 'resolved', resolutionAction: 'dismiss' }
		expect((await withdraw(app, 'p2')).status).toBe(409)
		expect(world.contests[1].withdrawnAt).toBeNull()
	})

	it('lets another player contest again after the item closed on a withdraw', async () => {
		const app = appOver(world)
		await contest(app, 'p1')
		await withdraw(app, 'p1')
		expect((await contest(app, 'p2')).status).toBe(201)
		expect(world.item).toMatchObject({ status: 'open', contesterId: 'p2' })
		// The player who withdrew cannot contest the same match again.
		expect((await contest(app, 'p1')).status).toBe(409)
	})
})
