import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { players } from '../db/schema.js'

export interface PlayerRecord {
	id: string
	steamId: string | null
	discordId: string | null
	username: string
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
	username: string
	steamId?: string
	discordId?: string
}): Promise<PlayerRecord> {
	const [row] = await db
		.insert(players)
		.values({
			id: data.id,
			username: data.username,
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
): Promise<void> {
	await db
		.update(players)
		.set({ discordId, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}

export async function updateUsername(
	playerId: string,
	username: string,
): Promise<void> {
	await db
		.update(players)
		.set({ username, updatedAt: new Date() })
		.where(eq(players.id, playerId))
}
