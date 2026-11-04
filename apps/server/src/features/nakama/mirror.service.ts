import { randomUUID } from 'node:crypto'
import { seasonBestColumns } from '../ratings/season-best.js'
import { raisesAntiCheatItem } from '../service-queue/automatic-rules.js'
import { compressToBase64 } from '../../shared/utils/compression.js'
import { DELETED_PLAYER_ID, DELETED_PLAYER_NAME } from '../../shared/deleted-player.js'
import { CHAT_KEEP_MS, EVIDENCE_KEEP_MS } from '../../shared/retention-periods.js'

// The Nakama -> Postgres mirror (nakama/src/mirror/outbox.ts): Nakama keeps
// an outbox of finished runs, chat lines, forfeits and Notice acceptances,
// and this pulls it, stores each
// entry in the tables the website, webadmin and service queue already read,
// and acks what it stored. Every write is idempotent (keyed by the run id or
// the outbox key), so an entry pulled twice is stored once.

// ---------------------------------------------------------------------------
// What admin_mirror_pull returns
// ---------------------------------------------------------------------------

export type LogCheck = 'match' | 'mismatch' | 'unavailable'
// What kind of game an entry came from (nakama review/ranked.ts LobbyKind).
export type GameKind = 'ranked' | 'casual' | 'private'
export type FlagReason = 'hash_mismatch' | 'elapsed_time_gate' | 'unverified_log'

export interface NakamaRun {
	runId: string
	code: string
	modId: string
	startedAt: number
	endedAt: number
	status: 'agreed' | 'partial' | 'disputed' | 'abandoned' | 'restarted' | 'contested'
	placements: {
		playerId: string
		place: number
		performance?: number
		metric?: number
		metricText?: string
	}[]
	reports: { [userId: string]: { playerId: string; place: number }[] }
	reportOrder?: string[]
	players: { id: string; displayName: string }[]
	rankedMode?: string
	gameMode?: string
	lobbyType?: 'public' | 'private'
	logChecks?: { [userId: string]: LogCheck }
	flags?: { [userId: string]: FlagReason }
	// A ranked run's rating result per player Nakama rated ({} when it rated
	// nobody: a disputed result).
	ratings?: { [userId: string]: unknown }
	// A contested run: who contested whom (Nakama user ids), and when.
	contest?: { by: string; against: string; at: number }
}

export interface NakamaLog {
	// The exact lines the server hashed; a log stored earlier has parsed events.
	lines?: string[]
	events?: unknown[]
	eventCount: number
	truncated: boolean
	carbonHash: string | null
	check: LogCheck
}

export interface NakamaRating {
	rating: number
	wins: number
	losses: number
	gamesPlayed: number
	seasonBest: number | string | null
	lastMatchAt: number
}

export interface PulledRun {
	key: string
	kind: 'run'
	at: number
	run: NakamaRun
	logs: { [userId: string]: NakamaLog }
	rating: { modId: string; mode: string; season: number } | null
	ratings: { [userId: string]: NakamaRating }
}

export interface PulledChat {
	key: string
	kind: 'chat'
	at: number
	line: {
		lobbyCode: string
		// The lobby instance (codes are reused) and its kind; absent on lines
		// logged before the service queue redesign.
		lobbyId?: string
		lobbyKind?: GameKind | null
		userId: string
		message: string
		flagged: boolean
		verdict: unknown
	}
}

// A player back right after timing out of a matchmade game.
export interface PulledForfeit {
	key: string
	kind: 'forfeit'
	at: number
	userId: string
	runId: string
	code: string
	forfeitedAt: number
	lobbyKind?: GameKind
}

// A player accepted a Notice version (nakama player/session.ts tos_accept).
export interface PulledNotice {
	key: string
	kind: 'notice'
	at: number
	userId: string
	version: number
}

export type PulledEntry = PulledRun | PulledChat | PulledForfeit | PulledNotice

export interface MirrorPlayer {
	steamIdHash: string | null
	legacyPlayerId: string | null
	displayName: string
	// The Nakama account no longer exists (deleted). Absent from older bundles.
	deleted?: boolean
}

export interface MirrorPull {
	entries: PulledEntry[]
	players: { [userId: string]: MirrorPlayer }
}

// ---------------------------------------------------------------------------
// The rows an entry becomes (pure)
// ---------------------------------------------------------------------------

// expiresAt is the earliest a row may go (retention/limits.ts). A run's logs
// and a flagged line are evidence: the sweep keeps them past it while a report
// or ban that uses them is open, then 180 days. Normal chat goes at 90 days.

export interface RunRows {
	lobbyKind: GameKind
	lobbyRun: {
		id: string
		lobbyCode: string
		modId: string
		lobbyType: 'public' | 'private'
		matchmakingMatchId: string | null
		status: 'completed' | 'abandoned' | 'terminated'
		startedAt: Date
		finalizedAt: Date
	}
	logs: {
		runId: string
		playerId: string
		compressedEvents: string
		carbonHash: string | null
		eventCount: number
		status: 'complete' | 'partial'
		flagReason: FlagReason | null
		finalizedAt: Date
		expiresAt: Date
	}[]
	// Only for a matchmade game (the API's matchmaking_matches).
	match: {
		matchId: string
		lobbyCode: string
		modId: string
		gameMode: string
		players: string[]
		lobbyState: { playerInfos: { [playerId: string]: { displayName: string } } }
		status: 'resolved'
		gameStartedAt: Date
		// rated: whether Nakama rated that player for this game (ranked runs
		// only), so a void's Elo replay rates exactly the same games.
		resultPlacements: { playerId: string; place: number; rated?: boolean }[]
		resultReportedBy: string
		resultReportedAt: Date
		createdAt: Date
	} | null
	ratings: {
		playerId: string
		modId: string
		gameMode: string
		season: number
		rating: number
		wins: number
		losses: number
		gamesPlayed: number
		seasonBest: number | null
		seasonBestLen: number | null
		seasonBestRev: number[] | null
		seasonBestText: string | null
		lastMatchAt: Date | null
	}[]
	// Flagged players: an anti_cheat service-queue item.
	flagged: { playerId: string; reason: FlagReason }[]
	// False when every player of the match is flagged: no item is made.
	raiseAntiCheatItems: boolean
	// A disputed game (matchmade or private): each report that differs from the result,
	// against the first report that agrees with it (match_result_conflicts).
	conflicts: {
		matchId: string
		lobbyCode: string
		firstReporterId: string
		firstPlacements: { playerId: string; place: number }[]
		conflictingReporterId: string
		conflictingPlacements: { playerId: string; place: number }[]
	}[]
	// A contested run: a contest service-queue item (Nakama review's hold).
	contest: { contesterId: string; againstId: string } | null
}

export function rankedGameModeOf(mode: string): string {
	return mode.startsWith('ranked:') ? mode : 'ranked:' + mode
}

// The events JSON, joined from the exact lines so it keeps the client's key
// order and number text.
function eventsJsonOf(log: NakamaLog | undefined): string {
	if (!log) return '[]'
	return log.lines ? `[${log.lines.join(',')}]` : JSON.stringify(log.events ?? [])
}

function placesKey(placements: { playerId: string; place: number }[]): string {
	return JSON.stringify(
		placements
			.map((p) => [p.playerId, p.place] as const)
			.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
	)
}

export function gameKindOfRun(run: Pick<NakamaRun, 'rankedMode' | 'gameMode'>): GameKind {
	if (run.rankedMode || (run.gameMode && run.gameMode.startsWith('ranked:'))) return 'ranked'
	return run.gameMode ? 'casual' : 'private'
}

// A disputed game, matchmade or private: each report that differs from the
// result, against the first report that agrees with it.
function conflictsOf(
	run: NakamaRun,
	ids: Map<string, string>,
): RunRows['conflicts'] {
	if (run.status !== 'disputed') return []
	const order = (run.reportOrder ?? Object.keys(run.reports)).filter(
		(id) => run.reports[id] && ids.has(id),
	)
	const result = placesKey(run.placements)
	const first = order.find((id) => placesKey(run.reports[id]) === result)
	if (!first) return []
	const inPg = (placements: { playerId: string; place: number }[]) =>
		placements
			.filter((p) => ids.has(p.playerId))
			.map((p) => ({ playerId: ids.get(p.playerId) as string, place: p.place }))
	return order
		.filter((id) => placesKey(run.reports[id]) !== result)
		.map((id) => ({
			matchId: run.runId,
			lobbyCode: run.code,
			firstReporterId: ids.get(first) as string,
			firstPlacements: inPg(run.reports[first]),
			conflictingReporterId: ids.get(id) as string,
			conflictingPlacements: inPg(run.reports[id]),
		}))
}

export interface ForfeitRow {
	matchId: string
	lobbyCode: string
	playerId: string
	forfeitedAt: Date
	reconnectedAt: Date
}

export function forfeitRowOf(
	entry: PulledForfeit,
	playerId: string,
): ForfeitRow {
	return {
		matchId: entry.runId,
		lobbyCode: entry.code,
		playerId,
		forfeitedAt: new Date(entry.forfeitedAt),
		reconnectedAt: new Date(entry.at),
	}
}

function runStatusOf(
	status: NakamaRun['status'],
): RunRows['lobbyRun']['status'] {
	if (status === 'abandoned') return 'abandoned'
	if (status === 'restarted') return 'terminated'
	return 'completed'
}

// A flagged agreed or partial game with two or more players is rated by the
// live code and by the Season replay. A run stored before that has no rating
// for it, so a late pull must not mark its players unrated again.
function ratedDespiteFlag(run: PulledRun['run'], hasFlag: boolean): boolean {
	return (
		hasFlag &&
		(run.status === 'agreed' || run.status === 'partial') &&
		run.placements.length >= 2
	)
}

function logCheckOf(run: PulledRun['run'], userId: string, log: NakamaLog | undefined) {
	return (run.logChecks && run.logChecks[userId]) || (log ? log.check : 'unavailable')
}

// Runs stored before flags existed have only their log checks.
function flagReasonOf(run: PulledRun['run'], userId: string, log: NakamaLog | undefined): FlagReason | null {
	if (run.flags) return run.flags[userId] || null
	return logCheckOf(run, userId, log) === 'mismatch' ? 'hash_mismatch' : null
}

// ids maps every Nakama user in the run to their player id.
export function runRowsOf(entry: PulledRun, ids: Map<string, string>): RunRows {
	const { run } = entry
	const finalizedAt = new Date(run.endedAt)
	const pg = (userId: string) => ids.get(userId) as string
	const seated = run.players.filter((p) => ids.has(p.id))

	const logs: RunRows['logs'] = []
	const flagged: RunRows['flagged'] = []
	for (const player of seated) {
		const log = entry.logs[player.id]
		const check = logCheckOf(run, player.id, log)
		const flagReason = flagReasonOf(run, player.id, log)
		if (flagReason)
			flagged.push({ playerId: pg(player.id), reason: flagReason })
		logs.push({
			runId: run.runId,
			playerId: pg(player.id),
			compressedEvents: compressToBase64(eventsJsonOf(log)),
			carbonHash: log ? log.carbonHash : null,
			eventCount: log ? log.eventCount : 0,
			status: check === 'unavailable' ? 'partial' : 'complete',
			flagReason,
			finalizedAt,
			expiresAt: new Date(run.endedAt + EVIDENCE_KEEP_MS),
		})
	}

	const match: RunRows['match'] = run.gameMode
		? {
				matchId: run.runId,
				lobbyCode: run.code,
				modId: run.modId,
				gameMode: run.gameMode,
				players: seated.map((p) => pg(p.id)),
				lobbyState: {
					playerInfos: Object.fromEntries(
						seated.map((p) => [pg(p.id), { displayName: p.displayName }]),
					),
				},
				status: 'resolved',
				gameStartedAt: new Date(run.startedAt),
				resultPlacements: run.placements
					.filter((p) => ids.has(p.playerId))
					.map((p) =>
						run.rankedMode && run.ratings
							? {
									playerId: pg(p.playerId),
									place: p.place,
									rated:
										p.playerId in run.ratings ||
										ratedDespiteFlag(run, flagged.length > 0),
								}
							: { playerId: pg(p.playerId), place: p.place },
					),
				resultReportedBy: 'nakama',
				resultReportedAt: finalizedAt,
				createdAt: new Date(run.startedAt),
			}
		: null

	const ratings: RunRows['ratings'] = []
	if (entry.rating) {
		for (const userId in entry.ratings) {
			if (!ids.has(userId)) continue
			const r = entry.ratings[userId]
			ratings.push({
				playerId: pg(userId),
				modId: entry.rating.modId,
				// Nakama keys boards by the bare mode; Postgres and the website by
				// the queue's game mode.
				gameMode: rankedGameModeOf(entry.rating.mode),
				season: entry.rating.season,
				rating: Math.round(r.rating),
				wins: r.wins,
				losses: r.losses,
				gamesPlayed: r.gamesPlayed,
				...seasonBestColumns(entry.rating.modId, r.seasonBest),
				lastMatchAt: r.lastMatchAt ? new Date(r.lastMatchAt) : null,
			})
		}
	}

	return {
		lobbyKind: gameKindOfRun(run),
		conflicts: conflictsOf(run, ids),
		contest:
			run.contest && ids.has(run.contest.by) && ids.has(run.contest.against)
				? { contesterId: pg(run.contest.by), againstId: pg(run.contest.against) }
				: null,
		lobbyRun: {
			id: run.runId,
			lobbyCode: run.code,
			modId: run.modId,
			lobbyType:
				run.lobbyType ??
				(run.gameMode || run.rankedMode ? 'public' : 'private'),
			matchmakingMatchId: match ? match.matchId : null,
			status: runStatusOf(run.status),
			startedAt: new Date(run.startedAt),
			finalizedAt,
		},
		logs,
		match,
		ratings,
		flagged,
		raiseAntiCheatItems: raisesAntiCheatItem({
			playerCount: run.players.length,
			flaggedCount: run.players.filter((p) => flagReasonOf(run, p.id, entry.logs[p.id])).length,
		}),
	}
}

export interface ChatRows {
	chat: {
		lobbyCode: string
		playerId: string
		moderationId: string | null
		message: string
		flagged: boolean
		moderationVerdict: unknown
		sentAt: Date
		expiresAt: Date
		mirrorKey: string
		lobbyId: string | null
	}
	lobbyKind: GameKind | null
	// For a flagged line: the flagged_messages row (and a service-queue item).
	flaggedMessage: {
		playerId: string
		message: string
		matches: unknown
		expiresAt: Date
		mirrorKey: string
	} | null
}

// The verdict the moderation service gave, as flagged_messages records a
// remote flag ({source, band}).
// flagged_messages.matches as the API's own filters wrote it: the local word
// filter's matches, or the remote service's band.
function flagMatchesOf(verdict: unknown): unknown {
	const record =
		typeof verdict === 'object' && verdict !== null
			? (verdict as { [key: string]: unknown })
			: {}
	if (record.source === 'local' && Array.isArray(record.matches))
		return record.matches
	return {
		source: 'remote',
		band: typeof record.band === 'string' ? record.band : 'unknown',
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function chatRowsOf(
	entry: PulledChat,
	playerId: string,
	steamIdHash: string | null,
): ChatRows {
	const { line } = entry
	const sentAt = new Date(entry.at)
	return {
		chat: {
			lobbyCode: line.lobbyCode,
			playerId,
			moderationId: steamIdHash,
			message: line.message,
			flagged: line.flagged,
			moderationVerdict: line.verdict ?? null,
			sentAt,
			expiresAt: new Date(entry.at + (line.flagged ? EVIDENCE_KEEP_MS : CHAT_KEEP_MS)),
			mirrorKey: entry.key,
			lobbyId: line.lobbyId && UUID.test(line.lobbyId) ? line.lobbyId : null,
		},
		lobbyKind: line.lobbyKind ?? null,
		flaggedMessage: line.flagged
			? {
					playerId,
					message: line.message,
					matches: flagMatchesOf(line.verdict),
					expiresAt: new Date(entry.at + EVIDENCE_KEEP_MS),
					mirrorKey: entry.key,
				}
			: null,
	}
}

// ---------------------------------------------------------------------------
// Storing (effects injected)
// ---------------------------------------------------------------------------

export interface NoticeAcceptanceRow {
	playerId: string
	version: number
	acceptedAt: Date
}

export interface MirrorDeps {
	players: {
		findPlayerIdsByNakamaUserIds(
			nakamaUserIds: string[],
		): Promise<Map<string, string>>
		findPlayerById(id: string): Promise<{ id: string } | null>
		findPlayerBySteamIdHash(hash: string): Promise<{ id: string } | null>
		linkNakamaUser(playerId: string, nakamaUserId: string): Promise<void>
		createPlayer(data: {
			id: string
			steamName: string
			steamIdHash?: string
			nakamaUserId?: string
			deleted?: boolean
		}): Promise<{ id: string }>
	}
	store: {
		storeRun(rows: RunRows): Promise<void>
		storeChat(rows: ChatRows): Promise<void>
		storeForfeit(row: ForfeitRow, lobbyKind: GameKind | null): Promise<void>
		storeNoticeAcceptance(row: NoticeAcceptanceRow): Promise<void>
	}
}

export type MirrorService = ReturnType<typeof createMirrorService>

export function createMirrorService(deps: MirrorDeps) {
	const { players, store } = deps

	// Nakama user id -> player id for everyone in the pull. A Nakama user
	// without a linked row (their first-login sync failed, or a dev device
	// login) gets one: the row their profile names, else found by Steam id hash,
	// else created. A deleted account gets a deleted row that does not keep
	// its Nakama id: deletion (player/anonymize.ts) already rewrote what it
	// could, and an entry written after it must not link back to the account.
	// The standard deleted-player id is the same in both: it maps to itself.
	async function resolvePlayers(
		pulled: MirrorPull,
	): Promise<Map<string, string>> {
		const userIds = Object.keys(pulled.players)
		const ids = await players.findPlayerIdsByNakamaUserIds(userIds)
		for (const userId of userIds) {
			if (userId === DELETED_PLAYER_ID) ids.set(userId, DELETED_PLAYER_ID)
			if (ids.has(userId)) continue
			const info = pulled.players[userId]
			if (info.deleted) {
				const created = await players.createPlayer({
					id: randomUUID(),
					steamName: DELETED_PLAYER_NAME,
					deleted: true,
				})
				ids.set(userId, created.id)
				continue
			}
			const existing =
				(info.legacyPlayerId
					? await players.findPlayerById(info.legacyPlayerId)
					: null) ??
				(info.steamIdHash
					? await players.findPlayerBySteamIdHash(info.steamIdHash)
					: null)
			if (existing) {
				await players.linkNakamaUser(existing.id, userId)
				ids.set(userId, existing.id)
				continue
			}
			const created = await players.createPlayer({
				id: randomUUID(),
				steamName: (info.displayName || 'Player').slice(0, 64),
				steamIdHash: info.steamIdHash ?? undefined,
				nakamaUserId: userId,
			})
			ids.set(userId, created.id)
		}
		return ids
	}

	// Stores every entry it can; returns the keys stored (to ack). An entry
	// that fails stays in the outbox for the next pull.
	async function storePull(
		pulled: MirrorPull,
	): Promise<{ stored: string[]; failed: string[] }> {
		const stored: string[] = []
		const failed: string[] = []
		if (pulled.entries.length === 0) return { stored, failed }
		const ids = await resolvePlayers(pulled)
		for (const entry of pulled.entries) {
			try {
				if (entry.kind === 'run') {
					await store.storeRun(runRowsOf(entry, ids))
				} else if (entry.kind === 'forfeit') {
					const playerId = ids.get(entry.userId)
					if (playerId) await store.storeForfeit(forfeitRowOf(entry, playerId), entry.lobbyKind ?? null)
				} else if (entry.kind === 'notice') {
					const playerId = ids.get(entry.userId)
					if (playerId)
						await store.storeNoticeAcceptance({
							playerId,
							version: entry.version,
							acceptedAt: new Date(entry.at),
						})
				} else {
					const playerId = ids.get(entry.line.userId)
					if (playerId) {
						const steamIdHash = pulled.players[entry.line.userId]?.steamIdHash ?? null
						await store.storeChat(chatRowsOf(entry, playerId, steamIdHash))
					}
				}
				stored.push(entry.key)
			} catch (err) {
				console.error(
					`[mirror] Could not store ${entry.kind} ${entry.key}:`,
					err,
				)
				failed.push(entry.key)
			}
		}
		return { stored, failed }
	}

	return { resolvePlayers, storePull }
}
