import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === 'production'
        ? z.string()
        : z.string().optional(),
    AUTH_DISCORD_ID: z.string(),
    CRON_SECRET: z.string(),
    AUTH_DISCORD_SECRET: z.string(),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    WEBHOOK_QUERY_SECRET: z.string(),
    MINIO_ENDPOINT: z.string(),
    MINIO_ACCESS_KEY: z.string(),
    MINIO_SECRET_KEY: z.string(),
    MINIO_BUCKET_NAME: z.string(),
    MINIO_LEADERBOARD_BUCKET_NAME: z.string(),
    MINIO_USE_SSL: z.enum(['true', 'false']).default('false'),
    LOG_DEDUPE_BYPASS: z.enum(['true', 'false']).optional(),
    API_TOKEN: z.string(),
    DISCORD_BOT_TOKEN: z.string(),
    SEED_URL: z.string().url(),
    SEED_API_KEY: z.string(),
    VERCEL_URL: z.string().optional(),
    PORT: z.string().optional(),
    IS_PREVIEW: z.string().optional(),
  },

  /**
   * Shared variables available on both client and server (e.g. NODE_ENV).
   */
  shared: {
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_API_URL: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    NODE_ENV: process.env.NODE_ENV,
    CRON_SECRET: process.env.CRON_SECRET,
    WEBHOOK_QUERY_SECRET: process.env.WEBHOOK_QUERY_SECRET,
    MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
    MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
    MINIO_BUCKET_NAME: process.env.MINIO_BUCKET_NAME,
    MINIO_LEADERBOARD_BUCKET_NAME: process.env.MINIO_LEADERBOARD_BUCKET_NAME,
    MINIO_USE_SSL: process.env.MINIO_USE_SSL,
    LOG_DEDUPE_BYPASS: process.env.LOG_DEDUPE_BYPASS,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    API_TOKEN: process.env.API_TOKEN,
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    SEED_URL: process.env.SEED_URL,
    SEED_API_KEY: process.env.SEED_API_KEY,
    VERCEL_URL: process.env.VERCEL_URL,
    PORT: process.env.PORT,
    IS_PREVIEW: process.env.IS_PREVIEW,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
})
