import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { db } from '../db/index.js'
import { players } from '../db/schema.js'
import { getActiveBans } from './ban.gateway.js'

const DELETED_HASH_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

export interface PlayerRecord {
	id: string
	steamIdHash: string | null
	discordIdHash: string | null
	discordUsername: string | null
	useDiscordName: boolean
	preferredJoker: string
	privileges: string[]
	steamName: string
	chatEnabled: boolean
	chatBlocked: boolean
	tosAcceptedVersion: number
	noticeAcceptedAt: Date | null
	deletedAt: Date | null
	// Set once the player has signed in through Nakama.
	nakamaUserId?: string | null
}

export async function findPlayerBySteamIdHash(
	steamIdHash: string,
): Promise<PlayerRecord | null> {
	const row = await db.query.players.findFirst({
		where: eq(players.steamIdHash, steamIdHash),
	})
	return row ?? null
}

export async function findPlayerByDiscordIdHash(
	discordIdHash: string,
): Promise<PlayerRecord | null> {
	const row = await db.query.players.findFirst({
		where: eq(players.discordIdHash, discordIdHash),
	})
	return row ?? null
}

export async function findPlayerById(id: string): Promise<PlayerRecord | null> {
	const row = await db.query.players.findFirst({
		where: eq(players.id, id),
	})
	return row ?? null
}

export async function findPlayerBySteamName(
	steamName: string,
): Promise<PlayerRecord | null> {
	const row = await db.query.players.findFirst({
		where: eq(players.steamName, steamName),
	})
	return row ?? null
}

export async function createPlayer(data: {
	id: string
	steamName: string
	steamIdHash?: string
	discordIdHash?: string
	nakamaUserId?: string
	deleted?: boolean
}): Promise<PlayerRecord> {
	const [row] = await db
		.insert(players)
		.values({
			id: data.id,
			steamName: data.steamName,
			steamIdHash: data.steamIdHash ?? null,
			discordIdHash: data.discordIdHash ?? null,
			nakamaUserId: data.nakamaUserId ?? null,
			deletedAt: data.deleted ? new Date() : null,
		})
		.returning()
	return row
}

// The seeded web admin of a Community or Dev server (features/local-server/
// seed.ts). Upserted, so seeding twice keeps one row and restores the
// privilege if someone removed it.
export async function upsertAdminPlayer(data: {
	id: string
	steamName: string
}): Promise<void> {
	await db
		.insert(players)
		.values({
			id: data.id,
			steamName: data.steamName,
			privileges: ['admin'],
			tosAcceptedVersion: 1,
		})
		.onConflictDoUpdate({
			target: players.id,
			set: {
				steamName: data.steamName,
				privileges: ['admin'],
				deletedAt: null,
				updatedAt: new Date(),
			},
		})
}

export async function linkSteam(
	playerId: string,
	steamIdHash: string,
): Promise<void> {
	await db
		.update(players)
		.set({ steamIdHash, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

// A no-op when the player has no row yet (a new player before accepting the
// ToS); ensurePlayerExistsInDb stores the id when it creates the row.
export async function linkNakamaUser(
	playerId: string,
	nakamaUserId: string,
): Promise<void> {
	await db
		.update(players)
		.set({ nakamaUserId, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

// playerId -> Nakama user id, for those of the given players that have one.
export async function findNakamaUserIds(playerIds: string[]): Promise<Map<string, string>> {
	if (playerIds.length === 0) return new Map()
	const rows = await db
		.select({ id: players.id, nakamaUserId: players.nakamaUserId })
		.from(players)
		.where(inArray(players.id, playerIds))
	const found = new Map<string, string>()
	for (const row of rows) if (row.nakamaUserId) found.set(row.id, row.nakamaUserId)
	return found
}

// Nakama user id -> playerId, for those of the given Nakama users that have a
// player row.
export async function findPlayerIdsByNakamaUserIds(nakamaUserIds: string[]): Promise<Map<string, string>> {
	if (nakamaUserIds.length === 0) return new Map()
	const rows = await db
		.select({ id: players.id, nakamaUserId: players.nakamaUserId })
		.from(players)
		.where(inArray(players.nakamaUserId, nakamaUserIds))
	const found = new Map<string, string>()
	for (const row of rows) if (row.nakamaUserId) found.set(row.nakamaUserId, row.id)
	return found
}

export async function findPlayerByNakamaUserId(nakamaUserId: string): Promise<PlayerRecord | null> {
	const row = await db.query.players.findFirst({
		where: eq(players.nakamaUserId, nakamaUserId),
	})
	return row ?? null
}

export async function linkDiscord(
	playerId: string,
	discordIdHash: string,
	discordUsername?: string,
): Promise<void> {
	await db
		.update(players)
		.set({
			discordIdHash,
			discordUsername: discordUsername ?? null,
			updatedAt: new Date(),
		})
		.where(eq(players.id, playerId))
}

export async function unlinkDiscord(playerId: string): Promise<void> {
	await db
		.update(players)
		.set({
			discordIdHash: null,
			discordUsername: null,
			useDiscordName: false,
			updatedAt: new Date(),
		})
		.where(eq(players.id, playerId))
}

export async function updateUseDiscordName(
	playerId: string,
	useDiscordName: boolean,
): Promise<void> {
	await db
		.update(players)
		.set({ useDiscordName, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

export async function updateDiscordUsername(
	playerId: string,
	discordUsername: string,
): Promise<void> {
	await db
		.update(players)
		.set({ discordUsername, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

export async function updatePreferredJoker(
	playerId: string,
	preferredJoker: string,
): Promise<void> {
	await db
		.update(players)
		.set({ preferredJoker, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

export async function updateSteamName(
	playerId: string,
	steamName: string,
): Promise<void> {
	await db
		.update(players)
		.set({ steamName, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

// The Notice version the player accepted, and when (website login or the
// Nakama mirror).
export async function recordNoticeAcceptance(
	playerId: string,
	version: number,
	acceptedAt: Date,
): Promise<void> {
	await db
		.update(players)
		.set({ tosAcceptedVersion: version, noticeAcceptedAt: acceptedAt, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

export async function updateChatStatus(
	playerId: string,
	chatEnabled: boolean,
	chatBlocked: boolean,
): Promise<void> {
	await db
		.update(players)
		.set({ chatEnabled, chatBlocked, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}


// Clears deletedAt on re-signin with the same Steam identity. A cheap no-op
// if the account was never deleted.
export async function reactivateIfDeleted(playerId: string): Promise<void> {
	await db
		.update(players)
		.set({ deletedAt: null, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

// Final step of account deletion, run hourly (features/nakama/retention.job.ts
// purgeDeletedPlayerHashes): once an account has been deleted for 12+ months
// AND has no ban in force, its steamIdHash/discordIdHash are cleared, so the
// anonymous row can no longer be linked back to a Steam/Discord identity.
// This does NOT let anyone evade a ban in force: a permanent ban never
// satisfies "no ban in force", so its hash is kept forever. The row itself is
// never hard-deleted (its bans and other moderation records stay attached to
// it); it just becomes permanently anonymous. Nakama's ban index keeps the
// same hash under the same rule, so the job has Nakama forget it first.
function deletedHashCutoff(): Date {
	return new Date(Date.now() - DELETED_HASH_RETENTION_MS)
}

export async function expiredDeletedPlayerHashes(): Promise<{ id: string; steamIdHash: string }[]> {
	const candidates = await db.query.players.findMany({
		where: and(isNotNull(players.deletedAt), lt(players.deletedAt, deletedHashCutoff()), isNotNull(players.steamIdHash)),
	})
	const expired: { id: string; steamIdHash: string }[] = []
	for (const candidate of candidates) {
		if (!candidate.steamIdHash) continue
		const activeBans = await getActiveBans(candidate.id)
		if (activeBans.length > 0) continue
		expired.push({ id: candidate.id, steamIdHash: candidate.steamIdHash })
	}
	return expired
}

// Clears the hashes of rows expiredDeletedPlayerHashes listed. A row given
// back meanwhile (a login with the same Steam identity) is left alone.
export async function clearDeletedPlayerHashes(playerIds: string[]): Promise<number> {
	if (playerIds.length === 0) return 0
	const cleared = await db
		.update(players)
		.set({ steamIdHash: null, discordIdHash: null, updatedAt: new Date() })
		.where(
			and(inArray(players.id, playerIds), isNotNull(players.deletedAt), lt(players.deletedAt, deletedHashCutoff())),
		)
		.returning({ id: players.id })
	return cleared.length
}

export async function isModerator(playerId: string): Promise<boolean> {
	const player = await findPlayerById(playerId)
	return (
		player?.privileges.includes('admin') ||
		player?.privileges.includes('moderator') ||
		false
	)
}
