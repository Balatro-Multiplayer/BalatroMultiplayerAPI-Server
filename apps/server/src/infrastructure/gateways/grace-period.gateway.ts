import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { gracePeriods } from '../db/schema.js'

export type GracePeriodRow = typeof gracePeriods.$inferSelect

export async function insertGracePeriod(data: {
	playerId: string
	lobbyCode: string
	displayName: string
	disconnectedAt: Date
	expiresAt: Date
}): Promise<void> {
	await db.insert(gracePeriods).values(data)
}

export async function deleteGracePeriod(playerId: string): Promise<void> {
	await db.delete(gracePeriods).where(eq(gracePeriods.playerId, playerId))
}

export async function loadAllGracePeriods(): Promise<GracePeriodRow[]> {
	return db.select().from(gracePeriods)
}
