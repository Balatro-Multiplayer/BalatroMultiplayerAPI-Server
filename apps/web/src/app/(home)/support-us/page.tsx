import {
  Bot,
  CircleDollarSign,
  Coffee,
  ExternalLink,
  Heart,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ContentCard, PageHeader, PageShell } from '@/components/page-kit'
import { createMetadata } from '@/lib/metadata'

export const metadata = createMetadata({
  title: 'Support Us',
  description:
    'Support Balatro Multiplayer, the website, and Botlatro to help fund hosting, development, and community tools.',
  path: '/support-us',
})

type KofiLink = { href: string; label: string }

const CAUSES: Array<{
  icon: ReactNode
  title: string
  lead: string
  body: string
  links: KofiLink[]
}> = [
  {
    icon: <Coffee className='size-5' />,
    title: 'Multiplayer mod',
    lead: 'Help fund the development of the Balatro Multiplayer Mod.',
    body: 'Your contribution helps us add new features, fix bugs, and maintain the multiplayer experience for everyone.',
    links: [
      {
        href: 'https://ko-fi.com/virtualized/shop',
        label: 'Support on Ko-fi',
      },
    ],
  },
  {
    icon: <Heart className='size-5' />,
    title: 'This website',
    lead: 'Help fund the development and hosting of this website.',
    body: 'Your contribution helps us improve the website, add new features, and keep the servers running smoothly.',
    links: [
      {
        href: 'https://ko-fi.com/andy_balatro',
        label: 'Support Andy on Ko-fi',
      },
      {
        href: 'https://ko-fi.com/jeffdev',
        label: 'Support Jeffdev on Ko-fi',
      },
    ],
  },
  {
    icon: <Bot className='size-5' />,
    title: 'Discord bot',
    lead: 'Help fund the development of the Botlatro Discord bot.',
    body: 'Your contribution helps support the developers who maintain and improve Botlatro, which runs the queue in Discord.',
    links: [{ href: 'https://ko-fi.com/botlatro', label: 'Support on Ko-fi' }],
  },
]

export default function SupportUsPage() {
  return (
    <PageShell>
      <PageHeader
        title='Support Us'
        meta='Your support helps us keep developing and maintaining Balatro Multiplayer.'
      />

      <div className='grid gap-4 md:grid-cols-3'>
        {CAUSES.map((c) => (
          <section
            key={c.title}
            className='flex flex-col gap-3 rounded-lg border border-border bg-card/80 p-4'
          >
            <div className='flex items-center gap-3'>
              <span className='rounded-full bg-primary/10 p-2 text-primary'>
                {c.icon}
              </span>
              <h2 className='font-pixel text-lg uppercase tracking-wide'>
                {c.title}
              </h2>
            </div>
            <p className='font-medium text-sm'>{c.lead}</p>
            <p className='text-muted-foreground text-sm'>{c.body}</p>
            <div className='mt-auto flex flex-wrap gap-2 pt-2'>
              {c.links.map((l) => (
                <Link
                  key={l.href}
                  target='_blank'
                  rel='noopener noreferrer'
                  href={l.href}
                  className='inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90'
                >
                  {l.label} <ExternalLink className='size-4' />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <ContentCard
        title={
          <span className='inline-flex items-center gap-2'>
            <CircleDollarSign className='size-5 text-primary' />
            Why your support matters
          </span>
        }
      >
        <p className='max-w-2xl text-muted-foreground text-sm'>
          Balatro Multiplayer is a community-driven project maintained by
          volunteers. Your support directly contributes to server costs,
          development time, and the continued improvement of the multiplayer
          experience for all players.
        </p>
      </ContentCard>
    </PageShell>
  )
}
