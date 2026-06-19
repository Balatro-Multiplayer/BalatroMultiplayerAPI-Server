/**
 * migrate-vanilla-to-legacy.ts
 *
 * Updates all player_games rows where game_type = 'vanilla' to 'legacy'.
 * Run this once after deploying the vanilla → legacy rename.
 *
 * Usage:
 *   bun scripts/migrate-vanilla-to-legacy.ts
 */

import { eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { player_games } from '@/server/db/schema'

async function main() {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(player_games)
    .where(eq(player_games.gameType, 'vanilla'))

  const total = Number(count)
  console.log(`Found ${total} rows with gameType = 'vanilla'`)

  if (total === 0) {
    console.log('Nothing to migrate.')
    process.exit(0)
  }

  await db
    .update(player_games)
    .set({ gameType: 'legacy' })
    .where(eq(player_games.gameType, 'vanilla'))

  console.log(`✓ Updated ${total} rows to gameType = 'legacy'`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
