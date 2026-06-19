import { z } from 'zod'
import { env } from '@/env'
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc'

export async function fetchCocktailDecks(seed: string, config: string) {
  const url = new URL('/cocktail', env.SEED_URL)
  url.searchParams.set('seed', seed)
  url.searchParams.set('config', config)

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${env.SEED_API_KEY}`,
    },
  }).catch(() => null)

  if (!response?.ok) {
    return null
  }

  const payload = (await response.json().catch(() => null)) as {
    decks?: unknown
  } | null

  if (!Array.isArray(payload?.decks)) {
    return null
  }

  const decks = payload.decks.filter(
    (deck): deck is string => typeof deck === 'string' && deck.length > 0
  )

  return decks.length > 0 ? decks : null
}

export const logsRouter = createTRPCRouter({
  resolveCocktailDecks: publicProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            gameId: z.number().int(),
            seed: z.string().min(1),
            config: z.string().min(1),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const requestCache = new Map<string, Promise<string[] | null>>()

      const results = await Promise.all(
        input.items.map(async (item) => {
          const cacheKey = `${item.seed}:${item.config}`
          let request = requestCache.get(cacheKey)

          if (!request) {
            request = fetchCocktailDecks(item.seed, item.config)
            requestCache.set(cacheKey, request)
          }

          return {
            gameId: item.gameId,
            decks: await request,
          }
        })
      )

      return {
        results: results.filter(
          (result): result is { gameId: number; decks: string[] } =>
            Array.isArray(result.decks) && result.decks.length > 0
        ),
      }
    }),
})
