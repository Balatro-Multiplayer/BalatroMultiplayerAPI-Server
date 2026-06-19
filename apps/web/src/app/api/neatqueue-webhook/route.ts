import crypto from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/env'
import { globalEmitter } from '@/lib/events'
import type { PlayerState } from '@/server/api/routers/player-state'
import { PLAYER_STATE_KEY, redis } from '@/server/redis'
import { leaderboardService } from '@/server/services/leaderboard'

const EXPECTED_QUERY_SECRET = env.WEBHOOK_QUERY_SECRET

type WebhookPlayer = {
  id?: string | number
  user_id?: string | number
}

type WebhookPayload = {
  action?: string
  new_players?: WebhookPlayer[]
  players?: WebhookPlayer[]
  players_removed?: WebhookPlayer[]
  queueId?: string | number
  teamResults?: {
    teams?: Array<{
      players?: WebhookPlayer[]
    }>
  }
}

/**
 * Verifies the secret from the query parameter.
 */
function verifyQuerySecret(req: NextRequest): boolean {
  if (!EXPECTED_QUERY_SECRET) {
    console.error(
      'Webhook query secret is not configured in environment variables.'
    )
    return false
  }

  const providedSecret = req.headers.get('Authorization')?.split('Bearer ')[1]

  if (!providedSecret) {
    console.warn('Auth token is missing.')
    return false
  }

  const expectedBuffer = Buffer.from(EXPECTED_QUERY_SECRET, 'utf8')
  const providedBuffer = Buffer.from(providedSecret, 'utf8')

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    console.warn('Invalid query secret provided.')
    return false
  }

  console.log('Query secret verified successfully.')
  return true
}

/**
 * Handles POST requests to the /api/webhooks endpoint.
 * Verifies query secret, logs payload, and handles actions.
 */
export async function POST(req: NextRequest) {
  try {
    const isVerified = verifyQuerySecret(req)
    if (!isVerified) {
      console.log('Webhook verification failed (query secret).')
      return NextResponse.json(
        { message: 'Unauthorized: Invalid or missing secret' },
        { status: 401 }
      )
    }

    const payload = (await req.json()) as WebhookPayload

    switch (payload.action) {
      case 'JOIN_QUEUE': {
        const state: PlayerState = {
          status: 'queuing',
          queueStartTime: Date.now(),
        }
        const userId = payload.new_players?.[0]?.id
        if (!userId) {
          console.error('JOIN_QUEUE missing player ID', payload)
          break
        }
        const normalizedUserId = String(userId)
        console.log('-----JOIN QUEUE-----')
        console.dir(payload, { depth: null })
        console.log(normalizedUserId)
        await redis.set(
          PLAYER_STATE_KEY(normalizedUserId),
          JSON.stringify(state)
        )
        globalEmitter.emit(`state-change:${normalizedUserId}`, state)
        break
      }

      case 'MATCH_STARTED': {
        const playerIds =
          payload.players
            ?.map((player) => player.id)
            .filter((playerId): playerId is string | number => playerId != null)
            .map(String) ?? []

        await Promise.all(
          playerIds.map(async (id) => {
            const state = {
              status: 'in_game',
              currentMatch: {
                opponentId: playerIds.find((p) => p !== id),
                startTime: Date.now(),
              },
            }
            await redis.set(PLAYER_STATE_KEY(id), JSON.stringify(state))
            globalEmitter.emit(`state-change:${id}`, state)
          })
        )
        globalEmitter.emit('active-matches-count-change')
        break
      }

      case 'MATCH_COMPLETED': {
        const queueId = payload.queueId ? String(payload.queueId) : null
        if (!queueId) {
          console.error('MATCH_COMPLETED missing queue ID', payload)
          break
        }

        const playerIds =
          payload.teamResults?.teams?.flatMap((team) =>
            (team?.players ?? [])
              .map((player) => String(player?.user_id ?? player?.id ?? ''))
              .filter(Boolean)
          ) ?? []

        console.log('MATCH_COMPLETED refreshing leaderboard', {
          queueId,
          playerCount: playerIds.length,
        })
        await leaderboardService.refreshLeaderboard(queueId)

        if (!playerIds.length) {
          console.error(
            'MATCH_COMPLETED missing player IDs for state cleanup',
            payload
          )
          break
        }

        await Promise.all(
          playerIds.map(async (id: string) => {
            await redis.del(PLAYER_STATE_KEY(id))
            globalEmitter.emit(`state-change:${id}`, { status: 'idle' })
          })
        ).catch(console.error)
        globalEmitter.emit('active-matches-count-change')

        break
      }

      case 'LEAVE_QUEUE': {
        const userId = payload.players_removed?.[0]?.id
        if (!userId) {
          console.error('LEAVE_QUEUE missing player ID', payload)
          break
        }
        const normalizedUserId = String(userId)
        await redis.del(PLAYER_STATE_KEY(normalizedUserId))
        globalEmitter.emit(`state-change:${normalizedUserId}`, {
          status: 'idle',
        })
        break
      }
    }

    console.log(
      '--- Verified Webhook Received (Auth) ---',
      new Date().toISOString(),
      '---\n',
      JSON.stringify(payload, null, 2),
      '\n--- End Webhook ---'
    )

    console.log(
      `Action: ${payload?.action || 'Unknown'}. Sending generic success response.`
    )
    return NextResponse.json(
      { message: 'Webhook received successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('!!! Error processing webhook:', error)
    try {
      // Attempt to read body on error
      const errorBody = await req.clone().text()
      console.error('Raw request body on error:', errorBody)
    } catch (bodyError) {
      console.error('Could not read raw request body on error:', bodyError)
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: 'Invalid JSON payload' },
        { status: 400 }
      )
    }
    if (
      error instanceof Error &&
      error.message.includes('Webhook query secret is not configured')
    ) {
      return NextResponse.json(
        { message: 'Internal Server Error: Webhook secret not configured' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'Internal Server Error processing webhook' },
      { status: 500 }
    )
  }
}

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    { message: 'Method Not Allowed. Please use POST.' },
    { status: 405 }
  )
}
