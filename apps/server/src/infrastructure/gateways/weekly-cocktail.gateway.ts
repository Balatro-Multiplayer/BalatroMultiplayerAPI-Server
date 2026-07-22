import { db } from '../db/index.js'
import { weeklyCocktail } from '../db/schema.js'

export async function loadWeeklyCocktailFromDb(): Promise<{
	name: string
	decks: string[]
} | null> {
	const row = await db.query.weeklyCocktail.findFirst()
	if (!row) return null
	return { name: row.name, decks: row.decks }
}

export async function saveWeeklyCocktailToDb(wc: {
	name: string
	decks: string[]
}): Promise<void> {
	const updatedAt = new Date()
	await db
		.insert(weeklyCocktail)
		.values({ id: 1, name: wc.name, decks: wc.decks, updatedAt })
		.onConflictDoUpdate({
			target: weeklyCocktail.id,
			set: { name: wc.name, decks: wc.decks, updatedAt },
		})
}
