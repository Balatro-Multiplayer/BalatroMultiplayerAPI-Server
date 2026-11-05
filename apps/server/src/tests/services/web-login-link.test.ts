import { describe, expect, it } from 'vitest'
import { createWebLoginLinks, isWebPagePath } from '../../features/nakama/web-login-link.js'

const USER = '11111111-1111-4111-8111-111111111111'

describe('web page check', () => {
	it.each(['/matches/abc', '/profile', '/matches/abc?item=3', '/reports/12#top'])('accepts %s', (path) => {
		expect(isWebPagePath(path)).toBe(true)
	})

	it.each([
		'https://evil.example/x',
		'//evil.example/x',
		'/\\evil.example',
		'/a/../../etc',
		'matches/abc',
		'javascript:alert(1)',
		'/a\nb',
		'',
		`/${'a'.repeat(300)}`,
	])('refuses %j', (path) => {
		expect(isWebPagePath(path)).toBe(false)
	})
})

describe('one-time web login links', () => {
	it('gives the player and page once', () => {
		const links = createWebLoginLinks(() => 1000)
		const code = links.mint(USER, '/matches/abc')
		expect(links.consume(code)).toEqual({ nakamaUserId: USER, path: '/matches/abc' })
		expect(links.consume(code)).toBeNull()
	})

	it('refuses a late code', () => {
		let now = 1000
		const links = createWebLoginLinks(() => now)
		const code = links.mint(USER, '/profile')
		now += 2 * 60 * 1000 + 1
		expect(links.consume(code)).toBeNull()
	})

	it('accepts a code just before it expires', () => {
		let now = 1000
		const links = createWebLoginLinks(() => now)
		const code = links.mint(USER, '/profile')
		now += 2 * 60 * 1000
		expect(links.consume(code)).not.toBeNull()
	})

	it('refuses an unknown code', () => {
		expect(createWebLoginLinks(() => 0).consume('nope')).toBeNull()
	})

	it('mints a different code each time', () => {
		const links = createWebLoginLinks(() => 0)
		expect(links.mint(USER, '/profile')).not.toBe(links.mint(USER, '/profile'))
	})
})
