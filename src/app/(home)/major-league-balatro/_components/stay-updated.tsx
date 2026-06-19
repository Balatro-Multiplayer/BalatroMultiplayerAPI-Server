import { SiBluesky, SiYoutube } from '@icons-pack/react-simple-icons'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function StayUpdated() {
  return (
    <section className='bg-muted py-12 md:py-16'>
      <div className='container flex flex-col items-center justify-center gap-4 text-center'>
        <h2 className='font-bold text-3xl tracking-tighter sm:text-4xl'>
          Stay Updated
        </h2>
        <p className='max-w-[600px] text-muted-foreground md:text-xl/relaxed'>
          Follow the official channels for weekly recaps, schedules, and
          standings.
        </p>
        <div className='mt-4 flex flex-col gap-4 sm:flex-row'>
          <Link
            href='https://youtube.com/@ZainoTVLive'
            target='_blank'
            rel='noopener noreferrer'
          >
            <Button
              size='lg'
              className='w-full bg-red-600 text-white hover:bg-red-700 sm:w-auto'
            >
              <SiYoutube className='ml-2 h-4 w-4' />
              YouTube Channel
            </Button>
          </Link>
          <Link
            href='https://bsky.app/profile/majorleaguebalatro.bsky.social'
            target='_blank'
            rel='noopener noreferrer'
          >
            <Button variant='outline' size='lg' className='w-full sm:w-auto'>
              <SiBluesky className='ml-2 h-4 w-4' />
              Bluesky Updates
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
