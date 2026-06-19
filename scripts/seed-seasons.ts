import { sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { seasons } from '@/server/db/schema'
import { redis } from '@/server/redis'
import {
  SEASON_1_START_DATE,
  SEASON_2_START_DATE,
  SEASON_3_START_DATE,
  SEASON_4_START_DATE,
  SEASON_5_START_DATE,
  SEASON_6_START_DATE,
} from '@/shared/seasons'

async function seedSeasons() {
  console.log('Seeding seasons...')

  const rows = [
    {
      id: 1,
      name: 'Season 1',
      startDate: SEASON_1_START_DATE,
      endDate: SEASON_2_START_DATE,
      isActive: false,
    },
    {
      id: 2,
      name: 'Season 2',
      startDate: SEASON_2_START_DATE,
      endDate: SEASON_3_START_DATE,
      isActive: false,
    },
    {
      id: 3,
      name: 'Season 3',
      startDate: SEASON_3_START_DATE,
      endDate: SEASON_4_START_DATE,
      isActive: false,
    },
    {
      id: 4,
      name: 'Season 4',
      startDate: SEASON_4_START_DATE,
      endDate: SEASON_5_START_DATE,
      isActive: false,
    },
    {
      id: 5,
      name: 'Season 5',
      startDate: SEASON_5_START_DATE,
      endDate: SEASON_6_START_DATE,
      isActive: false,
    },
    {
      id: 6,
      name: 'Season 6',
      startDate: SEASON_6_START_DATE,
      endDate: null,
      isActive: true,
    },
  ] as const

  for (const row of rows) {
    await db
      .insert(seasons)
      .values(row)
      .onConflictDoUpdate({
        target: seasons.id,
        set: {
          name: row.name,
          startDate: row.startDate,
          endDate: row.endDate,
          isActive: row.isActive,
        },
      })
  }

  await db.execute(sql`
    select setval(
      pg_get_serial_sequence('seasons', 'id'),
      coalesce((select max(id) from seasons), 1),
      true
    )
  `)

  await redis.set('config:active_season', '6')

  console.log('✓ Seeded seasons 1-6')
}

if (require.main === module) {
  seedSeasons()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('Failed to seed seasons:', error)
      process.exit(1)
    })
}

export { seedSeasons }
