import { eq } from 'drizzle-orm'
import { env } from '@/env'
import { db } from '../db'
import { transcripts } from '../db/schema'
import { redis } from '../redis'

const BOTLATRO_URL = 'http://balatro.virtualized.dev:4931/'
const TRANSCRIPT_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7
const GUILD_MEMBER_SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24
const GUILD_MEMBER_CACHE_TTL_SECONDS = 60 * 60 * 24

export const TRANSCRIPT_CACHE_KEY = (gameNumber: number) =>
  `transcript:${gameNumber}`
export const GUILD_MEMBER_SEARCH_CACHE_KEY = (query: string) =>
  `discord:guild-member-search:${query.toLowerCase()}`
export const GUILD_MEMBER_CACHE_KEY = (user_id: string) =>
  `discord:guild-member:${user_id}`

async function botlatroAuthedRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${env.API_TOKEN}`)

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const url = `${BOTLATRO_URL}${path}`
  console.log(`[botlatro] ${init.method ?? 'GET'} ${url}`)
  console.log(`[botlatro] Token: ${env.API_TOKEN?.slice(0, 8)}...`)

  const response = await fetch(url, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const body = await response.text()
    console.error(
      `[botlatro] ${response.status} ${response.statusText}: ${body}`
    )
    throw new Error(`HTTP Error: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
}

type GuildMemberUser = {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  active_ban: ModerationBan | null
}

export type TranscriptLobbyCodeSearchPlayer = {
  user_id: string
  display_name: string | null
  team: number | null
}

export type TranscriptLobbyCodeSearchResult = {
  match_id: number
  created_at: string
  queue_name: string | null
  matched_codes: string[]
  lobby_codes: string[]
  players: TranscriptLobbyCodeSearchPlayer[]
}

type TranscriptLobbyCodeSearchResponse = {
  success: true
  normalized_query: string
  mode: 'exact' | 'prefix'
  results: TranscriptLobbyCodeSearchResult[]
}

export const botlatro_service = {
  getUser: async (user_id: string): Promise<GuildMemberUser> => {
    const cacheKey = GUILD_MEMBER_CACHE_KEY(user_id)
    const cached = await redis.get(cacheKey)
    if (cached) {
      return JSON.parse(cached) as GuildMemberUser
    }
    const member = await botlatroAuthedRequest<GuildMemberUser>(
      `api/users/${encodeURIComponent(user_id)}`
    )
    await redis.setEx(
      cacheKey,
      GUILD_MEMBER_CACHE_TTL_SECONDS,
      JSON.stringify(member)
    )
    return member
  },

  getQueueSettings: async (): Promise<QueueSettings[]> => {
    const result = await botlatroAuthedRequest<{ queues: QueueSettings[] }>(
      'api/queues/settings'
    )
    return result.queues
  },

  updateQueueSettings: async (
    id: number,
    settings: Partial<Omit<QueueSettings, 'id' | 'queue_name'>>
  ): Promise<QueueSettings> => {
    const result = await botlatroAuthedRequest<{
      success: boolean
      queue: QueueSettings
    }>(`api/queues/settings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    })
    return result.queue
  },

  lockAllQueues: async (
    moderatorId: string
  ): Promise<{ success: boolean; count: number }> => {
    return botlatroAuthedRequest<{ success: boolean; count: number }>(
      'api/queues/lock-all',
      {
        method: 'POST',
        body: JSON.stringify({ moderatorId }),
      }
    )
  },

  get_active_matches: async (): Promise<ActiveMatchQueue[]> => {
    const response = await fetch(`${BOTLATRO_URL}api/matches/active-counts`, {
      headers: {
        Authorization: `Bearer ${env.API_TOKEN}`,
      },
    })
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`)
    }
    const data = (await response.json()) as { queues: ActiveMatchQueue[] }
    return data.queues
  },
  get_leaderboard: async (queue_id: string, season?: number) => {
    const params = new URLSearchParams({ limit: '100000' })
    if (season !== undefined) {
      params.set('season', season.toString())
    }
    const response = await fetch(
      `${BOTLATRO_URL}api/stats/leaderboard/${queue_id}?${params}`
    )
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`)
    }
    const res = (await response.json()) as LeaderboardResponse

    res.leaderboard.sort((a, b) => b.mmr - a.mmr)

    const fixed: Array<LeaderboardEntry> = res.leaderboard.map(
      (entry, _idx) => ({
        ...entry,
        rank: entry.rank,
        id: entry.id,
        name: entry.name ?? `User: ${entry.id}`,
        totalgames: entry.wins + entry.losses,
        winrate:
          entry.wins + entry.losses > 0
            ? entry.wins / (entry.wins + entry.losses)
            : 0,
      })
    )

    return fixed
  },
  get_player_matches: async ({
    userId,
    queueId,
    limit,
  }: {
    userId: string
    limit?: number
    queueId?: string
  }) => {
    try {
      const params = new URLSearchParams()
      if (limit) {
        params.set('limit', limit.toString())
      }
      if (queueId) params.set('queue_id', queueId)

      const url = `${BOTLATRO_URL}api/players/${userId}/matches${params.toString() ? `?${params.toString()}` : ''}`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`)
      }
      const data = (await response.json()) as PlayerMatchesResponse

      return data.matches
    } catch (error) {
      console.error(`Error fetching history for user ${userId}:`, error)
      return []
    }
  },

  get_transcript: async (gameNumber: number) => {
    const cacheKey = TRANSCRIPT_CACHE_KEY(gameNumber)
    const cachedTranscript = await redis.get(cacheKey)

    if (cachedTranscript) {
      console.log(`Transcript #${gameNumber} found in Redis cache`)
      return cachedTranscript
    }

    const dbTranscript = await db.query.transcripts.findFirst({
      where: eq(transcripts.gameNumber, gameNumber),
    })

    if (dbTranscript) {
      console.log(`Transcript #${gameNumber} found in database`)
      await redis.setEx(
        cacheKey,
        TRANSCRIPT_CACHE_TTL_SECONDS,
        dbTranscript.content
      )
      return dbTranscript.content
    }

    console.log(`Fetching transcript #${gameNumber} from neatqueue`)
    try {
      const response = await fetch(
        `${BOTLATRO_URL}api/transcripts/view/${gameNumber}`,
        {
          headers: {
            Authorization: `Bearer ${env.API_TOKEN}`,
          },
        }
      )
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`)
      }
      const res = (await response.json()) as {
        success: boolean
        transcript: string
      }

      if (!res.success || !res.transcript) {
        return null
      }

      const data = res.transcript

      await db
        .insert(transcripts)
        .values({
          gameNumber,
          content: data,
        })
        .onConflictDoUpdate({
          target: transcripts.gameNumber,
          set: { content: data },
        })

      await redis.setEx(cacheKey, TRANSCRIPT_CACHE_TTL_SECONDS, data)
      return data
    } catch (error) {
      console.error(`Error fetching transcript #${gameNumber}:`, error)
      throw error
    }
  },

  search_transcript_lobby_codes: async ({
    query,
    limit = 50,
  }: {
    query: string
    limit?: number
  }) => {
    const params = new URLSearchParams({
      query,
      limit: limit.toString(),
    })

    return botlatroAuthedRequest<TranscriptLobbyCodeSearchResponse>(
      `api/transcripts/lobby-codes/search?${params.toString()}`
    )
  },

  listPlayersWithStrikes: async ({
    page = 1,
    limit = 20,
    search,
    sort = 'recent',
    include_bans = false,
  }: ModerationPlayerListInput = {}) => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      sort,
    })

    if (search?.trim()) {
      params.set('search', search.trim())
    }

    if (include_bans) {
      params.set('include_bans', 'true')
    }

    return botlatroAuthedRequest<ModerationPlayersResponse>(
      `api/moderation/strikes?${params.toString()}`
    )
  },

  getUserStrikes: async (user_id: string) => {
    return botlatroAuthedRequest<ModerationPlayerResponse>(
      `api/moderation/strikes/${encodeURIComponent(user_id)}`
    )
  },

  giveStrike: async (input: GiveStrikeInput) => {
    return botlatroAuthedRequest<GiveStrikeResponse>('api/moderation/strikes', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  removeStrike: async ({ id, ...input }: RemoveStrikeInput) => {
    return botlatroAuthedRequest<ModerationMutationSuccess>(
      `api/moderation/strikes/${id}`,
      {
        method: 'DELETE',
        body: JSON.stringify(input),
      }
    )
  },

  listActiveBans: async ({
    page = 1,
    limit = 20,
    search,
  }: ModerationBanListInput = {}) => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    })

    if (search?.trim()) {
      params.set('search', search.trim())
    }

    return botlatroAuthedRequest<ModerationPlayersResponse>(
      `api/moderation/bans?${params.toString()}`
    )
  },

  banUser: async (input: BanUserInput) => {
    return botlatroAuthedRequest<BanUserResponse>('api/moderation/bans', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  updateBanUser: async ({ user_id, ...input }: UpdateBanUserInput) => {
    return botlatroAuthedRequest<BanUserResponse>(
      `api/moderation/bans/${encodeURIComponent(user_id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    )
  },

  unbanUser: async ({ user_id, ...input }: UnbanUserInput) => {
    return botlatroAuthedRequest<ModerationMutationSuccess>(
      `api/moderation/bans/${encodeURIComponent(user_id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify(input),
      }
    )
  },

  listAllMembers: async ({
    page = 1,
    limit = 20,
    search,
    filter = 'all',
    sort = 'alphabetical',
  }: ModerationMembersListInput = {}) => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      filter,
      sort,
    })

    if (search?.trim()) {
      params.set('search', search.trim())
    }

    return botlatroAuthedRequest<ModerationPlayersResponse>(
      `api/moderation/members?${params.toString()}`
    )
  },

  searchGuildMembers: async (query: string) => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return [] as ModerationUser[]
    }

    const cacheKey = GUILD_MEMBER_SEARCH_CACHE_KEY(normalizedQuery)
    const cached = await redis.get(cacheKey)

    if (cached) {
      return JSON.parse(cached) as ModerationUser[]
    }

    const result = await botlatroAuthedRequest<GuildMemberSearchResponse>(
      `api/moderation/users/search?q=${encodeURIComponent(normalizedQuery)}`
    )

    await redis.setEx(
      cacheKey,
      GUILD_MEMBER_SEARCH_CACHE_TTL_SECONDS,
      JSON.stringify(result.data)
    )

    return result.data
  },

  sendWarning: async (input: WarningInput) => {
    return botlatroAuthedRequest<MonitoringSuccess>('api/monitoring/warning', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  get_user_bounties: async (user_id: string): Promise<UserBounty[]> => {
    const result = await botlatroAuthedRequest<{ bounties: UserBounty[] }>(
      `api/bounties/user/${encodeURIComponent(user_id)}`
    )
    return result.bounties
  },

  get_bounty_completions: async (
    bounty_name: string
  ): Promise<BountyCompletionsResponse> => {
    return botlatroAuthedRequest<BountyCompletionsResponse>(
      `api/bounties/${encodeURIComponent(bounty_name)}/completions`
    )
  },
}

export type QueueSettings = {
  id: number
  queue_name: string
  queue_desc: string
  queue_icon: string | null
  color: string
  default_elo: number
  members_per_team: number
  number_of_teams: number
  elo_search_start: number
  elo_search_increment: number
  elo_search_speed: number
  max_party_elo_difference: number | null
  best_of_allowed: boolean
  first_deck_ban_num: number
  second_deck_ban_num: number
  use_tuple_bans: boolean
  role_lock_id: string | null
  veto_mmr_threshold: number | null
  instaqueue_min: number
  instaqueue_max: number
  locked: boolean
}

export type LeaderboardEntry = {
  id: string
  name: string
  mmr: number
  wins: number
  losses: number
  streak: number
  totalgames: number
  decay?: number
  ign?: string
  peak_mmr: number
  peak_streak: number
  rank: number
  winrate: number
}

export type LeaderboardResponse = {
  leaderboard: LeaderboardEntry[]
}

export type PlayerMatch = {
  match_id: number
  player_name: string
  player_id: string
  queue_id: number
  mmr_after: number
  won: boolean
  elo_change: number
  team: number
  opponents: Array<Opponent>
  deck: string | null
  stake: string | null
  best_of_3: boolean
  best_of_5: boolean
  created_at: string
  winning_team: number
}

export type PlayerMatchesResponse = {
  matches: PlayerMatch[]
}

export type Opponent = {
  user_id: string
  name: string
  team: number
  elo_change: number
  mmr_after: number
}

export type ActiveMatchQueue = {
  queue_id: number
  queue_name: string
  active_matches: number
  players_in_queue: number
}

export type ModerationUser = {
  discord_id: string
  username: string
  display_name: string
  avatar_url: string | null
}

export type ModerationBan = {
  id: number
  user_id: string
  reason: string
  expires_at: string | null
  related_strike_ids: number[] | null
  allowed_queue_ids: number[] | null
}

export type ModerationStrike = {
  id: number
  user_id: string
  reason: string
  issued_by_id: string
  issued_at: string
  expires_at: string | null
  amount: number
  reference: string
  issued_by: ModerationUser | null
}

export type ModerationPlayer = ModerationUser & {
  strikes: ModerationStrike[]
  active_ban: ModerationBan | null
  total_strike_points: number
  latest_strike_at: string | null
}

export type ModerationPlayersResponse = {
  data: ModerationPlayer[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export type ModerationPlayerResponse = {
  player: ModerationPlayer
}

export type ModerationPlayerListInput = {
  page?: number
  limit?: number
  search?: string
  sort?: 'recent' | 'alphabetical'
  include_bans?: boolean
}

export type ModerationBanListInput = {
  page?: number
  limit?: number
  search?: string
}

export type ModerationMembersListInput = {
  page?: number
  limit?: number
  search?: string
  filter?: 'all' | 'banned' | 'striked'
  sort?: 'recent' | 'alphabetical'
}

export type GiveStrikeInput = {
  user_id: string
  amount: number
  reason: string
  reference?: string
  issued_by_id: string
}

export type GiveStrikeResponse = {
  strike: ModerationStrike
}

export type RemoveStrikeInput = {
  id: number
  removed_by_id: string
  reason?: string
}

export type BanUserInput = {
  user_id: string
  length: number
  reason: string
  banned_by_id: string
}

export type BanUserResponse = {
  ban: ModerationBan
}

export type UpdateBanUserInput = {
  user_id: string
  updated_by_id: string
  length?: number
  reason?: string
}

export type UnbanUserInput = {
  user_id: string
  unbanned_by_id: string
  reason: string
}

export type ModerationMutationSuccess = {
  success: true
}

export type GuildMemberSearchResponse = {
  data: ModerationUser[]
}

export type WarningInput = {
  title: string
  lines: string[]
}

export type MonitoringSuccess = {
  success: true
}

export type UserBounty = {
  id: number
  bounty_id: number
  user_id: string
  is_first: boolean
  completed_at: string
  bounty_name: string
  description: string
}

export type BountyCompletion = {
  id: number
  bounty_id: number
  user_id: string
  display_name: string
  is_first: boolean
  completed_at: string
}

export type BountyCompletionsResponse = {
  bounty: {
    id: number
    bounty_name: string
    description: string
  }
  completions: BountyCompletion[]
}
