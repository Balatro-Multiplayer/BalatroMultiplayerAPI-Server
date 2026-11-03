import { randomUUID } from 'node:crypto'
import type { ILauncherIntegrityRepository } from '../../contracts/ILauncherIntegrityRepository.js'
import { env } from '../../env.js'
import type {
	ChallengeKind,
	ChallengeStrategy,
	LauncherIntegrityFailureReason,
} from '../../shared/types/index.js'
import { integritySessions } from '../../state/launcher-integrity.js'
import type {
	IntegrityChallenge,
	IntegritySession,
} from '../../state/launcher-integrity.js'
import {
	CHALLENGE_TIMEOUT_MS,
	LOGIN_CHALLENGE_TIMEOUT_MS,
	MAX_OFFLINE_PERIODIC_CHECKS,
	PERIODIC_MAX_MS,
	PERIODIC_MIN_MS,
	RANKED_READINESS_CHALLENGE_TIMEOUT_MS,
} from './launcher-integrity.config.js'

// The service's verdict on a player, each time it changes: passed a
// challenge, failed one, or (permanent) dev auto-verified with no
// re-challenges to come.
export interface IntegrityVerdict {
	verified: boolean
	permanent: boolean
	reason?: LauncherIntegrityFailureReason
	message?: string
}

// Sends a player one 'challenge' message: issued, verified or failed.
// Resolves 'offline' when the player has no open socket to receive it.
export type ChallengeSender = (
	playerId: string,
	payload: Record<string, unknown>,
) => Promise<void | 'offline'>

interface LauncherIntegrityServiceDeps {
	sendChallenge: ChallengeSender
	repository: ILauncherIntegrityRepository
	// Told every verdict (best effort, errors are logged): Nakama keeps its
	// own copy to gate its ranked queue on - see features/nakama/integrity.ts.
	onVerdict?: (playerId: string, verdict: IntegrityVerdict) => Promise<void>
}

const FAILED_MESSAGE =
	"Anti-cheat check failed. You'll need to pass it to queue for Ranked."

export type LauncherIntegrityService = ReturnType<
	typeof createLauncherIntegrityService
>

// 'verification_timeout' is the launcher never answering in time -- not a
// verdict that anything is out of date, so it must not read as one.
export type RankedReadinessFailureReason =
	| 'launcher_outdated'
	| 'mods_outdated'
	| 'verification_timeout'
type RankedReadinessFailureHandler = (
	playerId: string,
	reason: RankedReadinessFailureReason,
) => void

// Defensive runtime extraction, not a cast -- `response` is untrusted
// network input. See
// RANKED_READINESS_SPEC.md for the wire contract this expects (the base
// signature already having verified only proves the response came from a
// launcher holding the shared secret, not that these two fields are even
// present/well-typed).
function extractReadinessVerdict(
	response: unknown,
): { launcherCurrent: boolean; modsCurrent: boolean } | null {
	if (!response || typeof response !== 'object') return null
	const { launcherCurrent, modsCurrent } = response as {
		launcherCurrent?: unknown
		modsCurrent?: unknown
	}
	if (typeof launcherCurrent !== 'boolean' || typeof modsCurrent !== 'boolean')
		return null
	return { launcherCurrent, modsCurrent }
}

// Server side of the launcher-integrity challenge/response system: the server
// challenges the launcher (relayed through the open-source game client --
// see BalatroMultiplayerAPI's challenge relay -- since the client can't just
// answer for itself) at login and at random intervals during the connection.
//
// Any challenge failure -- wrong answer, timeout, or an explicit refusal,
// whether it's the very first (login) challenge or a later periodic one --
// clears launcherVerified and tells the player why over the same channel (a
// 'challenge'/type='failed' message the mod surfaces as a real in-game
// notice - see BalatroMultiplayerAPI's networking/connection.lua and
// ui/anticheat_failed_overlay.lua), but does NOT disconnect them (see
// failIntegrity below). A cctl-launched or otherwise non-BET client can
// never answer this challenge, and by design that only costs it Ranked
// eligibility (the verdict gates Nakama's Ranked queue hook) -- Casual play, private lobbies, and everything
// else stay fully usable while unverified.
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
	const { sendChallenge, repository, onVerdict } = deps
	let strategy: ChallengeStrategy | null = null
	let rankedReadinessFailureHandler: RankedReadinessFailureHandler | null = null

	function setChallengeStrategy(s: ChallengeStrategy): void {
		strategy = s
	}

	async function reportVerdict(
		playerId: string,
		verdict: IntegrityVerdict,
	): Promise<void> {
		if (!onVerdict) return
		await onVerdict(playerId, verdict).catch((err) => {
			console.error('[launcher-integrity] Failed to report verdict:', err)
		})
	}

	function isEnabled(): boolean {
		return strategy !== null
	}

	// nakama/integrity.ts registers exactly one handler here, which cancels
	// the player's Nakama queue ticket. Fired only on a ranked_readiness
	// failure/refusal/timeout/stale-verdict; a successful current+current
	// verdict needs no action at all (the player just stays queued).
	function onRankedReadinessFailed(
		handler: RankedReadinessFailureHandler,
	): void {
		rankedReadinessFailureHandler = handler
	}

	// Called right after a Ranked queue join (Nakama's queue hook, through
	// /internal/nakama/integrity/ranked-readiness) - fire-and-forget from that call site,
	// the eventual outcome arrives asynchronously through
	// handleChallengeResponse/handleChallengeTimeout below, same as every
	// other challenge kind.
	async function issueRankedReadinessChallenge(
		playerId: string,
	): Promise<void> {
		await issueChallenge(playerId, 'ranked_readiness')
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

		// login and ranked_readiness get a longer allowance than periodic --
		// see LOGIN_CHALLENGE_TIMEOUT_MS's and
		// RANKED_READINESS_CHALLENGE_TIMEOUT_MS's comments for why.
		const timeoutMs =
			kind === 'login'
				? LOGIN_CHALLENGE_TIMEOUT_MS
				: kind === 'ranked_readiness'
					? RANKED_READINESS_CHALLENGE_TIMEOUT_MS
					: CHALLENGE_TIMEOUT_MS
		const timeoutTimer = setTimeout(() => {
			void handleChallengeTimeout(playerId, challengeId)
		}, timeoutMs)
		timeoutTimer.unref()

		session.activeChallenge = { challengeId, kind, issuance, timeoutTimer }

		const sent = await sendChallenge(playerId, {
			type: 'issued',
			challengeId,
			kind,
			nonce: issuance.nonce,
			algorithm: issuance.algorithm,
			expiresAt: issuance.expiresAt,
		})
		if (sent === 'offline') handleChallengeUndelivered(playerId, challengeId)
		else if (session.offlineChecks) session.offlineChecks = 0
	}

	// A challenge that found the player's socket closed. Nobody could answer
	// it, so it is neither a pass nor a failure: drop it without an integrity
	// event or a verdict change, and keep a verified player's check session so
	// the next slot can check again once the socket reopens. Anything else
	// (unverified, or too many misses in a row) ends the session.
	function handleChallengeUndelivered(
		playerId: string,
		challengeId: string,
	): void {
		const session = integritySessions.get(playerId)
		if (session?.activeChallenge?.challengeId !== challengeId) return
		clearTimeout(session.activeChallenge.timeoutTimer)
		session.activeChallenge = undefined

		session.offlineChecks = (session.offlineChecks ?? 0) + 1
		if (
			!session.launcherVerified ||
			session.offlineChecks >= MAX_OFFLINE_PERIODIC_CHECKS
		) {
			clearSession(playerId)
			return
		}
		scheduleNextPeriodicChallenge(playerId)
	}

	// Nakama session start (/internal/nakama/integrity/session-start) -- issues the login
	// challenge. A fresh session always starts a fresh integrity
	// session: any leftover state from a prior connection (e.g. a stale timer
	// from a session that never cleanly disconnected) is invalid now.
	async function handleClientConnected(playerId: string): Promise<void> {
		if (!strategy) return
		clearSession(playerId)

		// See env.ts's doc comment: a dev-only bypass so a non-BET client (e.g.
		// ClaudeControl-driven testing) can be Ranked-eligible without ever
		// answering a real challenge. No challenge is issued at all -- not even
		// a periodic one later -- since the client has no way to answer either.
		if (env.DEV_AUTO_VERIFY_LAUNCHER) {
			const session = getOrCreateSession(playerId)
			session.launcherVerified = true
			await reportVerdict(playerId, { verified: true, permanent: true })
			return
		}

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
	// whichever way it happened (wrong response, timeout, or a refusal --
	// login or periodic, doesn't matter, see handleChallengeResponse).
	// `wasVerifiedBefore` is kept as a parameter since every call site already
	// computes it and it remains useful context for the audit trail, even
	// though it doesn't change what happens here.
	//
	// Deliberately does NOT disconnect the player -- only clears
	// launcherVerified, which is all Nakama's Ranked queue guard actually
	// checks. Casual play, private lobbies, chat, etc. are
	// untouched by a failed/refused/timed-out challenge. This is what makes
	// the check non-punitive for anyone who simply isn't running through the
	// real launcher (Casual players, a manual game launch, ClaudeControl-driven
	// testing) instead of the forced rejoin a kick would otherwise require.
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
		session.launcherRefused = true

		await sendChallenge(playerId, {
			type: 'failed',
			reason,
			message: FAILED_MESSAGE,
		}).catch(() => {})
		await reportVerdict(playerId, {
			verified: false,
			permanent: false,
			reason,
			message: FAILED_MESSAGE,
		})
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
		session.activeChallenge = undefined

		if (kind === 'ranked_readiness') {
			// Deliberately not failIntegrity() - that mutates
			// launcherVerified, which gates the separate login/periodic
			// identity handshake (see isLauncherVerified()'s doc comment).
			// A readiness challenge timing out is a different concept and
			// shouldn't also block a future queue attempt through that
			// unrelated gate - see handleRankedReadinessResponse's own
			// comment for the same reasoning applied to its other failure
			// paths.
			console.warn(
				`[launcher-integrity] ranked_readiness challenge timed out for player ${playerId}`,
			)
			rankedReadinessFailureHandler?.(playerId, 'verification_timeout')
			return
		}

		const wasVerifiedBefore = session.launcherVerified
		await failIntegrity(playerId, kind, wasVerifiedBefore, 'timeout')
	}

	// The player's answer, relayed by /internal/nakama/integrity/answer.
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

		if (active.kind === 'ranked_readiness') {
			await handleRankedReadinessResponse(playerId, active, payload)
			return
		}

		const wasVerifiedBefore = session.launcherVerified

		if (payload.refused === true) {
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

		// Tells the mod it actually passed, not just that it answered - see
		// MPAPI's networking/connection.lua and anticheat/launcher_channel.lua.
		// Without this, nothing client-side ever learns the *server's* verdict
		// on a challenge response, which is exactly what a Ranked queue-button
		// gate needs (a client-only "did BET answer" check can't tell a wrong
		// answer from a right one). Best-effort like the 'failed' publish
		// below - a lost notification just means the client's gate stays
		// closed until the next periodic challenge succeeds, not a security
		// hole (Nakama's ranked queue hook is the actual enforcement point
		// either way).
		await sendChallenge(playerId, {
			type: 'verified',
			challengeId: active.challengeId,
			kind: active.kind,
		}).catch(() => {})
		await reportVerdict(playerId, { verified: true, permanent: false })

		scheduleNextPeriodicChallenge(playerId)
	}

	// Split out of handleChallengeResponse (branched there before this kind
	// ever reaches the login/periodic-specific logic below it) since its
	// outcome handling is entirely different: no launcherVerified mutation
	// (see the ranked_readiness branch of handleChallengeTimeout above for
	// why), no 'verified'/'failed' publish on the challenge topic. A refusal,
	// a failed base signature verification, or an unusable response shape all
	// conservatively map to 'launcher_outdated' - the broader,
	// always-correct-to-suggest fix
	// ("update BET") rather than guessing which specific thing actually
	// went wrong when there's no real verdict to read.
	async function handleRankedReadinessResponse(
		playerId: string,
		active: IntegrityChallenge,
		payload: { response?: unknown; refused?: unknown },
	): Promise<void> {
		if (payload.refused === true) {
			console.warn(
				`[launcher-integrity] ranked_readiness refused for player ${playerId}`,
			)
			rankedReadinessFailureHandler?.(playerId, 'launcher_outdated')
			return
		}

		const ok = strategy
			? await strategy.verify(playerId, active.issuance, payload.response)
			: false
		if (!ok) {
			console.warn(
				`[launcher-integrity] ranked_readiness verification failed for player ${playerId}`,
			)
			rankedReadinessFailureHandler?.(playerId, 'launcher_outdated')
			return
		}

		const verdict = extractReadinessVerdict(payload.response)
		if (!verdict) {
			console.warn(
				`[launcher-integrity] ranked_readiness verified but response shape was unusable for player ${playerId}`,
			)
			rankedReadinessFailureHandler?.(playerId, 'launcher_outdated')
			return
		}

		if (!verdict.launcherCurrent) {
			rankedReadinessFailureHandler?.(playerId, 'launcher_outdated')
			return
		}
		if (!verdict.modsCurrent) {
			rankedReadinessFailureHandler?.(playerId, 'mods_outdated')
			return
		}
		// Both current - nothing to do, the player just stays queued.
	}

	return {
		setChallengeStrategy,
		isEnabled,
		isLauncherVerified,
		issueRankedReadinessChallenge,
		onRankedReadinessFailed,
		handleClientConnected,
		handleChallengeResponse,
		clearSession,
		clearAll,
	}
}
