import { Calendar, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function HeroSection() {
  return (
    <section>
      <div className='container relative z-10 flex flex-col items-center py-16 text-center md:py-24'>
        <Badge className='mb-4 bg-red-600 text-sm text-white hover:bg-red-700'>
          Season 1
        </Badge>
        <h1 className='mb-4 font-extrabold text-4xl tracking-tight md:text-6xl'>
          Major League Balatro
        </h1>
        <p className='mb-8 max-w-[42rem] text-lg text-muted-foreground md:text-xl'>
          12 creators. 2 divisions. 1 champion. The ultimate Balatro multiplayer
          tournament.
        </p>

        <div className='mb-8 grid w-full max-w-3xl grid-cols-2 gap-4 md:grid-cols-4 md:gap-8'>
          <div className='flex flex-col items-center rounded-lg border bg-card p-4'>
            <span className='font-bold text-2xl text-red-500 md:text-3xl'>
              12
            </span>
            <span className='text-muted-foreground text-sm'>Creators</span>
          </div>
          <div className='flex flex-col items-center rounded-lg border bg-card p-4'>
            <span className='font-bold text-2xl text-red-500 md:text-3xl'>
              5
            </span>
            <span className='text-muted-foreground text-sm'>Weeks</span>
          </div>
          <div className='flex flex-col items-center rounded-lg border bg-card p-4'>
            <span className='font-bold text-2xl text-red-500 md:text-3xl'>
              $500+
            </span>
            <span className='text-muted-foreground text-sm'>Prize Pool</span>
          </div>
          <div className='flex flex-col items-center rounded-lg border bg-card p-4'>
            <span className='font-bold text-2xl text-red-500 md:text-3xl'>
              May 17
            </span>
            <span className='text-muted-foreground text-sm'>Finals</span>
          </div>
        </div>

        <div className='flex flex-col gap-4 sm:flex-row'>
          <Link href='#schedule'>
            <Button
              size='lg'
              className='bg-red-600 text-white hover:bg-red-700'
            >
              View Schedule
              <Calendar className='ml-2 h-4 w-4' />
            </Button>
          </Link>
          <Link href='#format'>
            <Button variant='outline' size='lg'>
              Tournament Format
              <ChevronRight className='ml-2 h-4 w-4' />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
