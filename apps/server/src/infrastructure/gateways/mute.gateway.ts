import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { playerMutes } from '../db/schema.js'

/** Mutes are idempotent: muting an already-muted player is a silent no-op. */
export async function addMute(muterId: string, mutedId: string): Promise<void> {
	await db.insert(playerMutes).values({ muterId, mutedId }).onConflictDoNothing()
}

/** Unmuting a player who wasn't muted is a silent no-op. */
export async function removeMute(muterId: string, mutedId: string): Promise<void> {
	await db
		.delete(playerMutes)
		.where(and(eq(playerMutes.muterId, muterId), eq(playerMutes.mutedId, mutedId)))
}

/** Returns the ids of every player `muterId` currently has muted. */
export async function listMutes(muterId: string): Promise<string[]> {
	const rows = await db
		.select({ mutedId: playerMutes.mutedId })
		.from(playerMutes)
		.where(eq(playerMutes.muterId, muterId))
	return rows.map((r) => r.mutedId)
}
