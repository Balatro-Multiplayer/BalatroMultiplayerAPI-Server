import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { players } from '../db/schema.js'

export interface PlayerRecord {
	id: string
	steamId: string | null
	discordId: string | null
	discordUsername: string | null
	useDiscordName: boolean
	preferredJoker: string
	steamName: string
}

export async function findPlayerBySteamId(
	steamId: string,
): Promise<PlayerRecord | null> {
	const row = await db.query.players.findFirst({
		where: eq(players.steamId, steamId),
	})
	return row ?? null
}

export async function findPlayerByDiscordId(
	discordId: string,
): Promise<PlayerRecord | null> {
	const row = await db.query.players.findFirst({
		where: eq(players.discordId, discordId),
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

export async function createPlayer(data: {
	id: string
	steamName: string
	steamId?: string
	discordId?: string
}): Promise<PlayerRecord> {
	const [row] = await db
		.insert(players)
		.values({
			id: data.id,
			steamName: data.steamName,
			steamId: data.steamId ?? null,
			discordId: data.discordId ?? null,
		})
		.returning()
	return row
}

export async function linkSteam(
	playerId: string,
	steamId: string,
): Promise<void> {
	await db
		.update(players)
		.set({ steamId, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

export async function linkDiscord(
	playerId: string,
	discordId: string,
	discordUsername?: string,
): Promise<void> {
	await db
		.update(players)
		.set({ discordId, discordUsername: discordUsername ?? null, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

export async function unlinkDiscord(playerId: string): Promise<void> {
	await db
		.update(players)
		.set({ discordId: null, discordUsername: null, useDiscordName: false, updatedAt: new Date() })
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
