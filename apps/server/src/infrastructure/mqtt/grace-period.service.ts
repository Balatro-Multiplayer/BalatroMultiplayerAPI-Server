import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { syncMatchLobbyState } from '../../features/matchmaking/matchmaking.service.js'
import { replayLogService } from '../../features/replay-log/replay-log.service.js'
import {
	getLobby,
	getSession,
	lobbies,
	removeSession,
} from '../../state/index.js'
import { matchByLobby } from '../../state/matchmaking.js'
import { db } from '../db/index.js'
import { matchmakingMatches } from '../db/schema.js'
import {
	hasOpenForfeitReconciliationFlag,
	insertForfeitReconciliationFlag,
} from '../gateways/forfeit-reconciliation.gateway.js'
import {
	deleteGracePeriod,
	insertGracePeriod,
	loadAllGracePeriods,
} from '../gateways/grace-period.gateway.js'
import { mqttService } from './mqtt.service.js'

const GRACE_PERIOD_MS = 2 * 60 * 1000 // 2 minutes

// Boot-time restore never fires an already-elapsed grace period inline --
// lobby.players is still empty at that point (restorePlayerMatchSession only
// repopulates it once a kicked client actually reconnects, see
// reconnect-recovery.service.ts), so expireGracePeriod's "who's still
// around" check would see everyone as gone and misscore every affected match
// as a draw. This floor gives the fast reconnect flow a real window to land
// first, so only genuinely-still-disconnected players actually expire.
const MIN_REARM_BUFFER_MS = 10 * 1000

// How long after a system auto-forfeit a reconnect still counts as "plausibly
// the race that caused it" -- chosen well inside GRACE_PERIOD_MS, since the
// KVV3A incident this is modeled on had the reconnect land essentially
// instantly. A generous window mostly just means a few more flags for a
// moderator to look at and dismiss, not a wrong automatic action (see
// forfeitReconciliationFlags -- this only ever flags, never mutates ratings).
const RECONCILIATION_WINDOW_MS = 60 * 1000

interface GracePeriodEntry {
	playerId: string
	lobbyCode: string
	displayName: string
	disconnectedAt: Date
	timer: ReturnType<typeof setTimeout>
}

const gracePeriods = new Map<string, GracePeriodEntry>()

export async function startGracePeriod(playerId: string): Promise<void> {
	const session = getSession(playerId)
	if (!session || !session.lobbyCode) return

	if (gracePeriods.has(playerId)) return

	const lobby = getLobby(session.lobbyCode)
	if (!lobby) return

	// If player is host and lobby has other non-away players, transfer host immediately
	if (lobby.hostId === playerId) {
		const newHostId = findNextHost(lobby, playerId)
		if (newHostId) {
			lobby.hostId = newHostId
			await mqttService.publishEvent(lobby.code, {
				type: 'host_changed',
				lobbyCode: lobby.code,
				playerId: newHostId,
				timestamp: new Date().toISOString(),
			})
			if (lobby.type === 'public') {
				await syncMatchLobbyState(lobby.code)
			}
		}
	}

	const timer = setTimeout(() => {
		expireGracePeriod(playerId)
	}, GRACE_PERIOD_MS)
	timer.unref()

	const disconnectedAt = new Date()
	gracePeriods.set(playerId, {
		playerId,
		lobbyCode: session.lobbyCode,
		displayName: session.getDisplayName(),
		disconnectedAt,
		timer,
	})

	await insertGracePeriod({
		playerId,
		lobbyCode: session.lobbyCode,
		displayName: session.getDisplayName(),
		disconnectedAt,
		expiresAt: new Date(disconnectedAt.getTime() + GRACE_PERIOD_MS),
	})

	console.log(
		`[grace-period] started: player=${playerId} lobby=${session.lobbyCode} durationMs=${GRACE_PERIOD_MS}`,
	)

	await mqttService.publishEvent(session.lobbyCode, {
		type: 'player_disconnected',
		lobbyCode: session.lobbyCode,
		playerId,
		displayName: session.getDisplayName(),
		timestamp: new Date().toISOString(),
	})

	// §7.8: if this disconnect leaves no still-connected player in the lobby
	// (every remaining member is now away), tear it down right now instead of
	// making each of them separately wait out their own 2-minute timer first.
	// expireGracePeriod already does the real teardown (remove player, ranked
	// auto-forfeit, cleanup, lobby_closed + finalizeRun) and itself closes the
	// lobby once the last player is removed, so calling it directly for every
	// currently-away member is sufficient -- no separate teardown path needed.
	const allAway = lobby.players.size > 0 && [...lobby.players.keys()].every((id) => gracePeriods.has(id))
	if (allAway) {
		for (const id of [...lobby.players.keys()]) {
			const awayEntry = gracePeriods.get(id)
			if (awayEntry) clearTimeout(awayEntry.timer)
			await expireGracePeriod(id)
		}
	}
}

// Clears the timer/map entry only -- no MQTT publish. Safe to call the
// instant a raw MQTT `client.connected` webhook fires (see emqx.route.ts's
// handleClientConnected), before the reconnecting client has necessarily
// finished subscribing to player/{id}/# -- unlike notifyReconnected below,
// this has no non-retained-publish race to worry about. Returns the cleared
// entry (or undefined if the player wasn't in a grace period at all) so the
// caller can defer notifyReconnected until it's safe to do so.
export function cancelGracePeriodImmediate(playerId: string): GracePeriodEntry | undefined {
	const entry = gracePeriods.get(playerId)
	if (!entry) return undefined

	clearTimeout(entry.timer)
	gracePeriods.delete(playerId)
	// Fire-and-forget: a stray leftover row is self-healing on the next
	// restore pass (autoForfeitMatch already no-ops once the match itself is
	// gone, see matchmaking.service.ts), not worth blocking this sync path on.
	void deleteGracePeriod(playerId)

	console.log(`[grace-period] cancelled: player=${playerId} lobby=${entry.lobbyCode}`)

	return entry
}

// The publish half of a reconnect: broadcasts player_reconnected to the
// lobby and pushes the reconnecting player's replay-tail catch-up (§22.5).
// pushReplayCatchUp's publishToPlayer is a non-retained publish -- callers
// reached from a raw MQTT client.connected event must delay this until the
// client's own post-CONNECT subscribe to player/{id}/# has had time to land
// (see emqx.route.ts's LOGIN_CHALLENGE_DELAY_MS, used for the exact same
// reason for the launcher-integrity challenge push).
export async function notifyReconnected(entry: GracePeriodEntry): Promise<void> {
	await mqttService.publishEvent(entry.lobbyCode, {
		type: 'player_reconnected',
		lobbyCode: entry.lobbyCode,
		playerId: entry.playerId,
		displayName: entry.displayName,
		timestamp: new Date().toISOString(),
	})

	await pushReplayCatchUp(entry.lobbyCode, entry.playerId)
}

export async function cancelGracePeriod(playerId: string): Promise<boolean> {
	const entry = cancelGracePeriodImmediate(playerId)
	if (!entry) return false

	await notifyReconnected(entry)

	return true
}

// §22.5: the reconnecting client catches up over MQTT -- the same channel
// every other action already flows through -- instead of pulling a REST
// endpoint itself. The server already knows the instant a player reconnects
// (right here), so it pushes each other player's buffered tail directly
// rather than waiting for the client to ask. MQTT doesn't backlog
// non-retained messages, so this still has to read from the same live
// in-memory run buffer replay/anti-cheat already use, not a retained topic --
// only the transport (push vs. a REST pull) changes.
async function pushReplayCatchUp(lobbyCode: string, reconnectedPlayerId: string): Promise<void> {
	const lobby = getLobby(lobbyCode)
	if (!lobby) return

	const tails = [...lobby.players.keys()]
		.filter((id) => id !== reconnectedPlayerId)
		.map((id) => ({ playerId: id, events: replayLogService.getTail(lobbyCode, id, 0) }))
		.filter((tail) => tail.events.length > 0)

	if (tails.length === 0) return

	await mqttService.publishToPlayer(reconnectedPlayerId, 'replay-tail', {
		type: 'replay_tail',
		tails,
		timestamp: new Date().toISOString(),
	})
}

async function expireGracePeriod(playerId: string): Promise<void> {
	const entry = gracePeriods.get(playerId)
	if (!entry) return

	gracePeriods.delete(playerId)
	await deleteGracePeriod(playerId)

	const lobby = getLobby(entry.lobbyCode)
	if (!lobby) {
		removeSession(playerId)
		return
	}

	lobby.removePlayer(playerId)

	// Match auto-forfeit: the disconnected player loses on time -- ranked
	// applies ELO as a loss/win exactly like a normal reportResult, casual
	// just records the result (autoForfeitMatch branches on isRanked itself,
	// see matchmaking.service.ts). Dynamically imports routes/index.js (the
	// composition root, which holds the fully wired matchmakingService
	// singleton) rather than a static import, since routes/index.ts already
	// statically imports this module (as gracePeriodService) -- a static
	// import back would be a real cycle. By the time a grace period actually
	// expires (minutes after startup), routes/index.ts has long since
	// finished evaluating, so this is safe. matchByLobby only holds
	// ranked+casual matchmaking matches, so this is a no-op for practice/
	// private lobbies.
	const match = matchByLobby.get(entry.lobbyCode)
	if (match) {
		const remaining = [...lobby.players.keys()].filter((id) => !gracePeriods.has(id))
		console.log(
			`[grace-period] expired: player=${playerId} lobby=${entry.lobbyCode} matchId=${match.matchId} → auto-forfeit (remaining=${remaining.join(',')})`,
		)
		const { matchmakingService } = await import('../../routes/index.js')
		await matchmakingService.autoForfeitMatch(match.matchId, playerId, remaining)
	} else {
		console.log(`[grace-period] expired: player=${playerId} lobby=${entry.lobbyCode} (no ranked match)`)
	}

	await mqttService.cleanupPlayerState(entry.lobbyCode, playerId)

	await mqttService.publishEvent(entry.lobbyCode, {
		type: 'player_left',
		lobbyCode: entry.lobbyCode,
		playerId: entry.playerId,
		displayName: entry.displayName,
		timestamp: new Date().toISOString(),
	})

	// Handle host transfer if this player was still host (edge case)
	if (lobby.hostId === playerId) {
		if (lobby.isEmpty) {
			await mqttService.publishEvent(entry.lobbyCode, {
				type: 'lobby_closed',
				lobbyCode: entry.lobbyCode,
				timestamp: new Date().toISOString(),
			})
			await mqttService.cleanupLobbyTopics(entry.lobbyCode)
			lobbies.delete(entry.lobbyCode)
			await replayLogService.finalizeRun(entry.lobbyCode, 'abandoned')
			return
		}

		const newHostId = lobby.players.keys().next().value!
		lobby.hostId = newHostId
		await mqttService.publishEvent(entry.lobbyCode, {
			type: 'host_changed',
			lobbyCode: entry.lobbyCode,
			playerId: newHostId,
			timestamp: new Date().toISOString(),
		})
		if (lobby.type === 'public') {
			await syncMatchLobbyState(entry.lobbyCode)
		}
	}

	if (lobby.isEmpty) {
		await mqttService.publishEvent(entry.lobbyCode, {
			type: 'lobby_closed',
			lobbyCode: entry.lobbyCode,
			timestamp: new Date().toISOString(),
		})
		await mqttService.cleanupLobbyTopics(entry.lobbyCode)
		lobbies.delete(entry.lobbyCode)
		await replayLogService.finalizeRun(entry.lobbyCode, 'abandoned')
	}
}

export function cancelGracePeriodSilently(playerId: string): void {
	cancelGracePeriodImmediate(playerId)
}

export function isInGracePeriod(playerId: string): boolean {
	return gracePeriods.has(playerId)
}

// Best-effort detector for "this player just reconnected shortly after a
// match they were in got auto-forfeited by the system" -- the exact race
// that let a legitimately-reconnected player still lose (see A.1's
// cancelGracePeriodImmediate hook, which closes the common case; this is the
// safety net for when the race is still lost, e.g. every lightweight
// reconnect attempt failed and the fallback full re-auth also took too
// long). Call on every reconnect (MQTT or HTTP re-auth) -- cheap no-op for
// the overwhelming majority where nothing matches. Only ever inserts a
// review flag, never mutates a rating (see forfeitReconciliationFlags).
//
// matchmaking_matches has no per-player index -- `players` is stored as a
// JSON-encoded string (not a native jsonb array) via a historical quirk in
// how it's written, so a plain jsonb containment operator won't match it;
// a substring search on the raw text is the pragmatic option here given how
// rarely this actually needs to scan (bounded to the last
// RECONCILIATION_WINDOW_MS of system-forfeited matches only).
export async function checkForWrongfulForfeit(playerId: string): Promise<void> {
	const since = new Date(Date.now() - RECONCILIATION_WINDOW_MS)

	const candidates = await db
		.select()
		.from(matchmakingMatches)
		.where(
			and(
				eq(matchmakingMatches.status, 'resolved'),
				eq(matchmakingMatches.resultReportedBy, 'system'),
				gte(matchmakingMatches.resultReportedAt, since),
				sql`${matchmakingMatches.players}::text LIKE ${'%' + playerId + '%'}`,
			),
		)
		.orderBy(desc(matchmakingMatches.resultReportedAt))
		.limit(5)

	for (const match of candidates) {
		if (!match.resultReportedAt) continue

		const alreadyFlagged = await hasOpenForfeitReconciliationFlag(match.matchId, playerId)
		if (alreadyFlagged) continue

		console.log(
			`[grace-period] flagging possible wrongful forfeit: matchId=${match.matchId} player=${playerId} forfeitedAt=${match.resultReportedAt.toISOString()}`,
		)
		await insertForfeitReconciliationFlag({
			matchId: match.matchId,
			lobbyCode: match.lobbyCode,
			playerId,
			forfeitedAt: match.resultReportedAt,
			reconnectedAt: new Date(),
		})
	}
}

export function clearAllGracePeriods(): void {
	for (const entry of gracePeriods.values()) {
		clearTimeout(entry.timer)
	}
	gracePeriods.clear()
}

// Boot-time counterpart to matchmakingService.restoreMatchesFromDb() --
// re-arms every grace period that was still counting down when bmp-api last
// went down, so a restart never silently drops an in-flight disconnect
// countdown (previously: clearAllGracePeriods() on shutdown just cleared the
// JS timers, with nothing to pick them back up). Call from main.ts after
// restoreMatchesFromDb() and before forceReconnectStalePlayers() -- see
// MIN_REARM_BUFFER_MS above for why an already-elapsed row still waits
// rather than firing inline here.
export async function restoreGracePeriodsFromDb(): Promise<void> {
	const rows = await loadAllGracePeriods()
	if (rows.length === 0) return

	for (const row of rows) {
		if (gracePeriods.has(row.playerId)) continue

		const remainingMs = row.expiresAt.getTime() - Date.now()
		const armInMs = Math.max(remainingMs, MIN_REARM_BUFFER_MS)

		const timer = setTimeout(() => {
			expireGracePeriod(row.playerId)
		}, armInMs)
		timer.unref()

		gracePeriods.set(row.playerId, {
			playerId: row.playerId,
			lobbyCode: row.lobbyCode,
			displayName: row.displayName,
			disconnectedAt: row.disconnectedAt,
			timer,
		})
	}

	console.log(`[grace-period] Restored ${rows.length} grace period(s) from DB`)
}

// Exported for tests
export { gracePeriods, expireGracePeriod }

function findNextHost(
	lobby: { players: Map<string, unknown> },
	excludePlayerId: string,
): string | undefined {
	for (const id of lobby.players.keys()) {
		if (id !== excludePlayerId && !gracePeriods.has(id)) {
			return id
		}
	}
	return undefined
}
