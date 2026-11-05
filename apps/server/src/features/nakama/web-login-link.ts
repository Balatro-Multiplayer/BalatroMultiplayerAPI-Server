import { randomBytes } from 'node:crypto'

// One-time login links from the game to the website. Nakama asks for a link
// for a named website page; opening it exchanges the code for a website
// session once, then lands on that page. Codes live in memory, like the
// Discord link state, and expire fast.
export const WEB_LOGIN_LINK_TTL_MS = 2 * 60 * 1000
const MAX_PATH = 200
const PAGE_PATH = /^\/[A-Za-z0-9._~\-/?=&%#]*$/

// A website page of ours: a path on this site, never a scheme, a host or a
// path that climbs out of the site.
export function isWebPagePath(path: unknown): path is string {
	if (typeof path !== 'string' || path.length > MAX_PATH) return false
	if (!PAGE_PATH.test(path)) return false
	if (path.startsWith('//')) return false
	return !path.split(/[?#]/)[0].split('/').includes('..')
}

export interface WebLoginTarget {
	nakamaUserId: string
	path: string
}

export function createWebLoginLinks(now: () => number = () => Date.now()) {
	const pending = new Map<string, WebLoginTarget & { expiresAt: number }>()

	function sweep() {
		const t = now()
		for (const [code, entry] of pending) if (entry.expiresAt < t) pending.delete(code)
	}

	return {
		mint(nakamaUserId: string, path: string): string {
			sweep()
			const code = randomBytes(32).toString('hex')
			pending.set(code, { nakamaUserId, path, expiresAt: now() + WEB_LOGIN_LINK_TTL_MS })
			return code
		},

		// The target once, or null for an unknown, used or late code.
		consume(code: string): WebLoginTarget | null {
			const entry = pending.get(code)
			if (!entry) return null
			pending.delete(code)
			if (entry.expiresAt < now()) return null
			return { nakamaUserId: entry.nakamaUserId, path: entry.path }
		},
	}
}

export const webLoginLinks = createWebLoginLinks()
