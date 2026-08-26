import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as blogGateway from '../../infrastructure/gateways/blog.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/blog.gateway.js', () => ({
	listPosts: vi.fn(),
	getPostById: vi.fn(),
	createPost: vi.fn(),
	updatePost: vi.fn(),
	publishPost: vi.fn(),
	unpublishPost: vi.fn(),
	deletePost: vi.fn(),
}))

const app = createTestApp()

const post = (overrides: Partial<blogGateway.BlogPost> = {}): blogGateway.BlogPost =>
	({
		id: 1,
		kind: 'patch_notes',
		title: 'Draft title',
		bodyHtml: '<p>Draft body.</p>',
		status: 'draft',
		publishedAt: null,
		authorPlayerId: 'author-1',
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}) as blogGateway.BlogPost

function authAsModerator(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: ['moderator'],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

function authAsNeither(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: [],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

describe('GET /api/webadmin/blog/posts', () => {
	it('returns 403 for a non-staff account', async () => {
		const token = authAsNeither('plain-1', 'Plain')
		const res = await request(app)
			.get('/api/webadmin/blog/posts')
			.set('Authorization', token)
		expect(res.status).toBe(403)
	})

	it('returns every post, including drafts, for a moderator', async () => {
		vi.mocked(blogGateway.listPosts).mockResolvedValue([post()])
		const token = authAsModerator('mod-1', 'Mod')
		const res = await request(app)
			.get('/api/webadmin/blog/posts')
			.set('Authorization', token)
		expect(res.status).toBe(200)
		expect(res.body.posts).toHaveLength(1)
	})
})

describe('POST /api/webadmin/blog/posts', () => {
	it('a moderator can create a post (not admin-only, unlike launcher releases)', async () => {
		vi.mocked(blogGateway.createPost).mockResolvedValue(post())
		const token = authAsModerator('mod-2', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/blog/posts')
			.set('Authorization', token)
			.send({ kind: 'patch_notes', title: 'Draft title', bodyHtml: '<p>hi</p>' })
		expect(res.status).toBe(201)
		expect(blogGateway.createPost).toHaveBeenCalledWith(
			expect.objectContaining({ authorPlayerId: 'mod-2' }),
		)
	})

	it('returns 400 for an invalid kind', async () => {
		const token = authAsModerator('mod-3', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/blog/posts')
			.set('Authorization', token)
			.send({ kind: 'not-a-real-kind', title: 'x', bodyHtml: '<p>x</p>' })
		expect(res.status).toBe(400)
	})

	it('returns 400 when bodyHtml is missing', async () => {
		const token = authAsModerator('mod-4', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/blog/posts')
			.set('Authorization', token)
			.send({ kind: 'news', title: 'x' })
		expect(res.status).toBe(400)
	})
})

describe('POST /api/webadmin/blog/posts/:id/publish', () => {
	it('publishes a post', async () => {
		vi.mocked(blogGateway.publishPost).mockResolvedValue(
			post({ status: 'published', publishedAt: new Date() }),
		)
		const token = authAsModerator('mod-5', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/blog/posts/1/publish')
			.set('Authorization', token)
		expect(res.status).toBe(200)
		expect(res.body.post.status).toBe('published')
	})

	it('returns 404 for a post that does not exist', async () => {
		vi.mocked(blogGateway.publishPost).mockResolvedValue(null)
		const token = authAsModerator('mod-6', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/blog/posts/999/publish')
			.set('Authorization', token)
		expect(res.status).toBe(404)
	})
})

describe('DELETE /api/webadmin/blog/posts/:id', () => {
	it('deletes a post', async () => {
		vi.mocked(blogGateway.deletePost).mockResolvedValue(post())
		const token = authAsModerator('mod-7', 'Mod')
		const res = await request(app)
			.delete('/api/webadmin/blog/posts/1')
			.set('Authorization', token)
		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true })
	})
})
