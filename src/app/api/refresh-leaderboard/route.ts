import { headers } from 'next/headers'
import { env } from '@/env'
import { leaderboardService } from '@/server/services/leaderboard'
import { RANKED_QUEUE_ID, VANILLA_QUEUE_ID } from '@/shared/constants'

const SECURE_TOKEN = env.CRON_SECRET
const CHANNEL_IDS = [RANKED_QUEUE_ID, VANILLA_QUEUE_ID]

function logMemory(
  label: string,
  runId: string,
  metadata?: Record<string, unknown>
) {
  const mem = process.memoryUsage()
  const data = {
    runId,
    label,
    heapUsedMb: mem.heapUsed / 1024 / 1024,
    heapTotalMb: mem.heapTotal / 1024 / 1024,
    rssMb: mem.rss / 1024 / 1024,
    externalMb: mem.external / 1024 / 1024,
    metadata: metadata || null,
  }

  console.log(`[MEMORY ${label}]`, {
    heap: `${Math.round(data.heapUsedMb)}MB`,
    rss: `${Math.round(data.rssMb)}MB`,
    ...metadata,
  })
}

export async function POST() {
  const cronRunId = crypto.randomUUID()
  logMemory('cron_start', cronRunId)

  const headersList = await headers()
  const authToken = headersList.get('authorization')?.replace('Bearer ', '')

  if (authToken !== SECURE_TOKEN) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    for (const channelId of CHANNEL_IDS) {
      try {
        console.log(`refreshing leaderboard for ${channelId}...`)
        logMemory(`before_refresh_${channelId}`, cronRunId, {
          channel_id: channelId,
        })
        await leaderboardService.refreshLeaderboard(channelId)
        logMemory(`after_refresh_${channelId}`, cronRunId, {
          channel_id: channelId,
        })
      } catch (err) {
        console.error('refresh failed:', err)
        logMemory('cron_error', cronRunId, { error: String(err) })
        return new Response('internal error', { status: 500 })
      }
    }

    logMemory('cron_end', cronRunId)

    // Hint to GC between cron runs if available
    if (global.gc) {
      global.gc()
      logMemory('after_gc', cronRunId)
    }

    return Response.json({ success: true })
  } catch (err) {
    console.error('refresh failed:', err)
    logMemory('cron_error', cronRunId, { error: String(err) })
    return new Response('internal error', { status: 500 })
  }
}
