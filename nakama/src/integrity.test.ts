import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, writeConfig } from './config'
import {
	INTEGRITY_REQUIRED,
	INTEGRITY_TTL_MS,
	UNVERIFIED,
	FAILED_VERDICT,
	hasFailedVerdict,
	isVerified,
	integrityRefusal,
	readIntegrity,
	rpcAdminIntegritySet,
	rpcAdminQueueCancel,
	rpcLauncherChallengeAnswer,
	rpcLauncherSessionStart,
	verdictRecord,
	writeIntegrity,
} from './integrity'
import { beforeMatchmakerAdd, refuseMatchedGroup } from './matchmaking/gate'
import { NotifyCode } from './notify'
import { fakeLogger, fakeNk, playerCtx, serverCtx, settingsFor } from './testing/fake_nk'
import { reportVanilla } from './testing/reports'

const USER = '11111111-1111-1111-1111-111111111111'
const ENV = { EXPRESS_INTERNAL_URL: 'http://api', EXPRESS_INTERNAL_KEY: 'k' }
const ENFORCED = { ...DEFAULT_CONFIG, integrityEnforced: true }
const ADD = (kind: string) => ({ matchmakerAdd: { query: `+properties.modId:M +properties.mode:standard +properties.kind:${kind}`, stringProperties: { modId: 'M', mode: 'standard', kind } } })

describe('integrityRefusal', () => {
	it('only refuses while enforced, until a verdict that has not expired', () => {
		expect(integrityRefusal(DEFAULT_CONFIG, UNVERIFIED, 0)).toBeNull()
		expect(integrityRefusal(ENFORCED, UNVERIFIED, 0)).toBe(INTEGRITY_REQUIRED)
		const verdict = verdictRecord(true, false, 1000)
		expect(verdict.expiresAt).toBe(1000 + INTEGRITY_TTL_MS)
		expect(integrityRefusal(ENFORCED, verdict, 1000 + INTEGRITY_TTL_MS - 1)).toBeNull()
		expect(integrityRefusal(ENFORCED, verdict, 1000 + INTEGRITY_TTL_MS)).toBe(INTEGRITY_REQUIRED)
		expect(integrityRefusal(ENFORCED, verdictRecord(true, true, 0), 1e15)).toBeNull()
		expect(verdictRecord(false, true, 0)).toEqual(FAILED_VERDICT)
		expect(hasFailedVerdict(FAILED_VERDICT)).toBe(true)
		expect(hasFailedVerdict(UNVERIFIED)).toBe(false)
		expect(isVerified(FAILED_VERDICT, 0)).toBe(false)
		expect(integrityRefusal(ENFORCED, FAILED_VERDICT, 0)).toBe(INTEGRITY_REQUIRED)
	})
})

describe('the ranked queue gate', () => {
	it('lets casual through, and ranked once verified', () => {
		const nk = fakeNk()
		reportVanilla(nk, USER)
		writeConfig(nk as any, ENFORCED)
		expect(beforeMatchmakerAdd(playerCtx(USER), fakeLogger, nk as any, ADD('casual'))).toBeTruthy()
		expect(() => beforeMatchmakerAdd(playerCtx(USER), fakeLogger, nk as any, ADD('ranked'))).toThrow(INTEGRITY_REQUIRED)
		writeIntegrity(nk as any, USER, verdictRecord(true, false, Date.now()))
		expect(beforeMatchmakerAdd(playerCtx(USER, ENV), fakeLogger, nk as any, ADD('ranked'))).toBeTruthy()
		// A let-in ranked ticket starts the API's readiness check.
		expect(nk.http.map((c) => c.url)).toEqual(['http://api/internal/nakama/integrity/ranked-readiness'])
	})

	it('changes nothing while not enforced', () => {
		const nk = fakeNk()
		reportVanilla(nk, USER)
		expect(beforeMatchmakerAdd(playerCtx(USER, ENV), fakeLogger, nk as any, ADD('ranked'))).toBeTruthy()
		expect(nk.http).toHaveLength(0)
	})

	it('refuses a matched ranked group with an unverified player', () => {
		const nk = fakeNk()
		reportVanilla(nk, 'a', 'b')
		writeConfig(nk as any, ENFORCED)
		writeIntegrity(nk as any, 'a', verdictRecord(true, true, 0))
		const plan = { modId: 'M', rankedMode: 'std', gameMode: 'ranked:std', playerIds: ['a', 'b'], groups: [], teamPlan: null, requiredStanding: 'verified' as const }
		expect(refuseMatchedGroup(nk as any, settingsFor(), fakeLogger, plan)).toBe(true)
		expect(nk.notifications.map((n) => [n.userId, n.code, n.content.requeue])).toEqual([
			['a', NotifyCode.QUEUE_CANCELLED, true],
		])
		// Casual groups never need it.
		expect(refuseMatchedGroup(nk as any, settingsFor(), fakeLogger, { ...plan, rankedMode: '', gameMode: 'casual' })).toBe(false)
	})
})

describe('admin_integrity_set', () => {
	it('stores the verdict and tells the player', () => {
		const nk = fakeNk()
		rpcAdminIntegritySet(serverCtx(), fakeLogger, nk as any, JSON.stringify({ userId: USER, verified: true }))
		const stored = readIntegrity(nk as any, USER)
		expect(stored.verified).toBe(true)
		expect(stored.expiresAt).toBeGreaterThan(Date.now())
		rpcAdminIntegritySet(
			serverCtx(),
			fakeLogger,
			nk as any,
			JSON.stringify({ userId: USER, verified: false, reason: 'timeout', message: 'Failed' }),
		)
		expect(readIntegrity(nk as any, USER)).toEqual(FAILED_VERDICT)
		expect(nk.notifications.map((n) => [n.code, n.content])).toEqual([
			[NotifyCode.INTEGRITY, { verified: true, reason: null, message: null }],
			[NotifyCode.INTEGRITY, { verified: false, reason: 'timeout', message: 'Failed' }],
		])
	})

	it('is server only and checks its input', () => {
		const nk = fakeNk()
		const body = JSON.stringify({ userId: USER, verified: true })
		expect(() => rpcAdminIntegritySet(playerCtx(USER), fakeLogger, nk as any, body)).toThrow()
		expect(() => rpcAdminQueueCancel(playerCtx(USER), fakeLogger, nk as any, body)).toThrow()
		expect(() => rpcAdminIntegritySet(serverCtx(), fakeLogger, nk as any, JSON.stringify({ userId: USER }))).toThrow()
		expect(() => rpcAdminQueueCancel(serverCtx(), fakeLogger, nk as any, JSON.stringify({ userId: USER }))).toThrow()
	})
})

describe('admin_queue_cancel', () => {
	it('tells the player to leave the queue', () => {
		const nk = fakeNk()
		rpcAdminQueueCancel(
			serverCtx(),
			fakeLogger,
			nk as any,
			JSON.stringify({ userId: USER, modId: 'M', mode: 'ranked:std', reason: 'mods_outdated' }),
		)
		expect(nk.notifications).toEqual([
			{
				userId: USER,
				subject: 'queue_cancelled',
				code: NotifyCode.QUEUE_CANCELLED,
				persistent: false,
				content: { modId: 'M', mode: 'ranked:std', reason: 'mods_outdated', requeue: false },
			},
		])
	})
})

describe('launcher_session_start', () => {
	it('starts unverified and asks the API to challenge', () => {
		const nk = fakeNk()
		const res = JSON.parse(rpcLauncherSessionStart(playerCtx(USER, ENV), fakeLogger, nk as any, '[]'))
		expect(res).toEqual({ started: true })
		expect(readIntegrity(nk as any, USER)).toEqual(UNVERIFIED)
		expect(nk.http.map((c) => [c.url, JSON.parse(c.body)])).toEqual([
			['http://api/internal/nakama/integrity/session-start', { nakamaUserId: USER }],
		])
		expect(JSON.parse(rpcLauncherSessionStart(playerCtx(USER), fakeLogger, nk as any, '{}'))).toEqual({ started: false })
	})
})

describe('launcher_session_start again', () => {
	it('keeps a verdict that is still valid', () => {
		const nk = fakeNk()
		const valid = verdictRecord(true, false, Date.now())
		writeIntegrity(nk as any, USER, valid)
		rpcLauncherSessionStart(playerCtx(USER, ENV), fakeLogger, nk as any, '{}')
		expect(readIntegrity(nk as any, USER)).toEqual(valid)
		expect(nk.http).toHaveLength(1)
	})
	it('gives an expired verdict and a failed one a fresh start', () => {
		const nk = fakeNk()
		writeIntegrity(nk as any, USER, verdictRecord(true, false, Date.now() - INTEGRITY_TTL_MS - 1))
		rpcLauncherSessionStart(playerCtx(USER, ENV), fakeLogger, nk as any, '{}')
		expect(readIntegrity(nk as any, USER)).toEqual(UNVERIFIED)
		writeIntegrity(nk as any, USER, FAILED_VERDICT)
		rpcLauncherSessionStart(playerCtx(USER, ENV), fakeLogger, nk as any, '{}')
		expect(readIntegrity(nk as any, USER)).toEqual(UNVERIFIED)
	})
})

describe('launcher_challenge_answer', () => {
	it('passes the answer on to the API as the calling player', () => {
		const nk = fakeNk()
		const answer = { challengeId: 'c-1', response: { sig: 'x' } }
		rpcLauncherChallengeAnswer(playerCtx(USER, ENV), fakeLogger, nk as any, JSON.stringify(answer))
		rpcLauncherChallengeAnswer(playerCtx(USER, ENV), fakeLogger, nk as any, JSON.stringify({ challengeId: 'c-2', refused: true }))
		expect(nk.http.map((c) => [c.url, JSON.parse(c.body)])).toEqual([
			['http://api/internal/nakama/integrity/answer', { nakamaUserId: USER, ...answer }],
			['http://api/internal/nakama/integrity/answer', { nakamaUserId: USER, challengeId: 'c-2', refused: true }],
		])
	})

	it('fails when the API cannot take it', () => {
		const nk = fakeNk({ httpRequest: () => ({ code: 503, headers: {}, body: '{}' }) })
		const body = JSON.stringify({ challengeId: 'c-1', refused: true })
		expect(() => rpcLauncherChallengeAnswer(playerCtx(USER, ENV), fakeLogger, nk as any, body)).toThrow(/unavailable/)
		expect(() => rpcLauncherChallengeAnswer(playerCtx(USER), fakeLogger, nk as any, body)).toThrow(/unavailable/)
		expect(() => rpcLauncherChallengeAnswer(playerCtx(USER, ENV), fakeLogger, nk as any, '{}')).toThrow(/challengeId/)
		expect(() => rpcLauncherChallengeAnswer(serverCtx(ENV), fakeLogger, nk as any, body)).toThrow()
	})
})
