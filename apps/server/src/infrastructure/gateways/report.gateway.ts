import { and, eq, isNull, max } from 'drizzle-orm'
import type { ReportType } from '../../shared/types/index.js'
import { EVIDENCE_KEEP_MS } from '../../shared/retention-periods.js'
import type { ItemContext } from '../../features/service-queue/types.js'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { reportedLobbyMessages, reports } from '../db/schema.js'
import { enqueueServiceQueueItem } from './service-queue.gateway.js'

export type { ReportType } from '../../shared/types/index.js'

export const REPORT_TYPES: readonly ReportType[] = [
	'cheating',
	'chat_abuse',
	'griefing',
	'inappropriate_username',
	'other',
]

export function isReportType(value: unknown): value is ReportType {
	return typeof value === 'string' && REPORT_TYPES.includes(value as ReportType)
}

export interface ReportedChatLine {
	playerId: string
	displayName: string
	message: string
	sentAt: Date
}

export interface NewReport {
	lobbyId: string
	lobbyCode: string
	reporterId: string
	reportedId: string
	type: ReportType
	runId: string | null
	message: string | undefined
	chat: ReportedChatLine[]
	// What kind of lobby it was filed in, for the queue's priority.
	context?: ItemContext
}

/**
 * A report filed in a Nakama lobby (features/nakama). The lobby sends its
 * whole chat tail with every report, so only lines newer than those already
 * kept for the lobby are stored.
 */
export async function submitNakamaReport(report: NewReport): Promise<number> {
	const [kept] = await db
		.select({ latest: max(reportedLobbyMessages.sentAt) })
		.from(reportedLobbyMessages)
		.where(eq(reportedLobbyMessages.lobbyId, report.lobbyId))
	const latest = kept?.latest ?? null
	const chat = latest
		? report.chat.filter((line) => line.sentAt > latest)
		: report.chat
	return recordReport({ ...report, chat })
}

async function recordReport(report: NewReport): Promise<number> {
	const [row] = await db
		.insert(reports)
		.values({
			lobbyId: report.lobbyId,
			lobbyCode: report.lobbyCode,
			reporterId: report.reporterId,
			reportedId: report.reportedId,
			type: report.type,
			runId: report.runId,
			message: report.message,
		})
		.returning({ id: reports.id })

	if (report.chat.length > 0) {
		const expiresAt = new Date(Date.now() + EVIDENCE_KEEP_MS)
		await db.insert(reportedLobbyMessages).values(
			report.chat.map((entry) => ({
				lobbyId: report.lobbyId,
				lobbyCode: report.lobbyCode,
				playerId: entry.playerId,
				displayName: entry.displayName,
				message: entry.message,
				sentAt: entry.sentAt,
				expiresAt,
			})),
		)
	}

	await enqueueServiceQueueItem({
		itemType: 'report',
		sourceId: String(row!.id),
		subjectPlayerId: report.reportedId,
		summary: `${report.type} report — lobby ${report.lobbyCode}`,
		context: report.context ?? {},
	})

	return row!.id
}

export type ReportRecord = typeof reports.$inferSelect

/** Looks up a single report by id, or null if it doesn't exist. */
export async function getReportById(id: number): Promise<ReportRecord | null> {
	const [row] = await db
		.select()
		.from(reports)
		.where(eq(reports.id, id))
		.limit(1)
	return row ?? null
}

/** Sets (upsert-style, last-write-wins) the submitter's follow-up detail text. */
export async function setAdditionalDetail(
	id: number,
	additionalDetail: string,
): Promise<ReportRecord | null> {
	const [row] = await db
		.update(reports)
		.set({ additionalDetail })
		.where(eq(reports.id, id))
		.returning()
	return row ?? null
}

// The service queue's write (inside its transaction): the report follows its
// queue item (reopen sets it open again).
export async function setReportStatus(
	exec: DbExecutor,
	id: number,
	status: 'open' | 'resolved',
): Promise<ReportRecord | null> {
	const [row] = await exec.update(reports).set({ status }).where(eq(reports.id, id)).returning()
	return row ?? null
}

// True for the one call that took the report's reporter-told mark, so the
// reporter hears of staff action once however often the item is reopened.
export async function markReporterTold(id: number, now: Date): Promise<boolean> {
	const rows = await db
		.update(reports)
		.set({ reporterToldAt: now })
		.where(and(eq(reports.id, id), isNull(reports.reporterToldAt)))
		.returning({ id: reports.id })
	return rows.length > 0
}

// Gives the mark back when the Notification could not be sent.
export async function clearReporterTold(id: number): Promise<void> {
	await db.update(reports).set({ reporterToldAt: null }).where(eq(reports.id, id))
}

// True for the one call that opened the report's one-time page.
export async function markReportPageOpened(id: number, now: Date): Promise<boolean> {
	const rows = await db
		.update(reports)
		.set({ pageOpenedAt: now })
		.where(and(eq(reports.id, id), isNull(reports.pageOpenedAt)))
		.returning({ id: reports.id })
	return rows.length > 0
}

// The service queue's write when the reporter withdraws (inside its
// transaction); false when the report was already withdrawn.
export async function markReportWithdrawn(exec: DbExecutor, id: number, now: Date): Promise<boolean> {
	const rows = await exec
		.update(reports)
		.set({ withdrawnAt: now, status: 'resolved' })
		.where(and(eq(reports.id, id), isNull(reports.withdrawnAt)))
		.returning({ id: reports.id })
	return rows.length > 0
}
