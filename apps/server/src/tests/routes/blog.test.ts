import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateLatestCache } from '../../features/blog/blog.route.js'
import * as blogGateway from '../../infrastructure/gateways/blog.gateway.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/blog.gateway.js', () => ({
	getLatestPublishedByAllKinds: vi.fn(),
}))

const app = createTestApp()

// The route module keeps its cache in module-level state (see its own
// comment on why - invalidated on every admin mutation, not on a timer
// alone) - reset it between tests so cache state from one test can't leak
// into the next regardless of execution order.
beforeEach(() => {
	vi.clearAllMocks()
	invalidateLatestCache()
})

const post = (overrides: Partial<blogGateway.BlogPost> = {}): blogGateway.BlogPost =>
	({
		id: 1,
		kind: 'patch_notes',
		title: '0.9.0 is out',
		bodyHtml: '<p>Fixed some bugs.</p>',
		status: 'published',
		publishedAt: new Date('2026-08-20T10:00:00.000Z'),
		authorPlayerId: 'author-1',
		createdAt: new Date('2026-08-19T18:00:00.000Z'),
		updatedAt: new Date('2026-08-20T10:00:00.000Z'),
		...overrides,
	}) as blogGateway.BlogPost

describe('GET /api/blog/latest', () => {
	it('returns null for both categories when nothing has ever been published', async () => {
		vi.mocked(blogGateway.getLatestPublishedByAllKinds).mockResolvedValue({
			patchNotes: null,
			news: null,
		})

		const res = await request(app).get('/api/blog/latest')

		expect(res.status).toBe(200)
		expect(res.body).toEqual({ patchNotes: null, news: null })
	})

	it('returns the latest post per category, trimmed to the public shape', async () => {
		vi.mocked(blogGateway.getLatestPublishedByAllKinds).mockResolvedValue({
			patchNotes: post({ id: 1, kind: 'patch_notes', title: 'Patch 1' }),
			news: post({ id: 2, kind: 'news', title: 'News 1' }),
		})

		const res = await request(app).get('/api/blog/latest')

		expect(res.status).toBe(200)
		expect(res.body.patchNotes).toEqual({
			id: 1,
			title: 'Patch 1',
			bodyHtml: '<p>Fixed some bugs.</p>',
			publishedAt: '2026-08-20T10:00:00.000Z',
		})
		expect(res.body.news.title).toBe('News 1')
		// Admin-only fields never leak onto the public endpoint.
		expect(res.body.patchNotes.status).toBeUndefined()
		expect(res.body.patchNotes.authorPlayerId).toBeUndefined()
	})

	it('caches the result across requests within the TTL window', async () => {
		vi.mocked(blogGateway.getLatestPublishedByAllKinds).mockResolvedValue({
			patchNotes: null,
			news: null,
		})

		await request(app).get('/api/blog/latest')
		await request(app).get('/api/blog/latest')

		expect(blogGateway.getLatestPublishedByAllKinds).toHaveBeenCalledTimes(1)
	})
})
