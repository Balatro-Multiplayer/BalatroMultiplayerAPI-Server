import { SiTwitch } from '@icons-pack/react-simple-icons'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Player } from '../types'
import { PlayerAvatar } from './player-avatar'

type NextMatchInfoCardProps = {
  player1: Player
  player2: Player
  week: number | string
  bestOf: number
}

export function NextMatchInfoCard({
  player1,
  player2,
  week,
  bestOf,
}: NextMatchInfoCardProps) {
  return (
    <div className='mt-10 overflow-hidden rounded-xl border bg-card/60 shadow-lg backdrop-blur-sm'>
      <div className='flex items-center justify-between gap-4 px-6 py-4'>
        <div className={'flex flex-col gap-1'}>
          <div className='text-center text-muted-foreground text-sm'>
            {typeof week === 'string' ? week : `Week ${week}`}
          </div>
          <div className={'font-bold text-muted-foreground text-sm'}>
            Best of {bestOf}
          </div>
        </div>

        <div>
          <h3 className='flex items-center gap-2 font-bold text-xl md:text-2xl'>
            <div className={'flex items-center gap-2'}>
              <PlayerAvatar
                className={'size-16'}
                playerName={player1.name}
                img={player1.picture}
              />
              {player1.name}
            </div>
            <span className='text-red-500'>vs</span>
            <div className={'flex items-center gap-2'}>
              {player2.name}
              <PlayerAvatar
                className={'size-16'}
                playerName={player2.name}
                img={player2.picture}
              />
            </div>
          </h3>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className='w-full gap-2 bg-red-600 text-white hover:bg-red-700 md:w-auto'>
              <SiTwitch className='h-4 w-4' />
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
      </div>
    </div>
  )
}
