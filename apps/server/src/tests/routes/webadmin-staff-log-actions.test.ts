import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../infrastructure/nakama/moderation-sync.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	kickFromNakamaLobby: vi.fn(),
	closeNakamaLobby: vi.fn(),
}))
vi.mock('../../infrastructure/gateways/config.gateway.js', () => ({
	loadConfigFromDb: vi.fn(),
}))
vi.mock('../../infrastructure/gateways/blog.gateway.js', () => ({
	listPosts: vi.fn(),
	getPostById: vi.fn(),
	createPost: vi.fn(),
	updatePost: vi.fn(),
	publishPost: vi.fn(),
	unpublishPost: vi.fn(),
	deletePost: vi.fn(),
}))
vi.mock('../../infrastructure/gateways/launcher-releases.gateway.js', () => ({
	listReleases: vi.fn(),
	getReleaseWithAssetsById: vi.fn(),
	upsertRelease: vi.fn(),
	upsertAsset: vi.fn(),
	deleteRelease: vi.fn(),
	deleteAssetRow: vi.fn(),
}))
vi.mock('../../infrastructure/gateways/mods.gateway.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findModByIdOrFullName: vi.fn(),
	setRankedVersion: vi.fn(),
}))

import { signJwt } from '../../features/auth/jwt.js'
import { db } from '../../infrastructure/db/index.js'
import * as blogGateway from '../../infrastructure/gateways/blog.gateway.js'
import * as configGateway from '../../infrastructure/gateways/config.gateway.js'
import * as launcherGateway from '../../infrastructure/gateways/launcher-releases.gateway.js'
import * as modsGateway from '../../infrastructure/gateways/mods.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import { closeNakamaLobby, kickFromNakamaLobby } from '../../infrastructure/nakama/moderation-sync.js'
import { createSession } from '../../state/index.js'
import { setConfig } from '../../state/config.js'
import { createTestApp } from './app.js'

const app = createTestApp()

function authAs(privilege: 'admin' | 'moderator', playerId: string) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ privileges: [privilege] } as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const POST = { id: 4, kind: 'news', title: 'Old title', bodyHtml: '<p>x</p>', status: 'draft' } as any

beforeEach(() => {
	vi.mocked(recordStaffAction).mockClear()
	vi.mocked(kickFromNakamaLobby).mockResolvedValue(true)
	vi.mocked(closeNakamaLobby).mockResolvedValue(true)
	vi.mocked(blogGateway.getPostById).mockResolvedValue(POST)
	vi.mocked(blogGateway.createPost).mockResolvedValue(POST)
	vi.mocked(blogGateway.updatePost).mockResolvedValue({ ...POST, title: 'New title' })
	vi.mocked(blogGateway.publishPost).mockResolvedValue(POST)
	vi.mocked(blogGateway.unpublishPost).mockResolvedValue(POST)
	vi.mocked(blogGateway.deletePost).mockResolvedValue(POST)
	vi.mocked(launcherGateway.deleteRelease).mockResolvedValue({ id: 3, version: '1.2.0' } as any)
	vi.mocked(launcherGateway.deleteAssetRow).mockResolvedValue({ id: 9 } as any)
	vi.mocked(modsGateway.findModByIdOrFullName).mockResolvedValue({
		id: 'Author@Mod',
		isCustom: false,
		rankedVersion: '1.0.0',
	} as any)
	vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({ ok: true })
	vi.mocked(configGateway.loadConfigFromDb).mockResolvedValue({
		mods: [],
		chatAllowlist: new Set(),
		rankedEnabled: false,
		queueAllowedModIds: [],
	} as any)
})

type Call = [method: 'post' | 'put' | 'patch' | 'delete', path: string, body: object, role: 'admin' | 'moderator']

// Every route that needs a reason, with a body that is valid apart from it.
const ROUTES: Call[] = [
	['post', '/lobbies/ABCDE/kick/p1', {}, 'moderator'],
	['post', '/lobbies/ABCDE/close', {}, 'moderator'],
	['patch', '/config/feature-flags', { rankedEnabled: true }, 'admin'],
	['put', '/config/mods/Mod', { displayName: 'M', version: '1', downloadUrl: 'https://x.test' }, 'admin'],
	['delete', '/config/mods/Mod', {}, 'admin'],
	['post', '/config/chat-allowlist', { message: 'gg' }, 'admin'],
	['delete', '/config/chat-allowlist/gg', {}, 'admin'],
	['post', '/seasons', { name: 'S2' }, 'admin'],
	['post', '/seasons/2/activate', {}, 'admin'],
	['post', '/seasons/2/end', {}, 'admin'],
	['put', '/mods/Author-Mod', { rankedVersion: '2.0.0' }, 'admin'],
	['post', '/launcher-releases/from-github', { tag: 'v1' }, 'admin'],
	['delete', '/launcher-releases/3', {}, 'admin'],
	['delete', '/launcher-releases/3/windows', {}, 'admin'],
	['post', '/blog/posts', { kind: 'news', title: 't', bodyHtml: '<p>x</p>' }, 'moderator'],
	['patch', '/blog/posts/4', { title: 'New title' }, 'moderator'],
	['post', '/blog/posts/4/publish', {}, 'moderator'],
	['post', '/blog/posts/4/unpublish', {}, 'moderator'],
	['delete', '/blog/posts/4', {}, 'moderator'],
]

describe('admin actions need a reason', () => {
	for (const [method, path, body, role] of ROUTES) {
		it(`${method.toUpperCase()} ${path}: 400 with no reason, nothing logged`, async () => {
			const token = authAs(role, `staff-${role}`)
			for (const extra of [{}, { reason: '   ' }]) {
				const res = await request(app)[method](`/api/webadmin${path}`).set('Authorization', token).send({ ...body, ...extra })
				expect(res.status).toBe(400)
				expect(res.body.error ?? res.body.message).toMatch(/reason/)
			}
			expect(recordStaffAction).not.toHaveBeenCalled()
		})
	}
})

describe('admin actions write a staff log entry', () => {
	const send = (method: 'post' | 'put' | 'patch' | 'delete', path: string, token: string, body: object) =>
		request(app)[method](`/api/webadmin${path}`).set('Authorization', token).send(body)

	it('logs a lobby kick with the kicked player', async () => {
		const res = await send('post', '/lobbies/ABCDE/kick/p1', authAs('moderator', 'mod-kick'), { reason: 'cheating' })
		expect(res.status).toBe(200)
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				staff: { playerId: 'mod-kick', role: 'moderator' },
				action: 'lobby_kick',
				targetPlayerId: 'p1',
				reason: 'cheating',
				detail: { code: 'ABCDE' },
			}),
		)
	})

	it('logs a lobby close', async () => {
		await send('post', '/lobbies/ABCDE/close', authAs('moderator', 'mod-close'), { reason: 'abuse' })
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ action: 'lobby_close', reason: 'abuse', detail: { code: 'ABCDE' } }),
		)
	})

	it('logs a feature flag change with the old and new value', async () => {
		setConfig({ ...(await import('../../state/config.js')).getConfig(), rankedEnabled: false })
		const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		;(db as any).update = vi.fn().mockReturnValue({ set })
		await send('patch', '/config/feature-flags', authAs('admin', 'adm-flag'), { rankedEnabled: true, reason: 'event' })
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				staff: { playerId: 'adm-flag', role: 'admin' },
				action: 'config_change',
				reason: 'event',
				detail: { old: { rankedEnabled: false }, new: { rankedEnabled: true } },
			}),
		)
	})

	it('logs an allowlist addition', async () => {
		await send('post', '/config/chat-allowlist', authAs('admin', 'adm-allow'), { message: 'gg', reason: 'common' })
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ action: 'allowlist_add', reason: 'common', detail: { message: 'gg' } }),
		)
	})

	it('logs a ranked mod pin with the old and new version', async () => {
		const res = await send('put', '/mods/Author-Mod', authAs('admin', 'adm-pin'), {
			rankedVersion: '2.0.0',
			reason: 'new release',
		})
		expect(res.status).toBe(200)
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				action: 'mod_pin',
				reason: 'new release',
				detail: { modId: 'Author@Mod', old: { rankedVersion: '1.0.0' }, new: { rankedVersion: '2.0.0' } },
			}),
		)
	})

	it('logs a launcher release delete', async () => {
		await send('delete', '/launcher-releases/3', authAs('admin', 'adm-rel'), { reason: 'bad build' })
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ action: 'launcher_release_delete', reason: 'bad build', detail: { releaseId: 3, version: '1.2.0' } }),
		)
	})

	it('logs a blog edit with the old and new title', async () => {
		await send('patch', '/blog/posts/4', authAs('moderator', 'mod-blog'), { title: 'New title', reason: 'typo' })
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				action: 'blog_update',
				reason: 'typo',
				detail: { postId: 4, old: { title: 'Old title' }, new: { title: 'New title' } },
			}),
		)
	})

	it('logs a blog publish', async () => {
		await send('post', '/blog/posts/4/publish', authAs('moderator', 'mod-pub'), { reason: 'ready' })
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ action: 'blog_publish', reason: 'ready', detail: { postId: 4 } }),
		)
	})

	it('logs a season start with the season it ended', async () => {
		const tx = {
			update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
			insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 3, name: 'S3' }]) }) }),
		}
		;(db as any).transaction = vi.fn(async (fn: (t: unknown) => unknown) => fn(tx))
		const res = await send('post', '/seasons', authAs('admin', 'adm-season'), { name: 'S3', reason: 'new season' })
		expect(res.status).toBe(201)
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ action: 'season_start', reason: 'new season', detail: expect.objectContaining({ seasonId: 3, name: 'S3' }) }),
		)
	})
})
