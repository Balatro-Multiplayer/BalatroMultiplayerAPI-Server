import {
  Bot,
  CircleDollarSign,
  Coffee,
  ExternalLink,
  Heart,
} from 'lucide-react'
import Link from 'next/link'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { createMetadata } from '../../../../lib/metadata'

export const metadata = createMetadata({
  title: 'Support Us',
  description:
    'Support Balatro Multiplayer, the website, and Botlatro to help fund hosting, development, and community tools.',
  path: '/support-us',
})

export default async function SupportUsPage() {
  return (
    <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-1 flex-col py-8'>
      <div className={'mb-10 text-center'}>
        <h1 className={'font-bold text-4xl tracking-tight'}>Support Us</h1>
        <p className={'mt-4 text-lg text-muted-foreground'}>
          Your support helps us continue developing and maintaining Balatro
          Multiplayer
        </p>
      </div>

      <div className={'grid gap-8 md:grid-cols-3'}>
        <Card className={'transition-all hover:shadow-md'}>
          <CardHeader className={'flex flex-row items-center gap-4'}>
            <div className={'rounded-full bg-primary/10 p-2'}>
              <Coffee className={'size-6 text-primary'} />
            </div>
            <div>
              <CardTitle>Support Multiplayer Mod</CardTitle>
              <CardDescription>
                Help fund the development of the Balatro Multiplayer Mod
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className={'text-muted-foreground'}>
              Your contribution helps us add new features, fix bugs, and
              maintain the multiplayer experience for everyone.
            </p>
          </CardContent>
          <CardFooter>
            <Link
              target={'_blank'}
              rel={'noopener noreferrer'}
              href={'https://ko-fi.com/virtualized/shop'}
              className={
                'flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90'
              }
            >
              Support on Ko-fi <ExternalLink className={'size-4'} />
            </Link>
          </CardFooter>
        </Card>

        <Card className={'transition-all hover:shadow-md'}>
          <CardHeader className={'flex flex-row items-center gap-4'}>
            <div className={'rounded-full bg-primary/10 p-2'}>
              <Heart className={'size-6 text-primary'} />
            </div>
            <div>
              <CardTitle>Support This Website</CardTitle>
              <CardDescription>
                Help fund the development and hosting of this website
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className={'text-muted-foreground'}>
              Your contribution helps us improve the website, add new features,
              and keep the servers running smoothly.
            </p>
          </CardContent>
          <CardFooter className={'flex flex-wrap gap-2'}>
            <Link
              target={'_blank'}
              rel={'noopener noreferrer'}
              href={'https://ko-fi.com/andy_balatro'}
              className={
                'flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90'
              }
            >
              Support Andy on Ko-fi <ExternalLink className={'size-4'} />
            </Link>
            <Link
              target={'_blank'}
              rel={'noopener noreferrer'}
              href={'https://ko-fi.com/jeffdev'}
              className={
                'flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90'
              }
            >
              Support Jeffdev on Ko-fi <ExternalLink className={'size-4'} />
            </Link>
          </CardFooter>
        </Card>

        <Card className={'transition-all hover:shadow-md'}>
          <CardHeader className={'flex flex-row items-center gap-4'}>
            <div className={'rounded-full bg-primary/10 p-2'}>
              <Bot className={'size-6 text-primary'} />
            </div>
            <div>
              <CardTitle>Support the Discord Bot</CardTitle>
              <CardDescription>
                Help fund the development of the Botlatro Discord bot
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className={'text-muted-foreground'}>
              Your contribution helps support the developers maintaining and
              improving the Botlatro Discord bot, which is used for the queue in
              discord.
            </p>
          </CardContent>
          <CardFooter>
            <Link
              target={'_blank'}
              rel={'noopener noreferrer'}
              href={'https://ko-fi.com/botlatro'}
              className={
                'flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90'
              }
            >
              Support on Ko-fi <ExternalLink className={'size-4'} />
            </Link>
          </CardFooter>
        </Card>
      </div>

      <div className={'mt-12 rounded-lg border bg-card p-6 text-center'}>
        <CircleDollarSign className={'mx-auto mb-4 size-10 text-primary/70'} />
        <h2 className={'mb-2 font-semibold text-2xl'}>
          Why Your Support Matters
        </h2>
        <p className={'mx-auto max-w-2xl text-muted-foreground'}>
          Balatro Multiplayer is a community-driven project maintained by
          volunteers. Your support directly contributes to server costs,
          development time, and the continued improvement of the multiplayer
          experience for all players.
        </p>
      </div>
    </div>
  )
}
