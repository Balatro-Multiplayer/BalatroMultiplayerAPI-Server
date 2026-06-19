import { tracked } from '@trpc/server'
import { z } from 'zod'
import { createEventIterator, globalEmitter } from '@/lib/events'
import { redis } from '@/server/redis'
import { botlatro_service } from '@/server/services/botlatro.service'
import { createTRPCRouter, publicProcedure } from '../trpc'

export type PlayerState = {
  status: 'idle' | 'queuing' | 'in_game'
  queueStartTime?: number
  currentMatch?: {
    opponentId: string
    startTime: number
  }
}

const PLAYER_STATE_KEY = (userId: string) => `player:${userId}:state`

export const playerStateRouter = createTRPCRouter({
  getState: publicProcedure
    .input(z.string())
    .query(async ({ input: userId }) => {
      const state = await redis.get(PLAYER_STATE_KEY(userId))
      return state ? (JSON.parse(state) as PlayerState) : null
    }),
  onStateChange: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        lastEventId: z.string().optional(),
      })
    )
    .subscription(async function* ({ input, signal }) {
      const iterator = createEventIterator<PlayerState>(
        globalEmitter,
        `state-change:${input.userId}`,
        { signal: signal }
      )

      // get initial state
      const initialState = await redis.get(PLAYER_STATE_KEY(input.userId))
      if (initialState) {
        yield tracked('initial', JSON.parse(initialState) as PlayerState)
      }

      // listen for updates
      for await (const [state] of iterator) {
        yield tracked(Date.now().toString(), state)
      }
    }),
  getActiveMatches: publicProcedure.query(async () => {
    return botlatro_service.get_active_matches()
  }),
  onActiveMatchesChange: publicProcedure.subscription(async function* ({
    signal,
  }) {
    const iterator = createEventIterator<void>(
      globalEmitter,
      'active-matches-count-change',
      { signal }
    )
    yield tracked('initial', await botlatro_service.get_active_matches())
    for await (const _ of iterator) {
      yield tracked(
        Date.now().toString(),
        await botlatro_service.get_active_matches()
      )
    }
  }),
})
