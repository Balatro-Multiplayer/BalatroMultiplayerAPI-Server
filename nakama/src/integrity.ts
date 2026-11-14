// Launcher integrity: whether the player's game was started by the real
// launcher (BET), which only ranked play needs. The API (Express) keeps the
// private challenge strategy and runs the challenges: it sends each challenge
// here as a CHALLENGE notification, the client answers through
// launcher_challenge_answer, and the API's verdict comes back through
// admin_integrity_set. Nakama only keeps the latest
// verdict and gates the ranked queue on it while config.integrityEnforced.

import { pushToLobby } from './player/rpc'
import { standingFor } from './standing/current'
import type { ServerConfig } from './config'
import { callExpress } from './express'
import { INVALID_ARGUMENT, UNAVAILABLE, runtimeError } from './errors'
import { notify, NotifyCode } from './notify'
import { parsePayload, requireServer, requireUser } from './rpc'
import { settingsOf } from './server_kind'

export const INTEGRITY_COLLECTION = 'integrity'
export const INTEGRITY_KEY = 'status'
// A verdict lasts a little longer than the API's longest re-challenge gap
// (3-5 min), so a player who stops answering drops out of ranked by itself
// even if the API's failure never arrives.
export const INTEGRITY_TTL_MS = 6 * 60 * 1000
export const INTEGRITY_REQUIRED = 'Launcher integrity verification required for ranked matchmaking'

const USER_ID_PATTERN = /^[0-9a-f-]{36}$/
const CHALLENGE_ID_PATTERN = /^[0-9A-Za-z-]{1,64}$/
const MAX_RESPONSE_BYTES = 8 * 1024

// expiresAt null: never expires (the API's dev auto-verify, which issues no
// re-challenges to refresh it). failed marks a definite "no" from the API,
// against UNVERIFIED, which is only "no verdict (yet)".
export interface IntegrityRecord {
	verified: boolean
	expiresAt: number | null
	failed?: boolean
}

export const UNVERIFIED: IntegrityRecord = { verified: false, expiresAt: null }
export const FAILED_VERDICT: IntegrityRecord = { verified: false, expiresAt: null, failed: true }

// Only an answer that was wrong or refused is a definite "no". A launcher that
// never answered in time (reason 'timeout') may still be the real one, so it
// stays unverified and the client can verify again.
const DEFINITE_FAILURE_REASONS = ['wrong_response', 'refused']

export function verdictRecord(
	verified: boolean,
	permanent: boolean,
	now: number,
	reason?: string | null,
): IntegrityRecord {
	if (!verified) return reason && DEFINITE_FAILURE_REASONS.includes(reason) ? FAILED_VERDICT : UNVERIFIED
	return { verified: true, expiresAt: permanent ? null : now + INTEGRITY_TTL_MS }
}

export function isVerified(record: IntegrityRecord, now: number): boolean {
	return record.verified && (record.expiresAt === null || record.expiresAt > now)
}

export function hasFailedVerdict(record: IntegrityRecord): boolean {
	return record.failed === true
}

// Why the player may not queue for ranked, or null.
export function integrityRefusal(config: ServerConfig, record: IntegrityRecord, now: number): string | null {
	if (!config.integrityEnforced || isVerified(record, now)) return null
	return INTEGRITY_REQUIRED
}

export function readIntegrity(nk: nkruntime.Nakama, userId: string): IntegrityRecord {
	const objects = nk.storageRead([{ collection: INTEGRITY_COLLECTION, key: INTEGRITY_KEY, userId }])
	const value = objects.length > 0 ? objects[0].value : null
	if (!value) return UNVERIFIED
	if (value.verified !== true) return value.failed === true ? FAILED_VERDICT : UNVERIFIED
	return { verified: true, expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : null }
}

export function writeIntegrity(nk: nkruntime.Nakama, userId: string, record: IntegrityRecord) {
	nk.storageWrite([
		{
			collection: INTEGRITY_COLLECTION,
			key: INTEGRITY_KEY,
			userId,
			value: record as unknown as { [key: string]: unknown },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
}

// launcher_session_start: {} -> {started}. Called by the client once its
// socket is open (the challenges arrive as notifications over it), and again
// when a rejoin has to wait for a verdict: the API starts its challenges (or,
// in development, verifies outright). A verdict that is still valid stays, so
// asking again never makes it worse; anything else starts unverified. started is false when the API can't be
// reached; the player then just stays out of ranked.
export function rpcLauncherSessionStart(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	if (!isVerified(readIntegrity(nk, userId), Date.now())) writeIntegrity(nk, userId, UNVERIFIED)
	const reply = callExpress(nk, logger, ctx.env, '/integrity/session-start', { nakamaUserId: userId })
	return JSON.stringify({ started: reply !== null && reply.status >= 200 && reply.status < 300 })
}

// After a ranked ticket was let in: the API checks the launcher and mods are
// current, and cancels the queue (admin_queue_cancel) if not.
export function checkRankedReadiness(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	userId: string,
) {
	callExpress(nk, logger, ctx.env, '/integrity/ranked-readiness', { nakamaUserId: userId })
}

// {challengeId, response?, refused?} -> {}: the launcher's answer to a
// CHALLENGE, passed on to the API. The verdict arrives as INTEGRITY.
export function rpcLauncherChallengeAnswer(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	if (typeof input.challengeId !== 'string' || !CHALLENGE_ID_PATTERN.test(input.challengeId))
		throw runtimeError(INVALID_ARGUMENT, 'challengeId is required')
	const body: { [key: string]: unknown } = { nakamaUserId: userId, challengeId: input.challengeId }
	if (input.refused === true) body.refused = true
	else if (input.response !== undefined) {
		if (JSON.stringify(input.response).length > MAX_RESPONSE_BYTES)
			throw runtimeError(INVALID_ARGUMENT, 'response is too large')
		body.response = input.response
	}
	const reply = callExpress(nk, logger, ctx.env, '/integrity/answer', body)
	if (!reply || reply.status < 200 || reply.status >= 300)
		throw runtimeError(UNAVAILABLE, 'The integrity service is unavailable')
	return JSON.stringify({})
}

function requireUserId(input: { [key: string]: unknown }): string {
	if (typeof input.userId !== 'string' || !USER_ID_PATTERN.test(input.userId))
		throw runtimeError(INVALID_ARGUMENT, 'userId is required')
	return input.userId
}

function optionalString(value: unknown): string | null {
	return typeof value === 'string' ? value.slice(0, 200) : null
}

// {userId, verified, permanent?, reason?, message?} -> {}: the API's verdict.
// The player hears it as INTEGRITY {verified, reason, message}.
export function rpcAdminIntegritySet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const userId = requireUserId(input)
	if (typeof input.verified !== 'boolean') throw runtimeError(INVALID_ARGUMENT, 'verified is required')
	writeIntegrity(
		nk,
		userId,
		verdictRecord(input.verified, input.permanent === true, Date.now(), optionalString(input.reason)),
	)
	notify(nk, userId, NotifyCode.INTEGRITY, 'integrity', {
		verified: input.verified,
		reason: optionalString(input.reason),
		message: optionalString(input.message),
	})
	// A verdict moves the standing; the lobby's snapshot follows.
	pushToLobby(nk, logger, userId, { standing: standingFor(nk, settingsOf(ctx), userId, Date.now()).standing })
	return JSON.stringify({})
}

// {userId, modId?, mode?, reason} -> {}: the API refused a queued player
// (ranked readiness failed). The client leaves the queue and says why.
export function rpcAdminQueueCancel(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const userId = requireUserId(input)
	const reason = optionalString(input.reason)
	if (!reason) throw runtimeError(INVALID_ARGUMENT, 'reason is required')
	notify(nk, userId, NotifyCode.QUEUE_CANCELLED, 'queue_cancelled', {
		modId: optionalString(input.modId),
		mode: optionalString(input.mode),
		reason,
		requeue: false,
	})
	return JSON.stringify({})
}
