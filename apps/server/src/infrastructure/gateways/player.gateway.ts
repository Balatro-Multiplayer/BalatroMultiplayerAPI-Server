import { and, eq, isNotNull, lt } from 'drizzle-orm'
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
	deletedAt: Date | null
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
}): Promise<PlayerRecord> {
	const [row] = await db
		.insert(players)
		.values({
			id: data.id,
			steamName: data.steamName,
			steamIdHash: data.steamIdHash ?? null,
			discordIdHash: data.discordIdHash ?? null,
		})
		.returning()
	return row
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

export async function updateTosAcceptedVersion(
	playerId: string,
	version: number,
): Promise<void> {
	await db
		.update(players)
		.set({ tosAcceptedVersion: version, updatedAt: new Date() })
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

// Soft-delete: the row is never removed (so playerBans stays attached and
// enforceable), but every identifying/PII field except steamIdHash is cleared
// immediately. steamIdHash survives so an active ban stays enforceable and a
// re-signin with the same Steam identity reactivates this same row instead of
// creating a fresh, ban-free one. See purgeExpiredDeletedPlayerHashes for the
// later step that clears steamIdHash too, once it's no longer needed.
export async function softDeletePlayer(playerId: string): Promise<void> {
	await db
		.update(players)
		.set({
			deletedAt: new Date(),
			steamName: '[deleted player]',
			discordIdHash: null,
			discordUsername: null,
			useDiscordName: false,
			updatedAt: new Date(),
		})
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

// Final step of account deletion, run periodically rather than at delete
// time: once an account has been deleted for 12+ months AND has no currently
// active ban, steamIdHash/discordIdHash are cleared too, so the account can
// no longer be linked back to a real Steam/Discord identity at all. This does
// NOT let anyone evade a currently-active ban -- a permanent ban never
// satisfies "no active ban", so its hash is retained forever; only accounts
// whose ban (if any) has already fully run its course ever reach this. The
// row itself is never hard-deleted (matchmakingRatings/playerBans stay
// attached to it), it just becomes permanently anonymous.
export async function purgeExpiredDeletedPlayerHashes(): Promise<number> {
	const cutoff = new Date(Date.now() - DELETED_HASH_RETENTION_MS)
	const candidates = await db.query.players.findMany({
		where: and(
			isNotNull(players.deletedAt),
			lt(players.deletedAt, cutoff),
			isNotNull(players.steamIdHash),
		),
	})

	let purged = 0
	for (const candidate of candidates) {
		const activeBans = await getActiveBans(candidate.id)
		if (activeBans.length > 0) continue
		await db
			.update(players)
			.set({ steamIdHash: null, discordIdHash: null, updatedAt: new Date() })
			.where(eq(players.id, candidate.id))
		purged++
	}
	return purged
}
