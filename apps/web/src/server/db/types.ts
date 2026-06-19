import type { games, player_games } from '@/server/db/schema'

export type SelectGames = typeof player_games.$inferSelect
export type SelectGame = typeof games.$inferSelect
export type InsertGame = typeof games.$inferInsert
