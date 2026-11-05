import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../env.js'
import { WEB_LOGIN_LINK_TTL_MS } from '../../features/nakama/web-login-link.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createTestApp } from './app.js'

const app = createTestApp()
const mutableEnv = env as { NOTICE_REQUIRED: boolean; INTERNAL_API_KEY: string }
const originalKey = env.INTERNAL_API_KEY
const originalNotice = env.NOTICE_REQUIRED
const KEY = 'secret-key'
const NAKAMA_ID = '11111111-1111-4111-8111-111111111111'
const PLAYER = {
	id: 'player-1',
	steamIdHash: null,
	discordIdHash: null,
	discordUsername: null,
	useDiscordName: false,
	preferredJoker: 'j_joker',
	privileges: [] as string[],
	steamName: 'Alice',
	chatEnabled: true,
	chatBlocked: false,
	tosAcceptedVersion: 99,
	noticeAcceptedAt: null,
	deletedAt: null,
}

async function mint(path: string) {
	return request(app)
		.post('/internal/nakama/web-login/link')
		.set('X-BMP-Internal-Key', KEY)
		.send({ nakamaUserId: NAKAMA_ID, path })
}

async function mintCode(path = '/matches/abc?item=3'): Promise<string> {
	const res = await mint(path)
	expect(res.status).toBe(200)
	return new URL(res.body.url).searchParams.get('code')!
}

describe('one-time web login link', () => {
	beforeEach(() => {
		mutableEnv.INTERNAL_API_KEY = KEY
		mutableEnv.NOTICE_REQUIRED = false
		vi.mocked(playerGateway.findPlayerByNakamaUserId).mockResolvedValue(PLAYER)
	})
	afterEach(() => {
		vi.useRealTimers()
		mutableEnv.INTERNAL_API_KEY = originalKey
		mutableEnv.NOTICE_REQUIRED = originalNotice
	})

	it('needs the internal key', async () => {
		const res = await request(app).post('/internal/nakama/web-login/link').send({ nakamaUserId: NAKAMA_ID, path: '/profile' })
		expect(res.status).toBe(401)
	})

	it('gives a link on the website that logs the player in and names the page', async () => {
		const res = await mint('/matches/abc?item=3')
		expect(res.body.url.startsWith(`${env.WEB_BASE_URL.replace(/\/$/, '')}/auth/link?code=`)).toBe(true)
		const code = new URL(res.body.url).searchParams.get('code')!

		const login = await request(app).post('/api/auth/link-login').send({ code })
		expect(login.status).toBe(200)
		expect(login.body.path).toBe('/matches/abc?item=3')
		const session = jwt.verify(login.body.token, env.JWT_SECRET) as { playerId: string }
		expect(session.playerId).toBe('player-1')
	})

	it('works once', async () => {
		const code = await mintCode()
		expect((await request(app).post('/api/auth/link-login').send({ code })).status).toBe(200)
		const again = await request(app).post('/api/auth/link-login').send({ code })
		expect(again.status).toBe(401)
		expect(again.body.token).toBeUndefined()
	})

	it('does not work late', async () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		const code = await mintCode()
		vi.setSystemTime(Date.now() + WEB_LOGIN_LINK_TTL_MS + 1000)
		const late = await request(app).post('/api/auth/link-login').send({ code })
		expect(late.status).toBe(401)
	})

	it('refuses a code nobody minted', async () => {
		expect((await request(app).post('/api/auth/link-login').send({ code: 'nope' })).status).toBe(401)
		expect((await request(app).post('/api/auth/link-login').send({})).status).toBe(401)
	})

	it.each(['https://evil.example/x', '//evil.example', 'matches/abc', '/a/../b'])('refuses the page %s', async (path) => {
		expect((await mint(path)).status).toBe(400)
	})

	it('refuses a bad Nakama user id', async () => {
		const res = await request(app)
			.post('/internal/nakama/web-login/link')
			.set('X-BMP-Internal-Key', KEY)
			.send({ nakamaUserId: 'x', path: '/profile' })
		expect(res.status).toBe(400)
	})

	it('refuses a player with no account row', async () => {
		vi.mocked(playerGateway.findPlayerByNakamaUserId).mockResolvedValue(null)
		const code = await mintCode()
		expect((await request(app).post('/api/auth/link-login').send({ code })).status).toBe(401)
	})

	it('sends a player who has not accepted the Notice to the Notice step', async () => {
		mutableEnv.NOTICE_REQUIRED = true
		vi.mocked(playerGateway.findPlayerByNakamaUserId).mockResolvedValue({ ...PLAYER, tosAcceptedVersion: 0 })
		const code = await mintCode('/profile')
		const login = await request(app).post('/api/auth/link-login').send({ code })
		expect(login.status).toBe(200)
		expect(login.body.token).toBeUndefined()
		expect(typeof login.body.tosToken).toBe('string')
		expect(login.body.path).toBe('/profile')
	})
})
