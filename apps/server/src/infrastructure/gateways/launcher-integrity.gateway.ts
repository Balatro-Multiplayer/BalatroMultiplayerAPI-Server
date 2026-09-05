import { and, eq, gt, isNull, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type {
	ChallengeKind,
	LauncherIntegrityFailureReason,
} from '../../shared/types/index.js'
import { db } from '../db/index.js'
import {
	launcherIntegrityEvents,
	playerBans,
	playerHardwareFingerprints,
	players,
} from '../db/schema.js'

// A ban is active when it has not been lifted and has not expired - same
// predicate ban.gateway.ts's own (unexported) activeCondition() uses, kept
// in sync by hand since that one isn't exported for reuse.
const activeBanCondition = () =>
	and(
		isNull(playerBans.liftedAt),
		or(isNull(playerBans.expiresAt), gt(playerBans.expiresAt, sql`now()`)),
	)

export async function insertEvent(
	playerId: string,
	kind: ChallengeKind,
	reason: LauncherIntegrityFailureReason,
): Promise<void> {
	await db.insert(launcherIntegrityEvents).values({ playerId, kind, reason })
}

// Called only from handleChallengeResponse, and only once a login challenge's
// signature has already verified -- see that module's doc comment. One
// upsert per component so a re-submission (every Ranked Run re-collects and
// re-sends -- see hardwarefingerprint.cpp) refreshes lastSeenAt/componentHash
// in place rather than growing this table unboundedly. Components are
// upserted independently of each other (not a single all-or-nothing batch)
// so a machine that swapped one drive but kept everything else still records
// the parts that didn't change.
export async function upsertHardwareComponents(
	playerId: string,
	platform: string,
	components: Record<string, string>,
): Promise<void> {
	const now = new Date()
	for (const [componentName, componentHash] of Object.entries(components)) {
		await db
			.insert(playerHardwareFingerprints)
			.values({
				playerId,
				platform,
				componentName,
				componentHash,
				firstSeenAt: now,
				lastSeenAt: now,
			})
			.onConflictDoUpdate({
				target: [
					playerHardwareFingerprints.playerId,
					playerHardwareFingerprints.componentName,
				],
				set: {
					platform,
					componentHash,
					lastSeenAt: now,
				},
			})
	}
}

// Part of the same retention policy purgeExpiredDeletedPlayerHashes()
// (player.gateway.ts) already applies to steamIdHash/discordIdHash - called
// from that same function, under the same "12+ months deleted, no active
// ban" condition, so this table doesn't outlive the identifiers needed to
// look a player up by in the first place. A hard delete (not an anonymizing
// update, unlike the hash columns) - there's no "keep the row but blank it"
// value here the way there is for players itself (playerBans still needs
// the players row to exist; nothing references player_hardware_fingerprints
// rows after the fact).
export async function deletePlayerHardwareFingerprints(
	playerId: string,
): Promise<void> {
	await db
		.delete(playerHardwareFingerprints)
		.where(eq(playerHardwareFingerprints.playerId, playerId))
}

export interface BanEvasionMatch {
	bannedPlayerId: string
	bannedPlayerName: string
	matchedPlayerId: string
	matchedPlayerName: string
	matchedPlayerHasActiveBan: boolean
	matchedComponents: string[]
}

// Every player sharing >=1 hardware component with a currently-banned
// player - the join player_hardware_fingerprints' own
// (componentName, componentHash) index exists specifically to make this
// cheap. "Banned" means the first player in a pair currently has an active
// ban of any type; matchedPlayerHasActiveBan says whether the *other* one
// also does, surfaced separately since a match between two already-banned
// accounts is a different (lower-urgency) case than one flagging a live,
// unbanned alt.
//
// Every component is weighted equally for now (this just counts distinct
// matched component names) - see hardwarefingerprint.cpp's own components
// for how widely spoofability actually varies between them (a registry
// value vs. a TPM-backed key are not equally trustworthy signals). This is
// the one spot a future per-component weight map would replace a plain
// count with a weighted score, once there's enough real match data to set
// sensible weights from - not guessed at now.
export async function findBanEvasionMatches(): Promise<BanEvasionMatch[]> {
	const bannedPlayerIds = await db
		.selectDistinct({ playerId: playerBans.playerId })
		.from(playerBans)
		.where(activeBanCondition())
	const bannedIdList = bannedPlayerIds.map((row) => row.playerId)
	const bannedIdSet = new Set(bannedIdList)
	if (bannedIdSet.size === 0) {
		return []
	}

	const mine = alias(playerHardwareFingerprints, 'mine')
	const other = alias(playerHardwareFingerprints, 'other')
	const bannedPlayer = alias(players, 'banned_player')
	const matchedPlayer = alias(players, 'matched_player')

	const rows = await db
		.select({
			bannedPlayerId: mine.playerId,
			bannedPlayerName: bannedPlayer.steamName,
			matchedPlayerId: other.playerId,
			matchedPlayerName: matchedPlayer.steamName,
			componentName: mine.componentName,
		})
		.from(mine)
		.innerJoin(
			other,
			and(
				eq(mine.componentName, other.componentName),
				eq(mine.componentHash, other.componentHash),
				ne(mine.playerId, other.playerId),
			),
		)
		.innerJoin(bannedPlayer, eq(bannedPlayer.id, mine.playerId))
		.innerJoin(matchedPlayer, eq(matchedPlayer.id, other.playerId))
		.where(sql`${mine.playerId} in ${bannedIdList}`)

	const byPair = new Map<string, BanEvasionMatch>()
	for (const row of rows) {
		const key = `${row.bannedPlayerId}:${row.matchedPlayerId}`
		const existing = byPair.get(key)
		if (existing) {
			existing.matchedComponents.push(row.componentName)
			continue
		}
		byPair.set(key, {
			bannedPlayerId: row.bannedPlayerId,
			bannedPlayerName: row.bannedPlayerName,
			matchedPlayerId: row.matchedPlayerId,
			matchedPlayerName: row.matchedPlayerName,
			matchedPlayerHasActiveBan: bannedIdSet.has(row.matchedPlayerId),
			matchedComponents: [row.componentName],
		})
	}

	return [...byPair.values()].sort(
		(a, b) => b.matchedComponents.length - a.matchedComponents.length,
	)
}
