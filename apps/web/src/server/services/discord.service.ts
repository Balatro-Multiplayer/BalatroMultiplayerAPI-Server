import { env } from '@/env'
import { redis } from '@/server/redis'
import { isDiscordSnowflake } from '@/shared/discord'

const DISCORD_URL = 'https://discord.com/api/v10'
const CACHE_TTL = 60 * 60 * 24 // 24 hours in seconds

async function fetchWithRetry(
  url: string,
  options: RequestInit & { retryLimit?: number } = {}
): Promise<Response> {
  const { retryLimit = 3, ...fetchOptions } = options
  const response = await fetch(url, fetchOptions)

  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after')
    const delayMs = retryAfter ? Number.parseFloat(retryAfter) * 1000 : 1000
    console.log(
      `[Discord] Rate limited, waiting ${delayMs}ms before retry. URL: ${url}`
    )
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return fetchWithRetry(url, { ...options, retryLimit: retryLimit - 1 })
  }

  // Retry on server errors
  if ([500, 502, 503, 504].includes(response.status) && retryLimit > 0) {
    return fetchWithRetry(url, { ...options, retryLimit: retryLimit - 1 })
  }

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status} ${response.statusText}`)
  }

  return response
}

export type DiscordUser = {
  id: string
  username: string
  avatar: string
  discriminator: string
  public_flags: number
  flags: number
  banner?: unknown
  accent_color?: unknown
  global_name: string
  avatar_decoration_data?: unknown
  collectibles?: unknown
  banner_color?: unknown
  clan?: unknown
  primary_guild?: unknown
}

export const discord_service = {
  get_user_by_id: async (user_id: string) => {
    if (!isDiscordSnowflake(user_id)) {
      throw new Error('Invalid Discord user ID')
    }

    const cache_key = `discord:user:${user_id}`

    // Try to get from cache
    const cached = await redis.get(cache_key)
    if (cached) {
      return JSON.parse(cached) as DiscordUser & { avatar_url: string }
    }

    // Fetch from Discord API
    const encodedUserId = encodeURIComponent(user_id)
    const res = await fetchWithRetry(`${DISCORD_URL}/users/${encodedUserId}`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
    })
    const res_json = (await res.json()) as DiscordUser

    const avatar_url = res_json.avatar
      ? `https://cdn.discordapp.com/avatars/${user_id}/${res_json.avatar}.png`
      : 'https://cdn.discordapp.com/embed/avatars/0.png'

    const user_data = {
      ...res_json,
      avatar_url,
    }

    // Cache the result
    await redis.setEx(cache_key, CACHE_TTL, JSON.stringify(user_data))

    return user_data
  },
}
