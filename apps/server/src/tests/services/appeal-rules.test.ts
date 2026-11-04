import { describe, expect, it } from 'vitest'
import {
	APPEAL_COOLDOWN_MS,
	canSubmitAppeal,
	decisionsFor,
	shortenedEnd,
} from '../../features/appeals/appeal-rules.js'

const NOW = new Date('2026-11-04T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('who may appeal again', () => {
	it('allows a first appeal', () => {
		expect(canSubmitAppeal([], NOW)).toEqual({ ok: true })
	})

	it('refuses a second appeal while one is open', () => {
		expect(canSubmitAppeal([{ status: 'open', decidedAt: null }], NOW)).toEqual({ ok: false, refusal: { code: 'open' } })
	})

	it('refuses for 30 days after a denial, then allows it', () => {
		const deniedAt = ago(29 * DAY)
		const early = canSubmitAppeal([{ status: 'denied', decidedAt: deniedAt }], NOW)
		expect(early).toEqual({
			ok: false,
			refusal: { code: 'cooling_down', availableAt: new Date(deniedAt.getTime() + APPEAL_COOLDOWN_MS) },
		})
		expect(canSubmitAppeal([{ status: 'denied', decidedAt: ago(30 * DAY) }], NOW)).toEqual({ ok: true })
	})

	it('counts the latest denial', () => {
		const history = [
			{ status: 'denied' as const, decidedAt: ago(100 * DAY) },
			{ status: 'denied' as const, decidedAt: ago(2 * DAY) },
		]
		expect(canSubmitAppeal(history, NOW)).toMatchObject({ ok: false, refusal: { code: 'cooling_down' } })
	})

	it('refuses after a granted appeal: one appeal for each punishment', () => {
		expect(canSubmitAppeal([{ status: 'granted', decidedAt: ago(DAY) }], NOW)).toEqual({
			ok: false,
			refusal: { code: 'granted' },
		})
	})
})

describe('who decides an appeal', () => {
	it('lets a moderator deny but not grant', () => {
		expect(decisionsFor({ playerId: 'm1', role: 'moderator' }, 'admin:a1')).toEqual({ deny: true, grant: false })
	})

	it("stops a moderator from acting on an appeal of their own punishment", () => {
		expect(decisionsFor({ playerId: 'm1', role: 'moderator' }, 'moderator:m1')).toEqual({ deny: false, grant: false })
	})

	it('lets an admin deny or grant, even their own', () => {
		expect(decisionsFor({ playerId: 'a1', role: 'admin' }, 'admin:a1')).toEqual({ deny: true, grant: true })
	})

	it('treats a punishment by the system as nobody own', () => {
		expect(decisionsFor({ playerId: 'm1', role: 'moderator' }, 'system')).toEqual({ deny: true, grant: false })
	})
})

describe('shortening a punishment', () => {
	it('sets a preset length from now', () => {
		expect(shortenedEnd('7d', null, NOW)).toEqual({ ok: true, expiresAt: new Date(NOW.getTime() + 7 * DAY) })
	})

	it('refuses a length that is not shorter than what is left', () => {
		const current = new Date(NOW.getTime() + 3 * DAY)
		expect(shortenedEnd('7d', current, NOW)).toEqual({ ok: false })
		expect(shortenedEnd('24h', current, NOW)).toMatchObject({ ok: true })
	})

	it('refuses permanent as a shorter length', () => {
		expect(shortenedEnd('permanent', null, NOW)).toEqual({ ok: false })
	})
})
