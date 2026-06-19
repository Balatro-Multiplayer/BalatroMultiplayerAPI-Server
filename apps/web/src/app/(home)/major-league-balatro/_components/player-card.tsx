import { SiTwitch, SiYoutube } from '@icons-pack/react-simple-icons'
import Image from 'next/image'
import Link from 'next/link'
import type { Player } from '@/app/(home)/major-league-balatro/types'
import { Card, CardContent } from '@/components/ui/card'

export type PlayerCardProps = {
  picture: string
  name: string
  socials: Player['socials']
}

export function PlayerCard(player: PlayerCardProps) {
  return (
    <Card className='overflow-hidden py-0'>
      <div className='relative aspect-square bg-muted'>
        <div className='absolute inset-0 flex items-center justify-center'>
          <Image
            width={142}
            height={190}
            src={player.picture}
            alt={player.name}
            className={'h-full w-full object-cover'}
          />
        </div>
      </div>
      <CardContent className='p-4'>
        <h3 className='font-bold text-lg'>{player.name}</h3>
        <div className={'flex items-center justify-between gap-1'}>
          <div>@{player.socials.twitch || player.socials.youtube || ''}</div>
          <div className={'flex items-center gap-3'}>
            {player.socials.twitch && (
              <Link
                href={`https://twitch.tv/${player.socials.twitch}`}
                target={'_blank'}
                rel={'noopener noreferrer'}
              >
                <SiTwitch className={'size-4'} />
              </Link>
            )}
            {player.socials.youtube && (
              <Link
                href={`https://youtube.com/@${player.socials.youtube}`}
                target={'_blank'}
                rel={'noopener noreferrer'}
              >
                <SiYoutube className={'size-4'} />
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
