import '@/styles/globals.css'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { BalatroBackground } from '@/components/balatro-background'
import { QueryProvider } from '@/components/query-provider'
import { Toaster } from '@/components/ui/sonner'

export const metadata: Metadata = {
  title: {
    template: '%s | Balatro Multiplayer',
    default: 'Balatro Multiplayer',
  },
  description:
    'The unofficial multiplayer mod for Balatro. Challenge your friends, compete in ranked matches, and climb the leaderboards.',
  icons: [{ rel: 'icon', url: '/favicon.ico' }],
}

const m6x11 = localFont({
  src: './_assets/fonts/m6x11.ttf',
  display: 'swap',
  variable: '--font-m6x11',
})

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang='en' className={`${m6x11.variable} dark`} suppressHydrationWarning>
      <body>
        <BalatroBackground />
        <div className='relative z-10'>
          <Toaster />
          <QueryProvider>
            <NuqsAdapter>
              <RootProvider>{children}</RootProvider>
            </NuqsAdapter>
          </QueryProvider>
        </div>
      </body>
    </html>
  )
}
