import { sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { player_games } from '@/server/db/schema'

interface PlayerGameRow {
  playerId: string
  queueId: string | null
  playerName: string
  gameId: number
  gameTime: string
  gameType: string
  gameNum: number
  playerMmr: number
  mmrChange: number
  opponentId: string
  opponentName: string
  opponentMmr: number
  deck: string | null
  stake: string | null
  result: string
  season: string
}

async function backfill() {
  console.log('Reading season 4 JSON...')
  const file = Bun.file(
    `${process.env.HOME}/Downloads/season-4-player-games.json`
  )
  const rows: PlayerGameRow[] = await file.json()
  console.log(`Loaded ${rows.length} records`)

  // Get max game_num to offset and avoid PK conflicts
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${player_games.gameNum}), 0)` })
    .from(player_games)
  const offset = Number(max)
  console.log(
    `Current max game_num: ${offset}, offsetting all season 4 gameNums`
  )

  const BATCH_SIZE = 1000
  let inserted = 0
  let skipped = 0
  const seasonCounts: Record<string, number> = {}

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const values = batch
      .filter(
        (r) =>
          r.playerId &&
          r.playerName &&
          r.gameId != null &&
          r.gameTime &&
          r.gameType &&
          r.gameNum != null &&
          r.playerMmr != null &&
          r.mmrChange != null &&
          r.opponentId &&
          r.opponentName &&
          r.opponentMmr != null &&
          r.result
      )
      .map((r) => {
        const season = r.season === '4' ? 'season4' : `season${r.season}`
        seasonCounts[season] = (seasonCounts[season] ?? 0) + 1
        return {
          playerId: r.playerId,
          queueId: r.queueId,
          playerName: r.playerName,
          gameId: r.gameId,
          gameTime: new Date(r.gameTime),
          gameType: r.gameType,
          gameNum: r.gameNum + offset,
          playerMmr: r.playerMmr,
          mmrChange: r.mmrChange,
          opponentId: r.opponentId,
          opponentName: r.opponentName,
          opponentMmr: r.opponentMmr,
          deck: r.deck,
          stake: r.stake,
          result: r.result,
          season,
        }
      })

    if (values.length === 0) {
      skipped += batch.length
      continue
    }

    const _result = await db
      .insert(player_games)
      .values(values)
      .onConflictDoNothing({
        target: [player_games.playerId, player_games.gameNum],
      })

    inserted += values.length
    skipped += batch.length - values.length
    const pct = Math.round(((i + batch.length) / rows.length) * 100)
    process.stdout.write(
      `\rProgress: ${i + batch.length}/${rows.length} (${pct}%)`
    )
  }

  console.log(
    `\n\nDone! Inserted: ${inserted}, Skipped (validation): ${skipped}`
  )
  console.log('Season distribution:')
  for (const [season, count] of Object.entries(seasonCounts).sort()) {
    console.log(`  ${season}: ${count}`)
  }

  // Verify
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(player_games)
  console.log(`\nTotal rows in player_games: ${Number(total)}`)

  process.exit(0)
}

backfill().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
