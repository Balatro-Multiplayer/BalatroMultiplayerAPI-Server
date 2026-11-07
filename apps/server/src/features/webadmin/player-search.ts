import { type SQL, eq, ilike, or } from 'drizzle-orm'
import { players } from '../../infrastructure/db/schema.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Staff find a player by part of the name, or by player id or Nakama id.
// Discord and Steam names are identity data and are not searched.
export function playerSearchCondition(search: string): SQL | undefined {
	if (!search) return undefined
	if (UUID.test(search))
		return or(eq(players.id, search), eq(players.nakamaUserId, search))
	return ilike(players.steamName, `%${search}%`)
}
