import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEV_ANSWER_PREFIX, createDevChallengeStrategy } from '../../features/launcher-integrity/dev-strategy.js'
import { RANKED_READINESS_CHALLENGE_TIMEOUT_MS } from '../../features/launcher-integrity/launcher-integrity.config.js'
import { createNakamaIntegrityService } from '../../features/nakama/integrity.js'
import { ok } from '../../shared/utils/result.js'
import { integritySessions } from '../../state/launcher-integrity.js'

const USER = '11111111-1111-4111-8111-111111111111'

function setup(online = true) {
	const callNakamaRpc = vi.fn(async (id: string, _body: Record<string, unknown>) => ok(id === 'admin_notify' ? { online } : {}))
	const setIntegrity = vi.fn(async () => undefined)
	const events = { insertEvent: vi.fn(async () => undefined) }
	const players = { findPlayerByNakamaUserId: vi.fn(async () => ({ id: 'player-1' }) as never) }
	const service = createNakamaIntegrityService({ callNakamaRpc: callNakamaRpc as never, setIntegrity, players, events })
	service.setChallengeStrategy(createDevChallengeStrategy())
	const challenge = () => {
		const call = callNakamaRpc.mock.calls.filter(([id]) => id === 'admin_notify').at(-1)!
		return call[1] as { userId: string; code: number; content: { challengeId: string; nonce: string; kind: string } }
	}
	return { service, callNakamaRpc, setIntegrity, events, players, challenge }
}

afterEach(() => {
	integritySessions.clear()
})

describe('Nakama launcher integrity', () => {
	it('sends the login challenge as a CHALLENGE notification and reports a pass', async () => {
		const { service, setIntegrity, challenge } = setup()
		await service.handleClientConnected(USER)
		const sent = challenge()
		expect(sent).toMatchObject({ userId: USER, code: 100, content: { type: 'issued', kind: 'login' } })
		await service.handleChallengeResponse(USER, {
			challengeId: sent.content.challengeId,
			response: DEV_ANSWER_PREFIX + sent.content.nonce,
		})
		expect(service.isLauncherVerified(USER)).toBe(true)
		expect(setIntegrity).toHaveBeenCalledWith(USER, { verified: true, permanent: false })
	})

	it('reports a failure and records it against the Postgres player', async () => {
		const { service, setIntegrity, events, challenge } = setup()
		await service.handleClientConnected(USER)
		await service.handleChallengeResponse(USER, { challengeId: challenge().content.challengeId, response: 'dev:wrong' })
		expect(setIntegrity).toHaveBeenCalledWith(USER, expect.objectContaining({ verified: false, reason: 'wrong_response' }))
		expect(events.insertEvent).toHaveBeenCalledWith('player-1', 'login', 'wrong_response')
	})

	it('skips the audit row for an account with no Postgres player', async () => {
		const { service, events, players, challenge } = setup()
		players.findPlayerByNakamaUserId.mockResolvedValueOnce(null as never)
		await service.handleClientConnected(USER)
		await service.handleChallengeResponse(USER, { challengeId: challenge().content.challengeId, refused: true })
		expect(events.insertEvent).not.toHaveBeenCalled()
	})

	it('ends the session of a player whose socket has closed', async () => {
		const { service } = setup(false)
		await service.handleClientConnected(USER)
		expect(integritySessions.has(USER)).toBe(false)
	})

	it('cancels the queue when ranked readiness fails', async () => {
		const { service, callNakamaRpc, challenge } = setup()
		await service.issueRankedReadinessChallenge(USER)
		const sent = challenge()
		expect(sent.content.kind).toBe('ranked_readiness')
		await service.handleChallengeResponse(USER, {
			challengeId: sent.content.challengeId,
			response: { signature: DEV_ANSWER_PREFIX + sent.content.nonce, launcherCurrent: true, modsCurrent: false },
		})
		await vi.waitFor(() =>
			expect(callNakamaRpc).toHaveBeenCalledWith('admin_queue_cancel', { userId: USER, reason: 'mods_outdated' }),
		)
	})

	it('sends verification_timeout to the queue cancel when the readiness challenge times out', async () => {
		vi.useFakeTimers()
		try {
			const { service, callNakamaRpc } = setup()
			await service.issueRankedReadinessChallenge(USER)
			await vi.advanceTimersByTimeAsync(RANKED_READINESS_CHALLENGE_TIMEOUT_MS + 100)
			expect(callNakamaRpc).toHaveBeenCalledWith('admin_queue_cancel', { userId: USER, reason: 'verification_timeout' })
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('the dev challenge strategy', () => {
	it('accepts dev:<nonce>, bare or as a readiness signature', async () => {
		const strategy = createDevChallengeStrategy()
		const issued = await strategy.issue('p', 'login')
		expect(await strategy.verify('p', issued, DEV_ANSWER_PREFIX + issued.nonce)).toBe(true)
		expect(await strategy.verify('p', issued, { signature: DEV_ANSWER_PREFIX + issued.nonce })).toBe(true)
		expect(await strategy.verify('p', issued, 'dev:other')).toBe(false)
		expect(await strategy.verify('p', issued, null)).toBe(false)
	})
})
