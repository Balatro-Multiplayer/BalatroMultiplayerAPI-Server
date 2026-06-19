import { asc, gt, sql } from 'drizzle-orm'
import { extractGameRows } from '@/lib/log-file-players'
import { db } from '@/server/db'
import { games, logFiles } from '@/server/db/schema'

const LOG_BATCH_SIZE = 500
const INSERT_BATCH_SIZE = 100

async function backfillGames() {
  console.log('Backfilling games...')

  const [{ totalLogs } = { totalLogs: 0 }] = await db
    .select({
      totalLogs: sql<number>`count(*)::int`,
    })
    .from(logFiles)

  let processedLogs = 0
  let insertedGames = 0
  let lastId = 0

  while (true) {
    const rows = await db
      .select({
        id: logFiles.id,
        parsedJson: logFiles.parsedJson,
      })
      .from(logFiles)
      .where(gt(logFiles.id, lastId))
      .orderBy(asc(logFiles.id))
      .limit(LOG_BATCH_SIZE)

    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      const gameRows = extractGameRows(row.parsedJson, row.id)

      for (let index = 0; index < gameRows.length; index += INSERT_BATCH_SIZE) {
        const batch = gameRows.slice(index, index + INSERT_BATCH_SIZE)
        if (batch.length === 0) {
          continue
        }

        await db
          .insert(games)
          .values(batch)
          .onConflictDoNothing({
            target: [games.logFileId, games.gameIndex],
          })
      }

      processedLogs += 1
      insertedGames += gameRows.length
      lastId = row.id
    }

    console.log(
      `Processed ${processedLogs}/${totalLogs} logs, extracted ${insertedGames} games`
    )
  }

  console.log(
    `✓ Backfill complete. Processed ${processedLogs} logs, extracted ${insertedGames} games`
  )
}

if (require.main === module) {
  backfillGames()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('Failed to backfill games:', error)
      process.exit(1)
    })
}

export { backfillGames }
