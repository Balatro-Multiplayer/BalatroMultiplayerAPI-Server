'use client'
import { useEffect, useState } from 'react'
import type { Match } from '@/app/(home)/major-league-balatro/types'

export function CountdownTimer({
  nextMatch,
}: {
  nextMatch: Pick<Match, 'datetime'>
}) {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  })

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date()
      const matchTime = new Date(nextMatch.datetime)
      const difference = matchTime.getTime() - now.getTime()

      if (difference <= 0) {
        return {
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
        }
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor(
          (difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
        ),
        minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((difference % (1000 * 60)) / 1000),
      }
    }

    setTimeLeft(calculateTimeLeft())

    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft())
    }, 1000)

    return () => clearInterval(timer)
  }, [nextMatch])

  return (
    <div className='flex justify-center'>
      <div className='grid w-full max-w-xl grid-cols-4 gap-2 md:gap-4'>
        {[
          { value: timeLeft.days, label: 'Days' },
          { value: timeLeft.hours, label: 'Hours' },
          { value: timeLeft.minutes, label: 'Minutes' },
          { value: timeLeft.seconds, label: 'Seconds' },
        ].map((item) => (
          <div key={item.label}>
            <div className='relative flex flex-col items-center justify-center rounded-lg border bg-card p-3 shadow-sm md:p-4'>
              <span className='font-bold text-2xl tabular-nums md:text-4xl lg:text-5xl'>
                {item.value.toString().padStart(2, '0')}
              </span>
              <span className='mt-1 text-muted-foreground text-xs md:text-sm'>
                {item.label}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
