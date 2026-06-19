'use client'

import { Swords } from 'lucide-react'
import { useParams } from 'next/navigation'
import { type ComponentPropsWithoutRef, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { SelectGames } from '@/server/db/types'
import type { LeaderboardEntry } from '@/server/services/botlatro.service'
import { RANKED_QUEUE_ID } from '@/shared/constants'
import { filterGamesBySeason, getActiveSeason } from '@/shared/seasons'
import { api } from '@/trpc/react'

export function getPlayerData(
  playerLeaderboardEntry: LeaderboardEntry,
  games: SelectGames[]
) {
  const filteredGamesByLeaderboard = games.filter(
    (game) => game.gameType === 'ranked'
  )

  const games_played = filteredGamesByLeaderboard.length
  let wins = 0
  let losses = 0
  let ties = 0
  for (const game of filteredGamesByLeaderboard) {
    if (game.result === 'win') {
      wins++
    } else if (game.result === 'loss') {
      losses++
    } else if (game.result === 'tie') {
      ties++
    } else {
      ties++
    }
  }

  const lastGame = filteredGamesByLeaderboard.at(0)
  const currentName = lastGame?.playerName
  const meaningful_games = games_played - ties

  return {
    username: currentName ?? 'Unknown',
    games: games_played,
    meaningful_games,
    wins,
    losses,
    ties,
    winRate:
      meaningful_games > 0 ? Math.ceil((wins / meaningful_games) * 100) : 0,
    lossRate:
      meaningful_games > 0 ? Math.floor((losses / meaningful_games) * 100) : 0,
    rank: playerLeaderboardEntry.rank,
    mmr: Math.round(playerLeaderboardEntry.mmr),
    mmrChangeRaw: lastGame?.mmrChange,
    mmrChange: `${(lastGame?.mmrChange ?? 0) >= 0 ? '+' : ''}${Math.round(
      lastGame?.mmrChange ?? 0
    )}`,
    streak: playerLeaderboardEntry?.streak,
  }
}

export function StreamCardClient() {
  const { id } = useParams<{ id: string }>()

  const [seasonRows] = api.seasons.list.useSuspenseQuery()
  const activeSeason = getActiveSeason(seasonRows)
  const [gamesQueryResult, gamesQuery] =
    api.history.user_games.useSuspenseQuery({ user_id: id })
  const allGames = gamesQueryResult || []
  const games = activeSeason ? filterGamesBySeason(allGames, activeSeason) : []

  const [rankedUserRank, rankedUserQuery] =
    api.leaderboard.get_user_rank.useSuspenseQuery({
      channel_id: RANKED_QUEUE_ID,
      user_id: id,
      season: activeSeason ?? undefined,
    })

  const result = api.playerState.onStateChange.useSubscription(
    { userId: id },
    {
      onData: async () => {
        await Promise.all([gamesQuery.refetch(), rankedUserQuery.refetch()])
      },
    }
  )

  const playerState = result.data?.data

  if (!rankedUserRank || !games?.length) {
    return null
  }

  const playerData = getPlayerData(rankedUserRank?.data, games)

  const isQueuing = playerState?.status === 'queuing'
  const opponentId = playerState?.currentMatch?.opponentId

  let winsVsOpponent = 0
  let lossesVsOpponent = 0
  if (opponentId) {
    for (const game of games) {
      if (game.opponentId === opponentId) {
        if (game.result === 'win') {
          winsVsOpponent++
        } else if (game.result === 'loss') {
          lossesVsOpponent++
        }
      }
    }
  }

  return (
    <div
      className={'flex items-center justify-between gap-2 font-m6x11'}
      style={{ zoom: '200%' }}
    >
      <PlayerInfo
        playerData={playerData}
        isInBattle={!!opponentId}
        wins={winsVsOpponent}
      >
        {isQueuing && playerState.queueStartTime && (
          <QueueTimer startTime={playerState.queueStartTime} />
        )}
      </PlayerInfo>
      {opponentId && (
        <>
          <span>
            <Swords />
          </span>{' '}
          <Opponent id={opponentId} wins={lossesVsOpponent} />
        </>
      )}
    </div>
  )
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function QueueTimer({ startTime }: { startTime: number }) {
  const [queueTime, setQueueTime] = useState(Date.now() - startTime)

  useEffect(() => {
    const interval = setInterval(() => {
      setQueueTime(Date.now() - startTime)
    }, 1000)
    return () => clearInterval(interval)
  })

  return (
    <div className='flex animate-pulse items-center gap-1.5 border-slate-700 px-2'>
      <div>Queueing for </div>
      <div className='font-bold text-emerald-400'>
        {formatDuration(queueTime)}
      </div>
    </div>
  )
}

function Opponent({ id, wins }: { id: string; wins?: number }) {
  const { data: seasonRows } = api.seasons.list.useQuery()
  const activeSeason = getActiveSeason(seasonRows)
  const { data: gamesQueryResult } = api.history.user_games.useQuery({
    user_id: id,
  })
  const allGames = gamesQueryResult || []
  const games = activeSeason ? filterGamesBySeason(allGames, activeSeason) : []

  const { data: rankedUserRank } = api.leaderboard.get_user_rank.useQuery({
    channel_id: RANKED_QUEUE_ID,
    user_id: id,
    season: activeSeason ?? undefined,
  })
  if (!rankedUserRank || !games?.length) {
    return null
  }

  const playerData = getPlayerData(rankedUserRank?.data, games)

  return <PlayerInfo playerData={playerData} isReverse isInBattle wins={wins} />
}

function PlayerInfo({
  playerData,
  className,
  children,
  isReverse = false,
  isInBattle = false,
  wins,
  ...rest
}: {
  playerData: ReturnType<typeof getPlayerData>
  isReverse?: boolean
  isInBattle?: boolean
  wins?: number
} & ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'flex h-10 w-fit max-w-[800px] items-center overflow-hidden border-2 border-slate-800 bg-slate-900/90 text-white shadow-lg backdrop-blur-sm',
        isReverse ? 'flex-row-reverse' : 'flex-row',
        className
      )}
      {...rest}
    >
      <div className='flex aspect-square h-full items-center justify-center gap-1 border-slate-700 border-r bg-gradient-to-r from-indigo-600 to-purple-600 px-2'>
        <span className='font-bold text-sm'>#{playerData.rank}</span>
      </div>

      {/* Player Name */}
      <div
        className={cn(
          'max-w-[180px] flex-shrink-0 border-slate-700 px-2',
          !isReverse && 'border-r'
        )}
      >
        <div className='truncate font-medium'>{playerData.username}</div>
      </div>

      {/* MMR */}
      <div className='flex items-center gap-1.5 border-slate-700 border-r px-2'>
        <div>MMR:</div>
        <div className='font-bold'>{playerData.mmr}</div>
        <div
          className={cn(
            '!text-emerald-400 text-sm',
            playerData.mmrChangeRaw &&
              playerData.mmrChangeRaw < 0 &&
              '!text-rose-400'
          )}
        >
          {playerData.mmrChange}
        </div>
      </div>

      {/* Win Rate */}
      {!isInBattle && (
        <div className='flex items-center gap-1.5 text-nowrap border-slate-700 border-r px-2'>
          <div className='text-nowrap'>WR:</div>
          <div className='text font-bold text-emerald-400'>
            {playerData.winRate}%
          </div>
        </div>
      )}

      {/* Win/Loss */}
      <div
        className={cn(
          'flex items-center gap-0.5 border-slate-700 px-2',
          isReverse && 'border-r'
        )}
      >
        <div className='ml-0.5 font-bold text-emerald-400'>
          {playerData.wins}W
        </div>
        |
        <div className='ml-0.5 font-bold text-rose-400'>
          {playerData.losses}L
        </div>
        <div className='ml-0.5'>({playerData.winRate}%)</div>
      </div>
      {isInBattle && (
        <div
          className={cn(
            'flex aspect-square h-full items-center justify-center gap-1 border-slate-700 bg-gradient-to-r px-2',
            isReverse ? 'mr-4 border-r' : 'ml-4 border-l'
          )}
        >
          <span className='font-bold text-sm'>{wins}</span>
        </div>
      )}

      {/* Streak */}
      {!isInBattle && (
        <div
          className={cn(
            'flex items-center gap-1.5 border-slate-700 px-2',
            (children || isReverse) && 'border-r'
          )}
        >
          <div>Streak:</div>
          <div
            className={cn(
              'font-bold text-emerald-400',
              playerData.streak < 0 && 'text-rose-400'
            )}
          >
            {playerData.streak}
          </div>
        </div>
      )}

      {children}
    </div>
  )
}
