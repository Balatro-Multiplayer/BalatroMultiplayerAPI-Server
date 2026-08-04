import { randomUUID } from 'node:crypto'
import type { ILauncherIntegrityRepository } from '../../contracts/ILauncherIntegrityRepository.js'
import type { IMessageBus } from '../../contracts/IMessageBus.js'
import { kickClient } from '../../infrastructure/emqx/emqx-admin.service.js'
import * as launcherIntegrityGateway from '../../infrastructure/gateways/launcher-integrity.gateway.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import type {
	ChallengeKind,
	ChallengeStrategy,
	LauncherIntegrityFailureReason,
} from '../../shared/types/index.js'
import { integritySessions } from '../../state/launcher-integrity.js'
import type { IntegritySession } from '../../state/launcher-integrity.js'
import {
	CHALLENGE_TIMEOUT_MS,
	PERIODIC_MAX_MS,
	PERIODIC_MIN_MS,
} from './launcher-integrity.config.js'

interface LauncherIntegrityServiceDeps {
	messageBus: IMessageBus
	repository: ILauncherIntegrityRepository
}

export type LauncherIntegrityService = ReturnType<
	typeof createLauncherIntegrityService
>

// Server side of the launcher-integrity challenge/response system: the server
// challenges the launcher (relayed through the open-source game client --
// see BalatroMultiplayerAPI's challenge relay -- since the client can't just
// answer for itself) at login and at random intervals during the connection.
//
// Refusing the login challenge only blocks ranked queueing for that session
// (see matchmaking.service.ts's joinQueue guard) -- it does NOT disconnect
// the player, and it is not re-asked again until their next fresh login.
// Failing (wrong answer or timeout) the login challenge before ever passing
// is treated the same as an explicit refusal, for the same reason: there's
// nothing "compromised" to react to yet if they never proved anything in the
// first place. Only failing a challenge AFTER having already passed one --
// i.e. going from verified to unverified mid-session -- triggers an actual
// forced disconnect with an integrity warning.
//
// The real verify()/issue() cryptography never lives in this repo -- see
// ChallengeStrategy in packages/types. Until registerPrivate supplies one
// (packages/internal, overlaid from the private bet-launcher-integrity-private
// repo at VPS deploy time only), this whole subsystem stays inert: no
// challenges are ever issued and the ranked-queue guard is skipped entirely.
// That's deliberate -- a missing private package disables the security
// feature, not ranked play.
export function createLauncherIntegrityService(
	deps: LauncherIntegrityServiceDeps,
) {
	const { messageBus, repository } = deps
	let strategy: ChallengeStrategy | null = null

	function setChallengeStrategy(s: ChallengeStrategy): void {
		strategy = s
	}

	function isEnabled(): boolean {
		return strategy !== null
	}

	function getOrCreateSession(playerId: string): IntegritySession {
		let session = integritySessions.get(playerId)
		if (!session) {
			session = { playerId, launcherVerified: false, launcherRefused: false }
			integritySessions.set(playerId, session)
		}
		return session
	}

	function isLauncherVerified(playerId: string): boolean {
		return integritySessions.get(playerId)?.launcherVerified ?? false
	}

	function clearSession(playerId: string): void {
		const session = integritySessions.get(playerId)
		if (!session) return
		if (session.activeChallenge)
			clearTimeout(session.activeChallenge.timeoutTimer)
		if (session.nextChallengeTimer) clearTimeout(session.nextChallengeTimer)
		integritySessions.delete(playerId)
	}

	function clearAll(): void {
		for (const playerId of [...integritySessions.keys()]) clearSession(playerId)
	}

	function randomJitterMs(): number {
		return (
			PERIODIC_MIN_MS +
			Math.floor(Math.random() * (PERIODIC_MAX_MS - PERIODIC_MIN_MS))
		)
	}

	async function issueChallenge(
		playerId: string,
		kind: ChallengeKind,
	): Promise<void> {
		if (!strategy) return
		const session = getOrCreateSession(playerId)
		if (session.activeChallenge) return // one outstanding challenge per player at a time

		const issuance = await strategy.issue(playerId, kind)
		const challengeId = randomUUID()

		const timeoutTimer = setTimeout(() => {
			void handleChallengeTimeout(playerId, challengeId)
		}, CHALLENGE_TIMEOUT_MS)
		timeoutTimer.unref()

		session.activeChallenge = { challengeId, kind, issuance, timeoutTimer }

		await messageBus.publishToPlayer(playerId, 'challenge', {
			type: 'issued',
			challengeId,
			kind,
			nonce: issuance.nonce,
			algorithm: issuance.algorithm,
			expiresAt: issuance.expiresAt,
		})
	}

	// EMQX client.connected webhook (see emqx.route.ts) -- issues the login
	// challenge. A fresh MQTT connection always starts a fresh integrity
	// session: any leftover state from a prior connection (e.g. a stale timer
	// from a session that never cleanly disconnected) is invalid now.
	async function handleClientConnected(playerId: string): Promise<void> {
		if (!strategy) return
		clearSession(playerId)
		await issueChallenge(playerId, 'login')
	}

	function scheduleNextPeriodicChallenge(playerId: string): void {
		if (!strategy) return
		const session = integritySessions.get(playerId)
		if (!session?.launcherVerified) return

		const timer = setTimeout(() => {
			void issueChallenge(playerId, 'periodic')
		}, randomJitterMs())
		timer.unref()
		session.nextChallengeTimer = timer
	}

	// Shared terminal path for "this challenge did not resolve cleanly",
	// whichever way it happened (wrong response, timeout, or an explicit
	// refusal of a periodic challenge). `wasVerifiedBefore` decides the
	// severity: session-only if they'd never passed a challenge yet this
	// session, a forced disconnect if they had.
	async function failIntegrity(
		playerId: string,
		kind: ChallengeKind,
		wasVerifiedBefore: boolean,
		reason: LauncherIntegrityFailureReason,
	): Promise<void> {
		await repository.insertEvent(playerId, kind, reason).catch((err) => {
			console.error(
				'[launcher-integrity] Failed to record integrity event:',
				err,
			)
		})

		const session = integritySessions.get(playerId)
		if (!session) return

		session.launcherVerified = false

		if (!wasVerifiedBefore) {
			session.launcherRefused = true
			return
		}

		await messageBus
			.publishToPlayer(playerId, 'challenge', {
				type: 'failed',
				reason,
				message: 'Launcher integrity compromised -- disconnecting.',
			})
			.catch(() => {})
		await kickClient(playerId)
	}

	// Fired by the setTimeout armed in issueChallenge -- looks the challenge up
	// itself since the timer only closes over playerId/challengeId.
	async function handleChallengeTimeout(
		playerId: string,
		challengeId: string,
	): Promise<void> {
		const session = integritySessions.get(playerId)
		if (
			!session?.activeChallenge ||
			session.activeChallenge.challengeId !== challengeId
		)
			return

		const { kind } = session.activeChallenge
		const wasVerifiedBefore = session.launcherVerified
		session.activeChallenge = undefined

		await failIntegrity(playerId, kind, wasVerifiedBefore, 'timeout')
	}

	// MQTT player/{playerId}/challenge-response handler (see mqtt.service.ts's
	// subscribeToPlayerChallengeResponses, wired in main.ts).
	async function handleChallengeResponse(
		playerId: string,
		payload: { challengeId?: unknown; response?: unknown; refused?: unknown },
	): Promise<void> {
		if (!strategy) return
		const session = integritySessions.get(playerId)
		const active = session?.activeChallenge
		if (!session || !active) return
		if (
			typeof payload.challengeId !== 'string' ||
			payload.challengeId !== active.challengeId
		)
			return

		clearTimeout(active.timeoutTimer)
		session.activeChallenge = undefined
		const wasVerifiedBefore = session.launcherVerified

		if (payload.refused === true) {
			// Only meaningful for the login challenge -- by definition a periodic
			// challenge only ever fires for a session that already passed login,
			// so refusing one now IS the compromise signal, not a polite decline.
			if (active.kind === 'login') {
				session.launcherVerified = false
				session.launcherRefused = true
				await repository
					.insertEvent(playerId, 'login', 'refused')
					.catch((err) => {
						console.error(
							'[launcher-integrity] Failed to record integrity event:',
							err,
						)
					})
				return
			}
			await failIntegrity(playerId, active.kind, wasVerifiedBefore, 'refused')
			return
		}

		const ok = await strategy.verify(
			playerId,
			active.issuance,
			payload.response,
		)
		if (!ok) {
			await failIntegrity(
				playerId,
				active.kind,
				wasVerifiedBefore,
				'wrong_response',
			)
			return
		}

		session.launcherVerified = true
		session.launcherRefused = false
		scheduleNextPeriodicChallenge(playerId)
	}

	return {
		setChallengeStrategy,
		isEnabled,
		isLauncherVerified,
		handleClientConnected,
		handleChallengeResponse,
		clearSession,
		clearAll,
	}
}

// Module-level singleton, matching mqttService/replayLogService/
// gracePeriodService -- the EMQX webhook, the MQTT challenge-response
// subscriber, main.ts's registerPrivate call, and matchmaking.service.ts's
// joinQueue guard all need to reach the same in-memory session map without
// being threaded through DI at every call site.
export const launcherIntegrityService = createLauncherIntegrityService({
	messageBus: mqttService,
	repository: launcherIntegrityGateway,
})
