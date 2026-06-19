import { bannedUsersRouter } from '@/server/api/routers/banned-users'
import { blogRouter } from '@/server/api/routers/blog'
import { bountiesRouter } from '@/server/api/routers/bounties'
import { branchesRouter } from '@/server/api/routers/branches'
import { history_router } from '@/server/api/routers/history'
import { leaderboard_router } from '@/server/api/routers/leaderboard'
import { logsRouter } from '@/server/api/routers/logs'
import { moderationRouter } from '@/server/api/routers/moderation'
import { playerStateRouter } from '@/server/api/routers/player-state'
import { playersRouter } from '@/server/api/routers/players'
import { profileRouter } from '@/server/api/routers/profile'
import { queuesRouter } from '@/server/api/routers/queues'
import { releasesRouter } from '@/server/api/routers/releases'
import { seasonsRouter } from '@/server/api/routers/seasons'
import { stats_router } from '@/server/api/routers/stats'
import { usersRouter } from '@/server/api/routers/users'
import { createCallerFactory, createTRPCRouter } from '@/server/api/trpc'

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  bannedUsers: bannedUsersRouter,
  blog: blogRouter,
  bounties: bountiesRouter,
  branches: branchesRouter,
  history: history_router,
  players: playersRouter,
  queues: queuesRouter,
  leaderboard: leaderboard_router,
  logs: logsRouter,
  moderation: moderationRouter,
  playerState: playerStateRouter,
  profile: profileRouter,
  releases: releasesRouter,
  seasons: seasonsRouter,
  stats: stats_router,
  users: usersRouter,
})

// export type definition of API
export type AppRouter = typeof appRouter

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter)
