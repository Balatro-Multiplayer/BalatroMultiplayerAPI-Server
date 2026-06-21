import Link from 'next/link'
import type { ReactNode } from 'react'
import { SiteHeader } from '@/components/site-header'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className='flex min-h-screen flex-col'>
      <SiteHeader />
      <main className='flex-1'>{children}</main>
      <footer className='border-t py-6 md:py-0'>
        <div className='container mx-auto flex flex-col items-center justify-between gap-4 md:h-16 md:flex-row'>
          <p className='text-center text-muted-foreground text-sm leading-loose md:text-left'>
            Balatro Multiplayer &mdash; not affiliated with LocalThunk or Playstack
          </p>
          <div className='flex gap-4'>
            <Link href='/notice' className='text-muted-foreground text-sm underline-offset-4 hover:underline'>
              Privacy &amp; Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
