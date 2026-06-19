/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */

import { createMDX } from 'fumadocs-mdx/next'
import createNextIntlPlugin from 'next-intl/plugin'
import './src/env.js'

const withMDX = createMDX()

function normalizeTurbopackConfig(nextConfig) {
  const { turbo: legacyTurbo, ...experimental } = nextConfig.experimental ?? {}
  if (!legacyTurbo) {
    return nextConfig
  }

  const normalizedConfig = {
    ...nextConfig,
    turbopack: {
      ...legacyTurbo,
      ...nextConfig.turbopack,
      resolveAlias: {
        ...legacyTurbo.resolveAlias,
        ...nextConfig.turbopack?.resolveAlias,
      },
      rules: {
        ...legacyTurbo.rules,
        ...nextConfig.turbopack?.rules,
      },
    },
  }

  if (Object.keys(experimental).length > 0) {
    normalizedConfig.experimental = experimental
  } else {
    normalizedConfig.experimental = undefined
  }

  return normalizedConfig
}
/** @type {import("next").NextConfig} */
const config = {
  output: 'standalone',
  images: {
    loader: 'custom',
    loaderFile: './image-loader.js',
    // Set minimumCacheTTL to a high value to ensure Next.js doesn't invalidate the cache too early
    minimumCacheTTL: 60 * 60 * 24 * 365, // 1 year in seconds
  },
  async redirects() {
    return [
      {
        source: '/games-per-hour',
        destination: '/stats?tab=game-activity',
        permanent: true,
      },
      {
        source: '/game-activity',
        destination: '/stats?tab=game-activity',
        permanent: true,
      },
      {
        source: '/rating-distribution',
        destination: '/stats?tab=rating-distribution',
        permanent: true,
      },
      {
        source: '/deck-popularity',
        destination: '/stats?tab=deck-popularity',
        permanent: true,
      },
      {
        source: '/stake-popularity',
        destination: '/stats?tab=stake-popularity',
        permanent: true,
      },
      {
        source: '/season-overview',
        destination: '/stats?tab=season-overview',
        permanent: true,
      },
    ]
  },
  // Generate a unique build ID for each build if not provided by the environment
  // This will be used for cache invalidation in the image loader
  generateBuildId: async () => {
    // Use existing build ID if available (e.g., from CI/CD)
    if (process.env.BUILD_ID) {
      return process.env.BUILD_ID
    }
    // Otherwise, use a timestamp
    return `build-${Date.now()}`
  },
}
const withNextIntl = createNextIntlPlugin()
export default normalizeTurbopackConfig(withNextIntl(withMDX(config)))
