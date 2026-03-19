import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { players } from '../db/schema.js'

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

export async function findPlayerById(
	id: string,
): Promise<PlayerRecord | null> {
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
		.set({ discordIdHash, discordUsername: discordUsername ?? null, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

export async function unlinkDiscord(playerId: string): Promise<void> {
	await db
		.update(players)
		.set({ discordIdHash: null, discordUsername: null, useDiscordName: false, updatedAt: new Date() })
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
