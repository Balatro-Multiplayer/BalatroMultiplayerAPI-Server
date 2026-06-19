'use client'
import { Calendar, Clock } from 'lucide-react'
import { useFormatter, useTimeZone } from 'next-intl'
import type { PropsWithChildren } from 'react'
import { NextMatchInfoCard } from '@/app/(home)/major-league-balatro/_components/next-match-info-card'
import { CountdownTimer } from '@/components/countdown-timer'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { players } from '../_constants/players'
import type { Match } from '../types'

export type NextMatchInfoProps = {
  nextMatch: Match | undefined
}

export function NextMatchInfo({ nextMatch }: NextMatchInfoProps) {
  const timeZone = useTimeZone()
  const formatter = useFormatter()
  if (!nextMatch) {
    return (
      <SectionContainer>
        <Card className='border-2 border-red-500/50'>
          <CardHeader>
            <CardTitle className='text-center text-2xl'>
              Tournament Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className='py-8 text-center'>
            <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted'>
              <Calendar className='h-8 w-8 text-muted-foreground' />
            </div>
            <p className='text-muted-foreground'>
              No upcoming matches scheduled at this time.
            </p>
            <p className='mt-2 text-muted-foreground text-sm'>
              Check back later for updates or view past matches below.
            </p>
          </CardContent>
        </Card>
      </SectionContainer>
    )
  }

  const nextMatchPlayer1 = players[nextMatch.player1Id]
  const nextMatchPlayer2 = players[nextMatch.player2Id]

  const date = formatter.dateTime(nextMatch.datetime, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  })
  const time = formatter.dateTime(nextMatch.datetime, {
    timeStyle: 'short',
    timeZone,
  })

  if (!nextMatchPlayer1) {
    throw new Error(`Player ${nextMatch.player1Id} not found`)
  }
  if (!nextMatchPlayer2) {
    throw new Error(`Player ${nextMatch.player2Id} not found`)
  }

  return (
    <SectionContainer>
      <div className='relative overflow-hidden rounded-xl border-2 bg-gradient-to-b from-background'>
        <div className='relative z-10 px-6 py-8 md:py-10'>
          <div className='mb-8 text-center'>
            <h2 className='mb-2 font-bold text-2xl md:text-3xl'>
              Next Match Countdown
            </h2>
            <div className='flex items-center justify-center gap-2 text-red-500'>
              <Clock className='h-5 w-5 animate-pulse' />
              <p className='text-sm md:text-base'>
                {date} • {time}
              </p>
            </div>
          </div>

          <CountdownTimer nextMatch={nextMatch} />

          <NextMatchInfoCard
            week={nextMatch.week}
            bestOf={5}
            player1={nextMatchPlayer1}
            player2={nextMatchPlayer2}
          />
        </div>
      </div>
    </SectionContainer>
  )
}

function SectionContainer({ children }: PropsWithChildren) {
  return (
    <section className='container py-8 md:py-12'>
      <div className='mx-auto w-full max-w-4xl'>{children}</div>
    </section>
  )
}
