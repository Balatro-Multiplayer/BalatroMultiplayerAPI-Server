// Player reports (the API's POST /lobby/:code/report). A report is filed from
// the reporter's current lobby; the lobby supplies its evidence (the game it
// is about and the chat tail) and the report is handed to the API, which
// keeps reports, their chat history and the service queue in Postgres.
import {
	INVALID_ARGUMENT,
	NOT_FOUND,
	RESOURCE_EXHAUSTED,
	UNAVAILABLE,
	runtimeError,
} from '../errors'
import { callExpress } from '../express'
import type { ReportEvidence } from '../lobby/chat'
import { type LobbySignal, lobbyIdOf } from '../lobby/protocol'
import { currentLobby } from '../lobby/rpc'
import { lobbyKindOfLabel } from '../review/ranked'
import { parsePayload, requireUser } from '../rpc'

// The API's REPORT_TYPES (report.gateway.ts).
export const REPORT_TYPES = ['cheating', 'chat_abuse', 'griefing', 'inappropriate_username', 'other']
export const MAX_REPORT_MESSAGE = 500
// At most REPORT_LIMIT reports per reporter in any REPORT_WINDOW_MS.
export const REPORT_LIMIT = 5
export const REPORT_WINDOW_MS = 10 * 60_000
const LIMIT_COLLECTION = 'moderation'
const LIMIT_KEY = 'report_times'

export interface ReportInput {
	reportedUserId: string
	type: string
	message?: string
}

// Pure: the payload as a report, or why it isn't one.
export function parseReport(data: { [key: string]: unknown }): ReportInput | string {
	const { reportedUserId, type, message } = data
	if (typeof reportedUserId !== 'string' || !reportedUserId) return 'Missing or invalid reportedUserId'
	if (typeof type !== 'string' || REPORT_TYPES.indexOf(type) === -1) return 'Invalid report type'
	if (message !== undefined && message !== null && (typeof message !== 'string' || message.length > MAX_REPORT_MESSAGE))
		return `Invalid message (max ${MAX_REPORT_MESSAGE} characters)`
	return { reportedUserId, type, message: typeof message === 'string' && message ? message : undefined }
}

// Pure: the reporter's recent report times still in the window, or null when
// another report now would go over the limit.
export function reportTimesAfter(times: number[], now: number): number[] | null {
	const recent = times.filter((t) => now - t < REPORT_WINDOW_MS)
	if (recent.length >= REPORT_LIMIT) return null
	return recent.concat([now])
}

function readTimes(nk: nkruntime.Nakama, userId: string): number[] {
	const objects = nk.storageRead([{ collection: LIMIT_COLLECTION, key: LIMIT_KEY, userId }])
	const times = objects.length > 0 ? objects[0].value.times : null
	return Array.isArray(times) ? times.filter((t) => typeof t === 'number') : []
}

function writeTimes(nk: nkruntime.Nakama, userId: string, times: number[]) {
	nk.storageWrite([
		{
			collection: LIMIT_COLLECTION,
			key: LIMIT_KEY,
			userId,
			value: { times },
			permissionRead: 0,
			permissionWrite: 0,
		},
	])
}

const EVIDENCE_REFUSALS: { [reason: string]: string } = {
	not_in_lobby: 'Not a member of this lobby',
	unknown_player: 'That player is not in this lobby',
	self: 'You cannot report yourself',
}

// {reportedUserId, type, message?} -> {ok, reportId}.
export function rpcReportSubmit(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const report = parseReport(parsePayload(payload))
	if (typeof report === 'string') throw runtimeError(INVALID_ARGUMENT, report)
	const now = Date.now()
	const times = reportTimesAfter(readTimes(nk, userId), now)
	if (!times) throw runtimeError(RESOURCE_EXHAUSTED, 'Too many reports; try again later')

	const lobby = currentLobby(nk, logger, userId)
	if (!lobby) throw runtimeError(NOT_FOUND, 'Not in a lobby')
	const signal: LobbySignal = { type: 'report_evidence', reporterId: userId, reportedId: report.reportedUserId }
	const evidence = JSON.parse(nk.matchSignal(lobby.matchId, JSON.stringify(signal)) || '{}') as
		| ReportEvidence
		| { error: string }
	if ('error' in evidence) throw runtimeError(INVALID_ARGUMENT, EVIDENCE_REFUSALS[evidence.error] || evidence.error)

	const match = nk.matchGet(lobby.matchId)
	const reply = callExpress(nk, logger, ctx.env, '/reports', {
		reporterId: userId,
		reportedId: report.reportedUserId,
		type: report.type,
		message: report.message,
		lobbyId: lobbyIdOf(lobby.matchId),
		lobbyKind: lobbyKindOfLabel(match ? match.label : null),
		lobbyCode: evidence.code,
		runId: evidence.runId,
		chat: evidence.chat,
	})
	if (!reply || reply.status !== 200 || typeof reply.body.reportId !== 'number') {
		logger.warn('Report by %s not filed (HTTP %v)', userId, reply ? reply.status : 'none')
		throw runtimeError(UNAVAILABLE, 'Reports are unavailable right now')
	}
	writeTimes(nk, userId, times)
	logger.info('Report %d filed by %s against %s', reply.body.reportId, userId, report.reportedUserId)
	return JSON.stringify({ ok: true, reportId: reply.body.reportId })
}

