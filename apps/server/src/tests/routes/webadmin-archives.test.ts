import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()

const FIXTURE_BUNDLE_PATH =
	'test-guild-1/test-channel-1_general_2026-01-01T00-00-00-000Z'

// Matches apps/web's encodeBundlePathForApi -- NOT encodeURIComponent. The
// generic /api/proxy/[...path]/route.ts that fronts every API call in prod
// decodes %2F back into a real "/" and splits it into extra path segments
// before forwarding upstream, so a bundlePath's internal slashes never
// survive percent-encoding through it even though this test app (which
// calls the Express route directly, bypassing that proxy) wouldn't itself
// catch that regression -- see the two "real slash" tests below, which
// would still pass with plain encodeURIComponent since supertest never goes
// through the proxy. The regression is proxy-specific; this encoding is
// what actually reaches production, so it's what every test here uses.
function encodeBundlePath(bundlePath: string): string {
	return Buffer.from(bundlePath, 'utf8').toString('base64url')
}

function authAsModerator(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: ['moderator'],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

describe('GET /api/webadmin/archives', () => {
	it('returns 403 for a non-privileged player', async () => {
		createSession('Nobody', { id: 'nobody-1' })
		vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
			privileges: [],
		} as any)
		const token = `Bearer ${signJwt({ playerId: 'nobody-1', steamName: 'Nobody' })}`

		const res = await request(app)
			.get('/api/webadmin/archives')
			.set('Authorization', token)
		expect(res.status).toBe(403)
	})

	it('lists the fixture bundle for a moderator', async () => {
		const token = authAsModerator('mod-1', 'Mod')
		const res = await request(app)
			.get('/api/webadmin/archives')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.archives).toEqual([
			expect.objectContaining({
				bundlePath: FIXTURE_BUNDLE_PATH,
				channelName: 'general',
				messageCount: 2,
			}),
		])
	})

	it('filters by the search query against channel name', async () => {
		const token = authAsModerator('mod-2', 'Mod2')
		const match = await request(app)
			.get('/api/webadmin/archives?search=general')
			.set('Authorization', token)
		expect(match.body.archives).toHaveLength(1)

		const noMatch = await request(app)
			.get('/api/webadmin/archives?search=nonexistent-channel')
			.set('Authorization', token)
		expect(noMatch.body.archives).toHaveLength(0)
	})
})

describe('GET /api/webadmin/archives/:bundlePath', () => {
	it('returns messages in chronological order (the file itself is reverse-chronological)', async () => {
		const token = authAsModerator('mod-3', 'Mod3')
		const res = await request(app)
			.get(`/api/webadmin/archives/${encodeBundlePath(FIXTURE_BUNDLE_PATH)}`)
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.messages.map((m: { id: string }) => m.id)).toEqual([
			'msg-1',
			'msg-2',
		])
	})

	it('filters messages by content with ?q=', async () => {
		const token = authAsModerator('mod-4', 'Mod4')
		const res = await request(app)
			.get(
				`/api/webadmin/archives/${encodeBundlePath(FIXTURE_BUNDLE_PATH)}?q=apples`,
			)
			.set('Authorization', token)

		expect(res.body.messages).toHaveLength(1)
		expect(res.body.messages[0].id).toBe('msg-2')
	})

	it('returns a clean 404 for a nested (thread-style) path that does not exist', async () => {
		// Regression test for the bug that shipped first: this path contains a
		// real "/" once decoded, exactly the shape %2F-based encoding silently
		// broke when routed through the web app's generic API proxy in
		// production (see encodeBundlePath's comment above). It doesn't exist,
		// so this should 404 -- the thing being asserted is that it's a clean
		// JSON 404 from resolveBundleDir, not an Express-level "Cannot GET"
		// fallback (which would mean the whole path never even routed).
		const token = authAsModerator('mod-thread', 'ModThread')
		const nestedPath = `${FIXTURE_BUNDLE_PATH}/threads/some-thread-id_some-thread`
		const res = await request(app)
			.get(`/api/webadmin/archives/${encodeBundlePath(nestedPath)}`)
			.set('Authorization', token)

		expect(res.status).toBe(404)
		expect(res.body).toEqual({ error: 'Archive not found' })
	})

	it('returns 404 for a bundle that does not exist', async () => {
		const token = authAsModerator('mod-5', 'Mod5')
		const res = await request(app)
			.get(
				`/api/webadmin/archives/${encodeBundlePath('test-guild-1/nonexistent-bundle')}`,
			)
			.set('Authorization', token)
		expect(res.status).toBe(404)
	})

	it('rejects a path-traversal attempt rather than reading outside ARCHIVE_DIR', async () => {
		const token = authAsModerator('mod-6', 'Mod6')
		const res = await request(app)
			.get(
				`/api/webadmin/archives/${encodeBundlePath('../../../../../../etc/passwd')}`,
			)
			.set('Authorization', token)
		// Must not be 200 (successfully read something outside the archive
		// root) -- 400/404 are both acceptable rejections.
		expect(res.status).not.toBe(200)
		expect([400, 404]).toContain(res.status)
	})
})
