import { createHash } from 'node:crypto'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/server/db'
import { logFiles } from '@/server/db/schema'

const BATCH_SIZE = 100

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function hashRemoteFile(fileUrl: string) {
  const response = await fetch(fileUrl)
  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return sha256(Buffer.from(arrayBuffer))
}

async function backfillLogFileHashes() {
  console.log('Backfilling log file hashes...')

  let processed = 0
  let updated = 0
  let skipped = 0
  let lastId = 0

  while (true) {
    const rows = await db
      .select({
        id: logFiles.id,
        fileUrl: logFiles.fileUrl,
      })
      .from(logFiles)
      .where(and(isNull(logFiles.fileHash), gt(logFiles.id, lastId)))
      .orderBy(asc(logFiles.id))
      .limit(BATCH_SIZE)

    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      lastId = row.id
      processed += 1

      try {
        const fileHash = await hashRemoteFile(row.fileUrl)
        const existing = await db.query.logFiles.findFirst({
          columns: {
            id: true,
          },
          where: eq(logFiles.fileHash, fileHash),
        })

        if (existing) {
          skipped += 1
          continue
        }

        await db
          .update(logFiles)
          .set({ fileHash })
          .where(eq(logFiles.id, row.id))

        updated += 1
      } catch (error) {
        skipped += 1
        console.error(`Skipping log ${row.id}:`, error)
      }
    }

    console.log(
      `Processed ${processed} logs, updated ${updated}, skipped ${skipped}`
    )
  }

  console.log(
    `✓ Hash backfill complete. Processed ${processed} logs, updated ${updated}, skipped ${skipped}`
  )
}

if (require.main === module) {
  backfillLogFileHashes()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('Failed to backfill log file hashes:', error)
      process.exit(1)
    })
}

export { backfillLogFileHashes }
