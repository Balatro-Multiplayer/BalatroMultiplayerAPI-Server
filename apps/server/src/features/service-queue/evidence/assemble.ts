// Reads everything an item's detail page shows: the subject card, and the
// evidence for its type (evidence/build.ts shapes it). Every Nakama read is
// best effort -- a missing piece is null, never an error for the page.
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import { db } from '../../../infrastructure/db/index.js'
import {
	chatLogs,
	flaggedMessages,
	forfeitReconciliationFlags,
	launcherIntegrityEvents,
	lobbyRuns,
	matchResultConflicts,
	matchRunLogs,
	matchmakingMatches,
	matchmakingRatings,
	playerBans,
	players,
	reportedLobbyMessages,
	reports,
	serviceQueueItems,
} from '../../../infrastructure/db/schema.js'
import { appealHistory, findPunishmentRef, getAppealById } from '../../../infrastructure/gateways/appeal.gateway.js'
import { loadFlaggedMembers, lobbyConversation } from '../../../infrastructure/gateways/flagged-chat.gateway.js'
import { listWarnings } from '../../../infrastructure/gateways/warning.gateway.js'
import { callNakamaRpc } from '../../../infrastructure/nakama/admin-client.js'
import { type ServiceQueueItemRecord, actorNames } from '../../../infrastructure/gateways/service-queue.gateway.js'
import { numericSourceId, parseAntiCheatSourceId, parseIntegritySourceId } from '../../../shared/service-queue/source-ids.js'
import { guardReadingOf } from '../flagged-chat.js'
import { contextOf } from '../types.js'
import {
	type ChatLine,
	conflictSides,
	explainFlag,
	flagVerdictOf,
	forfeitTimeline,
	handCount,
	markChat,
	reportsAgainstOf,
	reportsFiledOf,
	splitBans,
	withFlags,
} from './build.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

async function playerRows(ids: string[]) {
	const valid = [...new Set(ids.filter((id) => UUID.test(id)))]
	if (valid.length === 0) return new Map<string, typeof players.$inferSelect>()
	const rows = await db.select().from(players).where(inArray(players.id, valid))
	return new Map(rows.map((r) => [r.id, r]))
}

export interface MiniCard {
	id: string
	name: string | null
	nakamaUserId: string | null
}

async function miniCards(ids: string[]): Promise<Map<string, MiniCard>> {
	const rows = await playerRows(ids)
	return new Map(
		ids.map((id) => {
			const row = rows.get(id)
			return [id, { id, name: row?.steamName ?? null, nakamaUserId: row?.nakamaUserId ?? null }]
		}),
	)
}

// Nakama's record of a run: {run, logs}. events adds each player's log events.
async function nakamaRun(runId: string | null, events = false): Promise<NakamaRunView | null> {
	if (!runId) return null
	const result = await callNakamaRpc<NakamaRunView>('admin_run_get', { runId, ...(events ? { events: true } : {}) })
	return result.ok ? result.value : null
}

export interface NakamaRunView {
	run: {
		runId: string
		code: string
		modId: string
		startedAt: number
		endedAt: number
		status: string
		placements: { playerId: string; place: number }[]
		reports: Record<string, { playerId: string; place: number }[]>
		players: { id: string; displayName: string }[]
		gameMode?: string
		rankedMode?: string
		flags?: Record<string, string>
		logChecks?: Record<string, string>
		overturned?: { at: number; previous: { playerId: string; place: number }[] }
		[key: string]: unknown
	}
	logs: Record<string, { eventCount: number; truncated: boolean; carbonHash: string | null; check: string; events?: unknown[] }>
}

async function replayOf(runId: string | null) {
	if (!runId || !UUID.test(runId)) return null
	const [run] = await db.select().from(lobbyRuns).where(eq(lobbyRuns.id, runId)).limit(1)
	if (!run) return null
	const logs = await db
		.select({
			playerId: matchRunLogs.playerId,
			eventCount: matchRunLogs.eventCount,
			status: matchRunLogs.status,
			flagReason: matchRunLogs.flagReason,
			carbonHash: matchRunLogs.carbonHash,
		})
		.from(matchRunLogs)
		.where(eq(matchRunLogs.runId, runId))
	return { runId, lobbyCode: run.lobbyCode, lobbyType: run.lobbyType, status: run.status, logs }
}

// ---------------------------------------------------------------------------
// The subject card
// ---------------------------------------------------------------------------

export async function subjectCard(playerId: string | null, item: ServiceQueueItemRecord, now: Date) {
	if (!playerId) return null
	const isPlayer = UUID.test(playerId)
	const player = isPlayer ? (await playerRows([playerId])).get(playerId) ?? null : null

	const [ratings, bans, warnings, against, filed, otherItems, nakama] = await Promise.all([
		isPlayer ? ratingsOf(playerId) : [],
		isPlayer ? db.select().from(playerBans).where(eq(playerBans.playerId, playerId)).orderBy(desc(playerBans.issuedAt)) : [],
		isPlayer ? listWarnings(playerId) : [],
		db
			.select({ id: reports.id, type: reports.type, status: reports.status, reporterId: reports.reporterId, createdAt: reports.createdAt })
			.from(reports)
			.where(eq(reports.reportedId, playerId)),
		db
			.select({ id: reports.id, resolutionAction: serviceQueueItems.resolutionAction })
			.from(reports)
			.leftJoin(
				serviceQueueItems,
				and(eq(serviceQueueItems.itemType, 'report'), eq(serviceQueueItems.sourceId, sql`${reports.id}::text`)),
			)
			.where(eq(reports.reporterId, playerId)),
		db
			.select({
				id: serviceQueueItems.id,
				itemType: serviceQueueItems.itemType,
				status: serviceQueueItems.status,
				summary: serviceQueueItems.summary,
				priority: serviceQueueItems.priority,
				createdAt: serviceQueueItems.createdAt,
				resolutionAction: serviceQueueItems.resolutionAction,
			})
			.from(serviceQueueItems)
			.where(and(eq(serviceQueueItems.subjectPlayerId, playerId), ne(serviceQueueItems.id, item.id)))
			.orderBy(desc(serviceQueueItems.createdAt))
			.limit(20),
		player?.nakamaUserId ? nakamaPlayer(player.nakamaUserId) : null,
	])

	return {
		player: player
			? {
					id: player.id,
					name: player.steamName,
					nakamaUserId: player.nakamaUserId,
					createdAt: player.createdAt,
					deleted: player.deletedAt !== null,
					privileges: player.privileges,
					chatEnabled: player.chatEnabled,
					chatBlocked: player.chatBlocked,
				}
			: { id: playerId, name: null, nakamaUserId: null, createdAt: null, deleted: false, privileges: [], chatEnabled: false, chatBlocked: false },
		ratings,
		nakama,
		bans: splitBans(bans, now),
		warnings,
		reportsAgainst: reportsAgainstOf(against),
		reportsFiled: reportsFiledOf(filed),
		otherItems: {
			open: otherItems.filter((i) => i.status === 'open'),
			recentResolved: otherItems.filter((i) => i.status !== 'open').slice(0, 10),
		},
	}
}

async function ratingsOf(playerId: string) {
	const rows = await db.select().from(matchmakingRatings).where(eq(matchmakingRatings.playerId, playerId))
	return Promise.all(
		rows.map(async (r) => {
			const [above] = await db
				.select({ n: count() })
				.from(matchmakingRatings)
				.where(
					and(
						eq(matchmakingRatings.modId, r.modId),
						eq(matchmakingRatings.gameMode, r.gameMode),
						eq(matchmakingRatings.season, r.season),
						gt(matchmakingRatings.rating, r.rating),
					),
				)
			return {
				modId: r.modId,
				gameMode: r.gameMode,
				season: r.season,
				rating: r.rating,
				wins: r.wins,
				losses: r.losses,
				gamesPlayed: r.gamesPlayed,
				lastMatchAt: r.lastMatchAt,
				rank: Number(above?.n ?? 0) + 1,
			}
		}),
	)
}

// admin_player_get's moderation view: online, lobby, ranked context, mods,
// standing, integrity, Nakama's bans.
async function nakamaPlayer(nakamaUserId: string) {
	const result = await callNakamaRpc<Record<string, unknown>>('admin_player_get', { userId: nakamaUserId })
	if (!result.ok) return null
	const { online, lobby, ranked, mods, standing, integrity, bans } = result.value
	return { online, lobby, ranked, mods, standing, integrity, bans }
}

// ---------------------------------------------------------------------------
// Per type
// ---------------------------------------------------------------------------

async function reportEvidence(item: ServiceQueueItemRecord) {
	const id = numericSourceId(item.sourceId)
	const [report] = id === null ? [] : await db.select().from(reports).where(eq(reports.id, id)).limit(1)
	if (!report) return null
	const [cards, lines, flagged, related, run, replay] = await Promise.all([
		miniCards([report.reporterId, report.reportedId]),
		db
			.select()
			.from(reportedLobbyMessages)
			.where(eq(reportedLobbyMessages.lobbyId, report.lobbyId))
			.orderBy(asc(reportedLobbyMessages.sentAt))
			.limit(200),
		db
			.select({ playerId: chatLogs.playerId, message: chatLogs.message })
			.from(chatLogs)
			.where(and(eq(chatLogs.lobbyId, report.lobbyId), eq(chatLogs.flagged, true))),
		db
			.select({
				id: reports.id,
				type: reports.type,
				status: reports.status,
				reporterId: reports.reporterId,
				reportedId: reports.reportedId,
				createdAt: reports.createdAt,
			})
			.from(reports)
			.where(
				and(
					ne(reports.id, report.id),
					report.runId
						? or(eq(reports.lobbyId, report.lobbyId), eq(reports.runId, report.runId))
						: eq(reports.lobbyId, report.lobbyId),
				),
			)
			.orderBy(desc(reports.createdAt))
			.limit(20),
		nakamaRun(report.runId),
		replayOf(report.runId),
	])
	const chat: ChatLine[] = withFlags(
		lines.map((l) => ({ playerId: l.playerId, displayName: l.displayName, message: l.message, sentAt: l.sentAt })),
		flagged,
	)
	return {
		report,
		reporter: cards.get(report.reporterId),
		reported: cards.get(report.reportedId),
		chat: markChat(chat, report.reportedId),
		run,
		replay,
		related,
	}
}

// A flagged chat item: the whole lobby conversation, the player's flagged
// messages marked with their bands and guard scores, and the player's other
// flags of the last 30 days.
async function flaggedChatEvidence(item: ServiceQueueItemRecord, now: Date) {
	const members = await loadFlaggedMembers(item)
	const first = members[0]
	if (!first) return null
	const playerId = item.subjectPlayerId ?? first.playerId
	const flaggedByLine = new Map(members.flatMap((m) => (m.line ? [[m.line.id, m.flaggedMessageId] as const] : [])))
	const conversation = await lobbyConversation(members)
	const [otherFlags, mute, names] = await Promise.all([
		db
			.select({ id: flaggedMessages.id, message: flaggedMessages.message, matches: flaggedMessages.matches, flaggedAt: flaggedMessages.flaggedAt })
			.from(flaggedMessages)
			.where(
				and(
					eq(flaggedMessages.playerId, playerId),
					notInArray(flaggedMessages.id, members.map((m) => m.flaggedMessageId)),
					gte(flaggedMessages.flaggedAt, new Date(now.getTime() - 30 * DAY_MS)),
				),
			)
			.orderBy(desc(flaggedMessages.flaggedAt))
			.limit(50),
		UUID.test(playerId)
			? db
					.select({ id: playerBans.id, expiresAt: playerBans.expiresAt, liftedAt: playerBans.liftedAt })
					.from(playerBans)
					.where(and(eq(playerBans.playerId, playerId), eq(playerBans.banType, 'chat')))
			: [],
		miniCards([...new Set(conversation.map((l) => l.playerId))]),
	])
	const lobby = first.line
	return {
		playerId,
		messages: members.map((m) => {
			const guard = guardReadingOf(m.line?.moderationVerdict)
			return {
				id: m.flaggedMessageId,
				message: m.message,
				flaggedAt: m.flaggedAt,
				sentAt: m.line?.sentAt ?? m.flaggedAt,
				verdict: flagVerdictOf(m.matches),
				guardScore: guard.score,
				band: guard.band,
				contextUsed: guard.contextUsed,
			}
		}),
		source: lobby ? { lobbyCode: lobby.lobbyCode, lobbyId: lobby.lobbyId } : null,
		conversation: markChat(
			conversation.map((l) => ({
				playerId: l.playerId,
				displayName: names.get(l.playerId)?.name ?? null,
				message: l.message,
				sentAt: l.sentAt,
				flagged: l.flagged,
				flaggedMessageId: flaggedByLine.get(l.id) ?? null,
			})),
			playerId,
		),
		otherFlags: otherFlags.map((f) => ({ ...f, verdict: flagVerdictOf(f.matches) })),
		alreadyMuted: splitBans(mute, now).active.length > 0,
	}
}

async function matchConflictEvidence(item: ServiceQueueItemRecord) {
	const id = numericSourceId(item.sourceId)
	const [conflict] = id === null ? [] : await db.select().from(matchResultConflicts).where(eq(matchResultConflicts.id, id)).limit(1)
	if (!conflict) return null
	const [match] = await db.select().from(matchmakingMatches).where(eq(matchmakingMatches.matchId, conflict.matchId)).limit(1)
	const [run, replay, others] = await Promise.all([
		nakamaRun(conflict.matchId),
		replayOf(conflict.matchId),
		db
			.select()
			.from(matchResultConflicts)
			.where(and(eq(matchResultConflicts.matchId, conflict.matchId), ne(matchResultConflicts.id, conflict.id))),
	])
	const recorded = match?.resultPlacements ?? null
	const sides = conflictSides(conflict, recorded ?? conflict.firstPlacements)
	const playerIds = [...new Set([...sides.flatMap((s) => [s.playerId, ...s.placements.map((p) => p.playerId)])])]
	const cards = await miniCards(playerIds)
	const perPlayer = await Promise.all(
		playerIds.map(async (playerId) => {
			const card = cards.get(playerId) as MiniCard
			const nakamaId = card.nakamaUserId
			const [forfeits, disputes, ratings] = await Promise.all([
				UUID.test(playerId)
					? db.select({ n: count() }).from(forfeitReconciliationFlags).where(eq(forfeitReconciliationFlags.playerId, playerId))
					: [{ n: 0 }],
				db
					.select({ n: count() })
					.from(matchResultConflicts)
					.where(or(eq(matchResultConflicts.firstReporterId, playerId), eq(matchResultConflicts.conflictingReporterId, playerId))),
				UUID.test(playerId) && match ? db.select().from(matchmakingRatings).where(and(eq(matchmakingRatings.playerId, playerId), eq(matchmakingRatings.modId, match.modId), eq(matchmakingRatings.gameMode, match.gameMode))) : [],
			])
			const log = replay?.logs.find((l) => l.playerId === playerId) ?? null
			return {
				...card,
				logCheck: nakamaId && run ? (run.run.logChecks?.[nakamaId] ?? run.logs[nakamaId]?.check ?? null) : null,
				flag: log?.flagReason ?? (nakamaId && run ? (run.run.flags?.[nakamaId] ?? null) : null),
				ratings: ratings.map((r) => ({ season: r.season, rating: r.rating, gamesPlayed: r.gamesPlayed })),
				forfeitFlags: Number(forfeits[0]?.n ?? 0),
				disputes: Number(disputes[0]?.n ?? 0),
			}
		}),
	)
	return {
		conflict,
		lobbyKind: contextOf(item.context).lobbyKind ?? (match ? (match.gameMode.startsWith('ranked:') ? 'ranked' : 'casual') : 'private'),
		match: match ? { matchId: match.matchId, gameMode: match.gameMode, modId: match.modId, status: match.status, resultReportedAt: match.resultReportedAt } : null,
		recorded,
		sides,
		players: perPlayer,
		run,
		replay,
		otherConflicts: others,
	}
}

// A contested run: who contested whom, the result reported before it, each
// player's log (both replays are in `run` and `replay`), and the history of
// the players with forfeits, disputes and contests.
async function contestEvidence(item: ServiceQueueItemRecord) {
	const { contest, lobbyKind: kind } = contextOf(item.context)
	if (!contest) return null
	const runId = item.sourceId
	const [match] = UUID.test(runId)
		? await db.select().from(matchmakingMatches).where(eq(matchmakingMatches.matchId, runId)).limit(1)
		: []
	const [run, replay] = await Promise.all([nakamaRun(runId), replayOf(runId)])
	const playerIds = [
		...new Set([contest.contesterId, ...(contest.againstId ? [contest.againstId] : []), ...(match ? ((match.players as string[]) ?? []) : [])]),
	]
	const cards = await miniCards(playerIds)
	const players = await Promise.all(
		playerIds.map(async (playerId) => {
			const card = cards.get(playerId) as MiniCard
			const nakamaId = card.nakamaUserId
			const [contests, ratings] = await Promise.all([
				db
					.select({ n: count() })
					.from(serviceQueueItems)
					.where(and(eq(serviceQueueItems.itemType, 'contest'), sql`${serviceQueueItems.context}->'contest'->>'contesterId' = ${playerId}`)),
				UUID.test(playerId) && match
					? db
							.select()
							.from(matchmakingRatings)
							.where(and(eq(matchmakingRatings.playerId, playerId), eq(matchmakingRatings.modId, match.modId), eq(matchmakingRatings.gameMode, match.gameMode)))
					: [],
			])
			const log = replay?.logs.find((l) => l.playerId === playerId) ?? null
			return {
				...card,
				role: playerId === contest.contesterId ? ('contester' as const) : playerId === contest.againstId ? ('subject' as const) : null,
				logCheck: nakamaId && run ? (run.run.logChecks?.[nakamaId] ?? run.logs[nakamaId]?.check ?? null) : null,
				flag: log?.flagReason ?? (nakamaId && run ? (run.run.flags?.[nakamaId] ?? null) : null),
				ratings: ratings.map((r) => ({ season: r.season, rating: r.rating, gamesPlayed: r.gamesPlayed })),
				contestsStarted: Number(contests[0]?.n ?? 0),
			}
		}),
	)
	return {
		contest,
		runId,
		lobbyKind: kind ?? (match ? (match.gameMode.startsWith('ranked:') ? 'ranked' : 'casual') : 'private'),
		match: match
			? { matchId: match.matchId, gameMode: match.gameMode, modId: match.modId, status: match.status, resultReportedAt: match.resultReportedAt }
			: null,
		// What was reported before the contest: what a dismiss rates.
		recorded: match?.resultPlacements ?? null,
		players,
		run,
		replay,
	}
}

async function forfeitEvidence(item: ServiceQueueItemRecord) {
	const id = numericSourceId(item.sourceId)
	const [flag] = id === null ? [] : await db.select().from(forfeitReconciliationFlags).where(eq(forfeitReconciliationFlags.id, id)).limit(1)
	if (!flag) return null
	const [run, replay, history, [match]] = await Promise.all([
		nakamaRun(flag.matchId),
		replayOf(flag.matchId),
		db
			.select()
			.from(forfeitReconciliationFlags)
			.where(and(eq(forfeitReconciliationFlags.playerId, flag.playerId), ne(forfeitReconciliationFlags.id, flag.id)))
			.orderBy(desc(forfeitReconciliationFlags.createdAt))
			.limit(20),
		db.select().from(matchmakingMatches).where(eq(matchmakingMatches.matchId, flag.matchId)).limit(1),
	])
	return {
		flag,
		lobbyKind: contextOf(item.context).lobbyKind ?? (match ? (match.gameMode.startsWith('ranked:') ? 'ranked' : 'casual') : 'private'),
		timeline: forfeitTimeline({
			startedAt: run ? new Date(run.run.startedAt) : (match?.gameStartedAt ?? null),
			forfeitedAt: flag.forfeitedAt,
			reconnectedAt: flag.reconnectedAt,
			endedAt: run ? new Date(run.run.endedAt) : (match?.resultReportedAt ?? null),
		}),
		result: run ? { status: run.run.status, placements: run.run.placements } : match ? { status: match.status, placements: match.resultPlacements } : null,
		match: match ? { matchId: match.matchId, gameMode: match.gameMode, status: match.status } : null,
		run,
		replay,
		history,
	}
}

async function antiCheatEvidence(item: ServiceQueueItemRecord) {
	const parsed = parseAntiCheatSourceId(item.sourceId)
	const runId = parsed?.runId ?? item.sourceId
	const playerId = parsed?.playerId ?? item.subjectPlayerId
	if (!playerId) return null
	const [player] = await Promise.all([playerRows([playerId])])
	const nakamaId = player.get(playerId)?.nakamaUserId ?? null
	const [run, replay, integrityEvents, pastFlags] = await Promise.all([
		nakamaRun(runId, true),
		replayOf(runId),
		UUID.test(playerId)
			? db
					.select()
					.from(launcherIntegrityEvents)
					.where(eq(launcherIntegrityEvents.playerId, playerId))
					.orderBy(desc(launcherIntegrityEvents.occurredAt))
					.limit(20)
			: [],
		db
			.select({ runId: matchRunLogs.runId, flagReason: matchRunLogs.flagReason, finalizedAt: matchRunLogs.finalizedAt })
			.from(matchRunLogs)
			.where(and(eq(matchRunLogs.playerId, playerId), isNotNull(matchRunLogs.flagReason), ne(matchRunLogs.runId, UUID.test(runId) ? runId : '00000000-0000-0000-0000-000000000000')))
			.orderBy(desc(matchRunLogs.finalizedAt))
			.limit(20),
	])
	const log = replay?.logs.find((l) => l.playerId === playerId) ?? null
	const nakamaLog = nakamaId && run ? run.logs[nakamaId] : undefined
	const elapsedMs = run ? run.run.endedAt - run.run.startedAt : 0
	const reason = log?.flagReason ?? (nakamaId && run ? (run.run.flags?.[nakamaId] ?? null) : null)
	// The events are for counting hands only (counted before they're stripped,
	// nakamaLog being one of run.logs); the page reads the replay.
	const hands = handCount(nakamaLog?.events)
	if (run) for (const userId in run.logs) delete run.logs[userId].events
	return {
		runId,
		playerId,
		flag: explainFlag(reason, hands, elapsedMs),
		log: log ?? (nakamaLog ? { eventCount: nakamaLog.eventCount, carbonHash: nakamaLog.carbonHash, status: null, flagReason: reason } : null),
		check: nakamaId && run ? (run.run.logChecks?.[nakamaId] ?? nakamaLog?.check ?? null) : null,
		otherFlaggedPlayers: replay ? replay.logs.filter((l) => l.flagReason && l.playerId !== playerId).map((l) => l.playerId) : [],
		run,
		replay,
		integrityEvents,
		pastFlags,
	}
}

async function integrityEvidence(item: ServiceQueueItemRecord) {
	const parsed = parseIntegritySourceId(item.sourceId)
	const playerId = parsed?.playerId ?? item.subjectPlayerId
	if (!playerId || !UUID.test(playerId)) return null
	const dayStart = parsed ? new Date(`${parsed.day}T00:00:00.000Z`) : null
	const [recent, today, rankedGames] = await Promise.all([
		db
			.select()
			.from(launcherIntegrityEvents)
			.where(eq(launcherIntegrityEvents.playerId, playerId))
			.orderBy(desc(launcherIntegrityEvents.occurredAt))
			.limit(20),
		dayStart
			? db
					.select()
					.from(launcherIntegrityEvents)
					.where(
						and(
							eq(launcherIntegrityEvents.playerId, playerId),
							gte(launcherIntegrityEvents.occurredAt, dayStart),
							lte(launcherIntegrityEvents.occurredAt, new Date(dayStart.getTime() + DAY_MS)),
						),
					)
					.orderBy(asc(launcherIntegrityEvents.occurredAt))
			: [],
		db
			.select({
				matchId: matchmakingMatches.matchId,
				gameMode: matchmakingMatches.gameMode,
				status: matchmakingMatches.status,
				resultReportedAt: matchmakingMatches.resultReportedAt,
				resultPlacements: matchmakingMatches.resultPlacements,
			})
			.from(matchmakingMatches)
			.where(
				and(
					sql`${matchmakingMatches.gameMode} LIKE 'ranked:%'`,
					sql`${matchmakingMatches.players} @> ${JSON.stringify([playerId])}::jsonb`,
				),
			)
			.orderBy(desc(matchmakingMatches.createdAt))
			.limit(5),
	])
	return {
		day: parsed?.day ?? null,
		trigger: contextOf(item.context).integrityTrigger ?? null,
		today,
		recent,
		rankedGames,
	}
}

// An appeal: what the player wrote, the punishment it is about (none for a
// network ban, whose ban ids and networks staff never see here), and the
// appeals they made before for the same target.
async function appealEvidence(item: ServiceQueueItemRecord) {
	const appeal = await getAppealById(item.sourceId)
	if (!appeal) return null
	const punishment = appeal.punishmentId ? await findPunishmentRef(appeal.punishmentId) : null
	const earlier = (await appealHistory(appeal.playerId, appeal.punishmentId)).filter((a) => a.id !== appeal.id)
	const names = punishment ? await actorNames([punishment.issuedBy]) : {}
	return {
		appeal: {
			id: appeal.id,
			message: appeal.message,
			status: appeal.status,
			createdAt: appeal.createdAt,
			decisionReason: appeal.decisionReason,
			decidedAt: appeal.decidedAt,
			outcome: appeal.outcome,
		},
		target: appeal.targetKind,
		punishment: punishment
			? {
					id: punishment.id,
					type: punishment.banType ?? 'warning',
					reason: punishment.reason,
					issuedBy: punishment.issuedBy,
					issuedByName: names[punishment.issuedBy] ?? null,
					expiresAt: punishment.expiresAt,
					liftedAt: punishment.liftedAt,
				}
			: null,
		earlier: earlier.map((a) => ({
			status: a.status,
			message: a.message,
			decisionReason: a.decisionReason,
			createdAt: a.createdAt,
			decidedAt: a.decidedAt,
		})),
	}
}

export async function evidenceOf(item: ServiceQueueItemRecord, now: Date): Promise<unknown> {
	switch (item.itemType) {
		case 'report':
			return reportEvidence(item)
		case 'flagged_chat':
			return flaggedChatEvidence(item, now)
		case 'match_conflict':
			return matchConflictEvidence(item)
		case 'forfeit_reconciliation':
			return forfeitEvidence(item)
		case 'contest':
			return contestEvidence(item)
		case 'anti_cheat':
			return antiCheatEvidence(item)
		case 'integrity':
			return integrityEvidence(item)
		case 'appeal':
			return appealEvidence(item)
		default:
			return null
	}
}

// The player the subject card is about: the item's subject, or for a
// conflict (no subject) none -- its evidence carries both reporters.
export function subjectOf(item: ServiceQueueItemRecord): string | null {
	return item.subjectPlayerId
}
