import { sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { player_games } from '@/server/db/schema'
import { getSeasonForDate } from '@/server/seasons'

async function migrateSeasonColumn() {
  console.log('Starting season column migration...')

  try {
    // Step 1: Add season column if it doesn't exist
    console.log('Adding season column to player_games table...')
    await db.execute(sql`
      ALTER TABLE player_games
      ADD COLUMN IF NOT EXISTS season TEXT
    `)
    console.log('✓ Season column added')

    // Step 1.5: Add index on season column
    console.log('Adding index on season column...')
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS season_idx ON player_games(season)
    `)
    console.log('✓ Season index added')

    // Step 2: Get all records
    console.log('Fetching all player_games records...')
    const allGames = await db.select().from(player_games)
    console.log(`Found ${allGames.length} records to update`)

    // Step 3: Update records in batches
    const batchSize = 1000
    let updated = 0

    for (let i = 0; i < allGames.length; i += batchSize) {
      const batch = allGames.slice(i, i + batchSize)

      // Update each record in the batch
      await Promise.all(
        batch.map(async (game) => {
          const season = await getSeasonForDate(new Date(game.gameTime))
          await db
            .update(player_games)
            .set({ season })
            .where(
              sql`${player_games.playerId} = ${game.playerId} AND ${player_games.gameNum} = ${game.gameNum}`
            )
        })
      )

      updated += batch.length
      console.log(
        `Progress: ${updated}/${allGames.length} (${Math.round((updated / allGames.length) * 100)}%)`
      )
    }

    console.log(`✓ Migration completed! Updated ${updated} records`)

    // Step 4: Verify the migration
    console.log('Verifying migration...')
    const recordsWithoutSeason = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM player_games
      WHERE season IS NULL
    `)
    const nullCountRow = recordsWithoutSeason.rows[0] as
      | { count: string }
      | undefined
    const nullCount = nullCountRow?.count ?? '0'

    if (nullCount === '0') {
      console.log('✓ All records have season values')
    } else {
      console.warn(`⚠ Warning: ${nullCount} records still missing season`)
    }

    // Show distribution
    const distribution = await db.execute(sql`
      SELECT season, COUNT(*) as count
      FROM player_games
      GROUP BY season
      ORDER BY season
    `)
    console.log('\nSeason distribution:')
    for (const row of distribution.rows as Array<{
      season: string | null
      count: string
    }>) {
      console.log(`  ${row.season}: ${row.count} games`)
    }
  } catch (error) {
    console.error('Migration failed:', error)
    throw error
  }
}

// Run if called directly
if (require.main === module) {
  migrateSeasonColumn()
    .then(() => {
      console.log('\n✅ Migration successful!')
      process.exit(0)
    })
    .catch((err) => {
      console.error('\n❌ Migration failed:', err)
      process.exit(1)
    })
}

export { migrateSeasonColumn }
