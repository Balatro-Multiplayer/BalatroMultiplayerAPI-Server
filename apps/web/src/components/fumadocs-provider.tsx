'use client'

import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'

export function FumadocsProvider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      // The site is dark-only; keep the root layout's hardcoded class.
      theme={{ enabled: false }}
      // A preloaded search footer is streamed in a lazy Suspense boundary.
      // An early modal (e.g. the saved-game prompt) can aria-hide it before
      // hydration. Mount search on demand instead, keeping modal accessibility.
      search={{ preload: false }}
    >
      {children}
    </RootProvider>
  )
}
