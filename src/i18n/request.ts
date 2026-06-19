import { headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

export default getRequestConfig(async () => {
  // Provide a static locale, fetch a user setting,
  // read from `cookies()`, `headers()`, etc.
  const locale = (await headers()).get('accept-language')?.split(',')[0] ?? 'en'

  return {
    locale,
    messages: (await import('../../messages/en.json')).default,
  }
})
