'use client'

import { NextIntlClientProvider, useLocale } from 'next-intl'
import { useEffect, useState } from 'react'

export function TimeZoneProvider({ children }: { children: React.ReactNode }) {
  const [timeZone, setTimeZone] = useState<string>()
  const locale = useLocale()
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  }, [])

  return (
    <NextIntlClientProvider timeZone={timeZone} locale={locale}>
      {children}
    </NextIntlClientProvider>
  )
}
