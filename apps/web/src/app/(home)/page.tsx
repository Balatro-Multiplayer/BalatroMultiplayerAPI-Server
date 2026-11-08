import {
  ChevronRight,
  CircleArrowRightIcon,
  MessageSquare,
  Trophy,
  Users,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export const metadata = {
  title: 'Play Balatro Against Your Friends',
  description:
    'Download the Balatro Multiplayer mod, join ranked queues, and play direct matches with your friends.',
}

const FEATURES: Array<[title: string, text: string]> = [
  ['Real-time matches', 'Challenge friends to head-to-head Balatro matches.'],
  [
    'Tournaments',
    'Join our weekly tournaments and compete against other players.',
  ],
  [
    'Global leaderboards',
    'Compete for the highest scores and track your progress against players worldwide.',
  ],
  [
    'Active community',
    'Join our Discord server to find matches, share strategies, and take part in community events.',
  ],
  [
    'Custom game modes',
    'Play with modified rules and unique challenges created by the community.',
  ],
  ['Cross-platform', 'Play with friends on Windows, Mac, or Linux.'],
]

const STEPS: Array<[title: string, text: string]> = [
  [
    'Install the mod',
    'Download and install the multiplayer mod by following the instructions on our download page.',
  ],
  [
    'Start a match',
    'Host your own game or join an existing one with a simple game code.',
  ],
  [
    'Play together',
    'Compete in real time with synchronized gameplay and live scoring.',
  ],
]

function Card({
  title,
  icon,
  children,
  className = '',
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`space-y-2 rounded-lg border border-border bg-card/80 p-4 ${className}`}
    >
      <h3 className='flex items-center gap-2 font-pixel text-lg uppercase tracking-wide'>
        {icon && <span className='text-primary'>{icon}</span>}
        {title}
      </h3>
      {children}
    </section>
  )
}

function SectionHead({ title, text }: { title: string; text?: string }) {
  return (
    <div className='mb-4 space-y-1'>
      <h2 className='font-pixel text-2xl sm:text-3xl'>{title}</h2>
      {text && <p className='text-muted-foreground'>{text}</p>}
    </div>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className='space-y-1.5 text-sm'>
      {items.map((t) => (
        <li key={t} className='flex gap-2'>
          <span className='text-primary'>•</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

export default function Home() {
  return (
    <div className='flex flex-col'>
      <section className='space-y-6 pt-6 pb-8 md:pt-10 md:pb-12 lg:py-24'>
        <div className='container mx-auto flex flex-col items-center gap-4 text-center'>
          <Link
            href='https://github.com/Balatro-Multiplayer'
            className='rounded-2xl border border-border bg-card/80 px-4 py-1.5 font-medium text-sm'
            target='_blank'
          >
            Follow along on GitHub
          </Link>
          <h1 className='font-pixel text-4xl leading-tight md:text-6xl'>
            Play Balatro Against Your Friends
          </h1>
          <p className='max-w-[42rem] text-muted-foreground leading-normal sm:text-xl sm:leading-8'>
            The unofficial multiplayer mod for Balatro. Challenge your friends,
            compete in tournaments, and climb the global leaderboards.
          </p>
          <Button asChild size='lg' className='w-full sm:w-auto'>
            <Link href='/download'>
              Get Started
              <ChevronRight className='ml-2 h-4 w-4' />
            </Link>
          </Button>
          <div className='mt-8 w-full max-w-5xl rounded-lg border border-border bg-card/80 p-4 shadow-xl'>
            <Image
              src='/multiplayer-screenshot.jpeg'
              width={1200}
              height={600}
              alt='Balatro Multiplayer Screenshot'
              className='rounded-md'
            />
          </div>
        </div>
      </section>

      <div className='container mx-auto max-w-6xl space-y-12 pb-12'>
        <section className='grid items-center gap-4 md:grid-cols-2'>
          <div className='space-y-3'>
            <p className='font-pixel text-muted-foreground uppercase tracking-wide'>
              Officially unofficial&trade;
            </p>
            <h2 className='font-pixel text-2xl sm:text-3xl'>
              &ldquo;There&rsquo;s a cool mod if you want that&rdquo;
            </h2>
            <p className='text-muted-foreground'>
              That&rsquo;s the closest thing to a blessing we&rsquo;ll ever get
              from localthunk, and we&rsquo;re running with it.
            </p>
          </div>
          <div className='overflow-hidden rounded-lg border border-border bg-card/80'>
            <Image
              src='/localthunk_on_multiplayer.png'
              width={800}
              height={400}
              alt='localthunk on Discord: no balatro multiplayer, there is a cool mod if you want that'
              className='w-full'
            />
          </div>
        </section>

        <section>
          <SectionHead
            title='Features'
            text='Play with friends, compete globally, join tournaments.'
          />
          <div className='grid gap-4 sm:grid-cols-2 md:grid-cols-3'>
            {FEATURES.map(([title, text]) => (
              <Card key={title} title={title}>
                <p className='text-muted-foreground text-sm'>{text}</p>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <SectionHead
            title='Ways to play'
            text='Choose how you want to experience Balatro Multiplayer.'
          />
          <div className='grid gap-4 md:grid-cols-3'>
            <Card title='Direct play' icon={<Users className='size-5' />}>
              <p className='text-muted-foreground text-sm'>
                Challenge friends in private matches.
              </p>
              <Bullets
                items={[
                  'No matchmaking or ratings',
                  'Customize all lobby options',
                  'Play with friends directly',
                  'Perfect for casual games',
                ]}
              />
            </Card>
            <Card
              title='Matchmaking queues'
              icon={<Trophy className='size-5' />}
            >
              <p className='text-muted-foreground text-sm'>
                Compete in multiple queues for MMR on the Discord.
              </p>
              <dl className='space-y-2 text-sm'>
                <div>
                  <dt className='font-semibold'>Ranked Queue</dt>
                  <dd className='text-muted-foreground'>
                    Rebalanced cards and mechanics, new jokers, and more to
                    create a competitive experience.
                  </dd>
                </div>
                <div>
                  <dt className='font-semibold'>Smallworld</dt>
                  <dd className='text-muted-foreground'>
                    A whole new style of play, with only 25% of everything at
                    your disposal, and showman is ALWAYS active. How will you
                    build?
                  </dd>
                </div>
                <div>
                  <dt className='font-semibold'>Vanilla Queue</dt>
                  <dd className='text-muted-foreground'>
                    Uses the original game balance with no special changes
                    besides same seed.
                  </dd>
                </div>
              </dl>
            </Card>
            <Card
              title='Custom LFG'
              icon={<MessageSquare className='size-5' />}
            >
              <p className='text-muted-foreground text-sm'>
                Organize custom matches with unique rules and mods.
              </p>
              <Bullets
                items={[
                  'Any ruleset or lobby options',
                  'Compatible with mods (with agreement)',
                  'No MMR or rankings',
                  'Great for experimenting with new formats',
                ]}
              />
            </Card>
          </div>
          <div className='mt-4 flex flex-col gap-3 sm:flex-row'>
            <Button asChild size='lg' className='w-full sm:w-auto'>
              <Link href='/leaderboards'>
                View Leaderboards
                <Trophy className='ml-2 h-4 w-4' />
              </Link>
            </Button>
            <Button
              asChild
              size='lg'
              variant='outline'
              className='w-full sm:w-auto'
            >
              <Link href='https://discord.gg/bBb5eU2gWc' target='_blank'>
                Join Our Discord
                <CircleArrowRightIcon className='ml-2 h-4 w-4' />
              </Link>
            </Button>
          </div>
        </section>

        <section>
          <SectionHead
            title='How it works'
            text='Getting started is simple. Install the mod, connect with friends, and start playing.'
          />
          <ol className='grid gap-4 md:grid-cols-3'>
            {STEPS.map(([title, text], i) => (
              <li key={title}>
                <Card title={title} className='h-full'>
                  <span className='font-pixel text-3xl text-primary'>
                    {i + 1}
                  </span>
                  <p className='text-muted-foreground text-sm'>{text}</p>
                </Card>
              </li>
            ))}
          </ol>
          <Button asChild size='lg' className='mt-4 w-full sm:w-auto'>
            <Link href='/download'>Install Now</Link>
          </Button>
        </section>

        <section className='space-y-3 rounded-lg border border-border bg-card/80 p-6 text-center'>
          <h2 className='font-pixel text-2xl sm:text-3xl'>Ready to play?</h2>
          <p className='text-muted-foreground'>
            Join our competitive community of 3,000+ ranked players.
          </p>
          <Button asChild size='lg' className='w-full sm:w-auto'>
            <Link href='/download'>Get Started Now</Link>
          </Button>
        </section>
      </div>
    </div>
  )
}
