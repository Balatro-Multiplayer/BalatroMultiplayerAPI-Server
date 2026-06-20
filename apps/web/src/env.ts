export const env = {
  NODE_ENV: process.env.NODE_ENV,
  IS_PREVIEW: process.env.IS_PREVIEW,
  API_SERVER_URL: process.env.API_SERVER_URL ?? 'http://localhost:8788',
  NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? '/api/proxy',
}
