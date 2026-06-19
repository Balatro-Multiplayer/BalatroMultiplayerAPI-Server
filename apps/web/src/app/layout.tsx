import '@/styles/globals.css'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import localFont from 'next/font/local'
import { SessionProvider } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import PlausibleProvider from 'next-plausible'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import CustomSearchDialog from '@/app/_components/custom-search-dialog'
import { Toaster } from '@/components/ui/sonner'
import { TRPCReactProvider } from '@/trpc/react'
import { siteConfig } from '../../lib/metadata'
export const metadata: Metadata = {
  title: {
    template: `%s | ${siteConfig.name}`,
    default: siteConfig.name,
  },
  description: siteConfig.description,
  metadataBase: new URL(siteConfig.url),
  openGraph: {
    title: siteConfig.name,
    description: siteConfig.description,
    url: '/',
    siteName: siteConfig.name,
    locale: 'en_US',
    type: 'website',
    images: [siteConfig.ogImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
  },
  icons: [{ rel: 'icon', url: '/favicon.ico' }],
}

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

const m6x11 = localFont({
  src: './_assets/fonts/m6x11.ttf',
  display: 'swap',
  variable: '--font-m6x11',
})

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale()
  return (
    <html
      lang={locale}
      className={`${geist.variable} ${m6x11.variable}`}
      suppressHydrationWarning
    >
      <head>
        <title />
        <PlausibleProvider
          src='https://plausible.balatromp.com/js/script.file-downloads.outbound-links.js'
          init={{ captureOnLocalhost: false }}
        />
      </head>
      <body className={'flex min-h-screen flex-col'}>
        <Toaster />
        {/*<Banner id={'v0.2.4'} variant={'rainbow'}>*/}
        {/*  Version 0.2.4 is out!*/}
        {/*  <a*/}
        {/*    className={'ml-[1ch] underline'}*/}
        {/*    href={*/}
        {/*      'https://discord.com/channels/1226193436521267223/1228517235744833566/1360058191777501366'*/}
        {/*    }*/}
        {/*  >*/}
        {/*    Learn more in our Discord server.*/}
        {/*  </a>*/}
        {/*</Banner>*/}
        <TRPCReactProvider>
          <NextIntlClientProvider>
            <SessionProvider>
              <NuqsAdapter>
                <RootProvider
                  search={{
                    SearchDialog: CustomSearchDialog,
                  }}
                >
                  {children}
                </RootProvider>
              </NuqsAdapter>
            </SessionProvider>
          </NextIntlClientProvider>
        </TRPCReactProvider>
      </body>
    </html>
  )
}
