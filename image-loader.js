//@ts-nocheck
const cdnUrl = 'https://balatromp.b-cdn.net'

// For production builds, we use a deterministic buildId based on the build time
// This ensures all images in a single build use the same cache key
// In development, we use a random value to prevent caching during development
const buildId =
  process.env.NODE_ENV === 'production'
    ? process.env.BUILD_ID ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      Date.now().toString()
    : Date.now().toString() + Math.random().toString(36).substring(2, 15)

export default function bunnyLoader({ src, width, quality }) {
  const params = new URLSearchParams()
  params.set('width', width.toString())
  params.set('quality', (quality || 100).toString())

  if (process.env.NODE_ENV === 'development') {
    return `${src}${src.includes('?') ? '&' : '?'}${params.toString()}`
  }

  if (!cdnUrl) {
    throw new Error('missing NEXT_PUBLIC_CDN_URL env variable.')
  }

  // Add buildId as a query parameter for cache invalidation
  // This ensures each new build will have different URLs, forcing the CDN to fetch fresh content
  params.set('v', buildId)

  // For BunnyCDN, we can add a cache-control hint
  // This tells the CDN to cache the image for a long time (1 year)
  // Since we have the version parameter, we can safely cache for a long time
  params.set('maxage', '31536000') // 1 year in seconds

  // Return the URL with cache parameters
  return `${cdnUrl}${src}?${params.toString()}`
}
