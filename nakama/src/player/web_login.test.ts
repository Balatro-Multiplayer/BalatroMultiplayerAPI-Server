import { describe, expect, it } from 'vitest'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { rpcWebLoginLink } from './web_login'

const ALICE = '11111111-1111-4111-8111-111111111111'
const ENV = { EXPRESS_INTERNAL_URL: 'http://api', EXPRESS_INTERNAL_KEY: 'k' }

function setup(status = 200, body = '{"url":"https://balatromp.com/auth/link?code=abc"}') {
	const nk = fakeNk({
		httpRequest: (url: string, _m: string, _h: unknown, reqBody: string) => {
			nk.http.push({ url, method: 'post', headers: {}, body: reqBody })
			return { code: status, headers: {}, body }
		},
	})
	return nk
}

const call = (nk: unknown, payload: unknown, env = ENV) =>
	rpcWebLoginLink(playerCtx(ALICE, env), fakeLogger, nk as any, JSON.stringify(payload))

describe('web_login_link', () => {
	it('asks the API for a link for this player and page', () => {
		const nk = setup()
		const res = JSON.parse(call(nk, { path: '/matches/abc' }))
		expect(res.url).toBe('https://balatromp.com/auth/link?code=abc')
		expect(nk.http[0].url).toBe('http://api/internal/nakama/web-login/link')
		expect(JSON.parse(nk.http[0].body)).toEqual({ nakamaUserId: ALICE, path: '/matches/abc' })
	})

	it('refuses a page that is not a path on the site without asking the API', () => {
		const nk = setup()
		for (const path of ['https://evil.example', '//evil.example', 'matches/abc', '', 5, undefined]) {
			expect(() => call(nk, { path })).toThrow(expect.objectContaining({ code: 3 }))
		}
		expect(nk.http).toHaveLength(0)
	})

	it('is unavailable without the API', () => {
		expect(() => call(setup(), { path: '/profile' }, {} as any)).toThrow(expect.objectContaining({ code: 14 }))
	})

	it('is unavailable when the API refuses', () => {
		expect(() => call(setup(400, '{}'), { path: '/profile' })).toThrow(expect.objectContaining({ code: 14 }))
	})
})
