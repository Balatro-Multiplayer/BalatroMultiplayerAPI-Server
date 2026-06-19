'use client'
import { SiTwitch, SiYoutube } from '@icons-pack/react-simple-icons'
import { TvMinimalPlay } from 'lucide-react'
import Link from 'next/link'
import { useFormatter, useTimeZone } from 'next-intl'
import { PlayerAvatar } from '@/app/(home)/major-league-balatro/_components/player-avatar'
import { players } from '@/app/(home)/major-league-balatro/_constants/players'
import type { Match } from '@/app/(home)/major-league-balatro/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/mobile-tooltip'

type MatchCardProps = {
  match: Match
}
export const MatchCard = ({ match }: MatchCardProps) => {
  const formatter = useFormatter()
  const { player1Id, player2Id, datetime, completed, vod1, vod2 } = match
  const timeZone = useTimeZone()
  const date = formatter.dateTime(datetime, {
    month: 'long',
    day: 'numeric',
    timeZone,
  })
  const time = formatter.dateTime(datetime, {
    timeStyle: 'short',
    timeZone,
  })
  const player1 = players[player1Id]
  const player2 = players[player2Id]

  if (!player1) {
    throw new Error(`Player ${player1Id} not found`)
  }
  if (!player2) {
    throw new Error(`Player ${player2Id} not found`)
  }

  return (
    <Card className='overflow-hidden'>
      <div className='flex flex-col sm:flex-row'>
        <div className='flex items-center justify-center p-4 sm:w-1/4'>
          <div className='text-muted-foreground text-sm underline decoration-dashed underline-offset-4'>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={'cursor-help'}>
                    {date} • {time}
                  </span>
                </TooltipTrigger>
                <TooltipContent align={'center'} sideOffset={5}>
                  <div>Date and time are shown for your current timezone.</div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <div className='p-4 sm:w-3/4'>
          <div className='flex flex-col justify-between gap-4 sm:flex-row sm:items-center'>
            <div className='flex items-center gap-3'>
              <div className='flex -space-x-4'>
                <PlayerAvatar playerName={player1.name} img={player1.picture} />
                <PlayerAvatar playerName={player2.name} img={player2.picture} />
              </div>
              <div>
                <h3 className='font-bold text-lg'>
                  {player1.name} vs {player2.name}
                </h3>
              </div>
            </div>
            <div className='flex gap-2'>
              {completed ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='outline' size='sm' className='gap-1'>
                      <TvMinimalPlay className='size-4' />
                      Watch
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {vod1 && (
                      <DropdownMenuItem asChild>
                        <Link
                          href={vod1}
                          target='_blank'
                          rel='noopener noreferrer'
                        >
                          {vod1.includes('twitch') ? (
                            <SiTwitch className='h-4 w-4' />
                          ) : (
                            <SiYoutube className='h-4 w-4' />
                          )}
                          {player1.name}
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {vod2 && (
                      <DropdownMenuItem asChild>
                        <Link
                          href={vod2}
                          target='_blank'
                          rel='noopener noreferrer'
                        >
                          {vod2.includes('twitch') ? (
                            <SiTwitch className='h-4 w-4' />
                          ) : (
                            <SiYoutube className='h-4 w-4' />
                          )}
                          {player2.name}
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='outline' size='sm' className='gap-1'>
                      <SiTwitch className='size-4' />
                      Watch Live
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem asChild>
                      <Link
                        href={`https://twitch.tv/${player1.socials.twitch}`}
                        target='_blank'
                        rel='noopener noreferrer'
                      >
                        {player1.name}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href={`https://twitch.tv/${player2.socials.twitch}`}
                        target='_blank'
                        rel='noopener noreferrer'
                      >
                        {player2.name}
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
