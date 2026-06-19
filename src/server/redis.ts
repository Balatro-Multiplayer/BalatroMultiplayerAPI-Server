import { createClient } from 'redis'
import { env } from '@/env'

const client = createClient({ url: env.REDIS_URL })
client.on('error', (err) => console.error('Redis Client Error', err))
await client.connect()

export const redis = client

export const PLAYER_STATE_KEY = (userId: string) => `player:${userId}:state`
setInterval(() => {
  console.log(
    'redis listeners',
    redis.listenerCount('end'),
    redis.listenerCount('error')
  )
}, 30000)
