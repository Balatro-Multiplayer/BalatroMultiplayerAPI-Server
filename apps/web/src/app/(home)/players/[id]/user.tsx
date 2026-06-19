'use client'

import { SiTwitch, SiYoutube } from '@icons-pack/react-simple-icons'
import { format } from 'date-fns'
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  ListFilter,
  Swords,
} from 'lucide-react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { isNonNullish } from 'remeda'
import { BountyCompletions } from '@/app/(home)/bounties/[id]/bounty-completions'
import {
  DeckImage,
  DeckStakeStatsChart,
  StakeImage,
} from '@/app/(home)/players/[id]/_components/deck-stake-stats-chart'
import { GamesTable } from '@/app/(home)/players/[id]/_components/games-table'
import { MmrTrendChart } from '@/app/(home)/players/[id]/_components/mmr-trend-chart'
import { OpponentsTable } from '@/app/(home)/players/[id]/_components/opponents-table'
import { WinrateTrendChart } from '@/app/(home)/players/[id]/_components/winrate-trend-chart'
import { TimeZoneProvider } from '@/components/timezone-provider'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/mobile-tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { UserBounty } from '@/server/services/botlatro.service'
import {
  LEGACY_QUEUE_ID,
  OLD_RANKED_CHANNEL,
  OLD_SMALLWORLD_CHANNEL,
  OLD_VANILLA_CHANNEL,
  RANKED_QUEUE_ID,
  SMALLWORLD_QUEUE_ID,
  VANILLA_QUEUE_ID,
} from '@/shared/constants'
import { getRankData } from '@/shared/ranks'
import {
  filterGamesBySeason,
  getSeasonDisplayName,
  type Season,
} from '@/shared/seasons'
import { api } from '@/trpc/react'
import {
  DEFAULT_PLAYER_PROFILE_SEASON,
  unescapePlayerName,
} from './player-name'

const numberFormatter = new Intl.NumberFormat('en-US', {
  signDisplay: 'exceptZero',
})

export function UserInfo() {
  return (
    <TimeZoneProvider>
      <UserInfoComponent />
    </TimeZoneProvider>
  )
}

function getChannelIdForSeason(
  queueType: 'ranked' | 'vanilla' | 'smallworld' | 'legacy',
  season: Season
) {
  const isOldSeason =
    season === 'season1' || season === 'season2' || season === 'season3'

  if (queueType === 'vanilla') {
    return isOldSeason ? OLD_VANILLA_CHANNEL : VANILLA_QUEUE_ID
  }
  if (queueType === 'smallworld') {
    return isOldSeason ? OLD_SMALLWORLD_CHANNEL : SMALLWORLD_QUEUE_ID
  }
  if (queueType === 'legacy') {
    return LEGACY_QUEUE_ID
  }
  return isOldSeason ? OLD_RANKED_CHANNEL : RANKED_QUEUE_ID
}

function getMostPlayed(
  gamesList: { deck: string | null; stake: string | null }[]
) {
  const deckCounts: Record<string, number> = {}
  const stakeCounts: Record<string, number> = {}
  for (const g of gamesList) {
    if (g.deck) {
      const clean = g.deck.replace('Deck', '').trim().toLowerCase()
      if (clean !== 'unknown') deckCounts[clean] = (deckCounts[clean] ?? 0) + 1
    }
    if (g.stake) {
      const clean = g.stake.replace('Stake', '').trim().toLowerCase()
      if (clean !== 'unknown')
        stakeCounts[clean] = (stakeCounts[clean] ?? 0) + 1
    }
  }
  const deck =
    Object.entries(deckCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
  const stake =
    Object.entries(stakeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
  return { deck, stake }
}

const TAB_OPTIONS = [
  { value: 'matches', label: 'Match History' },
  { value: 'opponents', label: 'Opponents' },
  { value: 'deck-stake-stats', label: 'Decks / Stakes' },
  { value: 'mmr-trends', label: 'MMR Trends' },
  { value: 'winrate-trends', label: 'Winrate Trends' },
  { value: 'bounties', label: 'Bounties' },
] as const

function UserInfoComponent() {
  const [activeTab, setActiveTab] = useState('matches')
  const [filter, setFilter] = useState('all')
  const [season, setSeason] = useState<Season>(DEFAULT_PLAYER_PROFILE_SEASON)
  const rankedChannelId = getChannelIdForSeason('ranked', season)
  const vanillaChannelId = getChannelIdForSeason('vanilla', season)
  const smallworldChannelId = getChannelIdForSeason('smallworld', season)
  const legacyChannelId = getChannelIdForSeason('legacy', season)

  const [leaderboardFilter, setLeaderboardFilter] = useState('all')
  const { id } = useParams<{ id: string }>()

  const gamesQuery = api.history.user_games.useSuspenseQuery({ user_id: id })
  const games = gamesQuery[0] || []
  const [discord_user] = api.players.get_user_by_id.useSuspenseQuery({
    user_id: id,
  })

  const { data: bounties = [] } = api.bounties.get_user_bounties.useQuery({
    user_id: id,
  })

  const [rankedLeaderboard] = api.leaderboard.get_leaderboard.useSuspenseQuery({
    channel_id: rankedChannelId,
    season,
  })

  const [vanillaLeaderboard] = api.leaderboard.get_leaderboard.useSuspenseQuery(
    {
      channel_id: vanillaChannelId,
      season,
    }
  )

  const [smallworldLeaderboard] =
    api.leaderboard.get_leaderboard.useSuspenseQuery({
      channel_id: smallworldChannelId,
      season,
    })

  const [legacyLeaderboard] = api.leaderboard.get_leaderboard.useSuspenseQuery({
    channel_id: legacyChannelId,
    season,
  })

  const [vanillaUserRankQ] = api.leaderboard.get_user_rank.useSuspenseQuery({
    channel_id: vanillaChannelId,
    user_id: id,
    season,
  })
  const [smallWorldUserRankQ] = api.leaderboard.get_user_rank.useSuspenseQuery({
    channel_id: smallworldChannelId,
    user_id: id,
    season,
  })
  const [rankedUserRankQ] = api.leaderboard.get_user_rank.useSuspenseQuery({
    channel_id: rankedChannelId,
    user_id: id,
    season,
  })
  const [legacyUserRankQ] = api.leaderboard.get_user_rank.useSuspenseQuery({
    channel_id: legacyChannelId,
    user_id: id,
    season,
  })

  const [rankedUserRankS4Q] = api.leaderboard.get_user_rank.useSuspenseQuery({
    channel_id: RANKED_QUEUE_ID,
    user_id: id,
    season: 'season4',
  })

  const [rankedUserRankS2Q] = api.leaderboard.get_user_rank.useSuspenseQuery({
    channel_id: OLD_RANKED_CHANNEL,
    user_id: id,
    season: 'season2',
  })

  const [rankedUserRankS3Q] = api.leaderboard.get_user_rank.useSuspenseQuery({
    channel_id: OLD_RANKED_CHANNEL,
    user_id: id,
    season: 'season3',
  })

  const rankedUserRank = rankedUserRankQ?.data
  const vanillaUserRank = vanillaUserRankQ?.data
  const smallWorldUserRank = smallWorldUserRankQ?.data
  const legacyUserRank = legacyUserRankQ?.data
  const rankedUserRankS2 = rankedUserRankS2Q?.data
  const rankedUserRankS3 = rankedUserRankS3Q?.data
  const rankedUserRankS4 = rankedUserRankS4Q?.data

  const historicRankedData =
    season === 'season2'
      ? { data: rankedUserRankS3, season: 'season3' as Season }
      : season === 'season3'
        ? { data: rankedUserRankS2, season: 'season2' as Season }
        : { data: rankedUserRankS4, season: 'season4' as Season }

  const seasonFilteredGames = filterGamesBySeason(games, season)

  const filteredGamesByLeaderboard =
    leaderboardFilter === 'all'
      ? seasonFilteredGames
      : seasonFilteredGames.filter(
          (game) =>
            game.gameType.toLowerCase() === leaderboardFilter?.toLowerCase()
        )

  const filteredGames =
    filter === 'all'
      ? filteredGamesByLeaderboard
      : filter === 'wins'
        ? filteredGamesByLeaderboard.filter((game) => game.result === 'win')
        : filter === 'losses'
          ? filteredGamesByLeaderboard.filter((game) => game.result === 'loss')
          : filter === 'wins-and-losses'
            ? filteredGamesByLeaderboard.filter(
                (game) => game.result === 'win' || game.result === 'loss'
              )
            : filteredGamesByLeaderboard.filter((game) => game.result === 'tie')

  const games_played = seasonFilteredGames.length
  let wins = 0
  let losses = 0
  let ties = 0
  for (const game of seasonFilteredGames) {
    if (game.result === 'win') {
      wins++
    } else if (game.result === 'loss') {
      losses++
    } else {
      ties++
    }
  }

  const aliases = [...new Set(seasonFilteredGames.map((g) => g.playerName))]
  const currentName = discord_user.display_name
  const activeBanExpiryLabel = discord_user.active_ban?.expires_at
    ? format(new Date(discord_user.active_ban.expires_at), 'MMM d, yyyy')
    : null
  const meaningful_games = games_played - ties
  const winRate =
    meaningful_games > 0 ? Math.ceil((wins / meaningful_games) * 100) : 0

  const lastRankedGame = seasonFilteredGames
    .filter((game) => game.gameType === 'ranked')
    .at(0)
  const lastVanillaGame = seasonFilteredGames
    .filter((game) => game.gameType.toLowerCase() === 'vanilla')
    .at(0)
  const lastLegacyGame = seasonFilteredGames
    .filter((game) => game.gameType.toLowerCase() === 'legacy')
    .at(0)
  const lastSmallworldGame = seasonFilteredGames
    .filter((game) => game.gameType.toLowerCase() === 'smallworld')
    .at(0)

  const rankedMeaningfulGames = seasonFilteredGames.filter(
    (g) =>
      g.result !== 'tie' && g.result !== 'unknown' && g.gameType === 'ranked'
  )

  const avgOpponentMmr =
    rankedMeaningfulGames.length > 0
      ? rankedMeaningfulGames.reduce((acc, g) => acc + g.opponentMmr, 0) /
        rankedMeaningfulGames.length
      : 0

  const mostPlayedRanked = useMemo(() => {
    return getMostPlayed(
      seasonFilteredGames.filter((g) => g.gameType === 'ranked')
    )
  }, [seasonFilteredGames])

  const mostPlayedSmallworld = useMemo(() => {
    return getMostPlayed(
      seasonFilteredGames.filter(
        (g) => g.gameType.toLowerCase() === 'smallworld'
      )
    )
  }, [seasonFilteredGames])

  const mostPlayedVanilla = useMemo(() => {
    const vanillaGames = seasonFilteredGames.filter(
      (g) => g.gameType.toLowerCase() === 'vanilla'
    )
    return getMostPlayed(vanillaGames)
  }, [seasonFilteredGames])

  const mostPlayedLegacy = useMemo(() => {
    const legacyGames = seasonFilteredGames.filter(
      (g) => g.gameType.toLowerCase() === 'legacy'
    )
    return getMostPlayed(legacyGames)
  }, [seasonFilteredGames])

  const hasRanked =
    isNonNullish(rankedUserRank?.mmr) && !Number.isNaN(rankedUserRank?.mmr)
  const hasVanilla =
    isNonNullish(vanillaUserRank?.mmr) && !Number.isNaN(vanillaUserRank?.mmr)
  const hasSmallworld =
    isNonNullish(smallWorldUserRank?.mmr) &&
    !Number.isNaN(smallWorldUserRank?.mmr)
  const hasLegacy =
    isNonNullish(legacyUserRank?.mmr) && !Number.isNaN(legacyUserRank?.mmr)

  const rankedAvailable = (rankedLeaderboard?.total ?? 0) > 0
  const vanillaAvailable = (vanillaLeaderboard?.total ?? 0) > 0
  const smallworldAvailable = (smallworldLeaderboard?.total ?? 0) > 0
  const legacyAvailable = (legacyLeaderboard?.total ?? 0) > 0

  const activeQueueCount = [
    rankedAvailable,
    vanillaAvailable,
    smallworldAvailable,
    legacyAvailable,
  ].filter(Boolean).length
  const lgGridCols: Record<number, string> = {
    1: 'lg:grid-cols-1',
    2: 'lg:grid-cols-2',
    3: 'lg:grid-cols-3',
    4: 'lg:grid-cols-4',
  }

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-1 flex-col'>
        {/* ── Profile Header ── */}
        <div className='pt-8 pb-6'>
          <div className='flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between'>
            <div className='flex items-center gap-4'>
              <Avatar className='size-16 ring-2 ring-border sm:size-20'>
                <AvatarImage src={discord_user.avatar_url} alt={currentName} />
                <AvatarFallback className='bg-muted font-bold text-muted-foreground text-xl'>
                  {currentName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className='min-w-0'>
                <div className='flex items-center gap-2'>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <h1 className='truncate font-bold text-2xl leading-tight sm:text-3xl'>
                          {currentName}
                        </h1>
                      </TooltipTrigger>
                      {aliases.length > 1 && (
                        <TooltipContent align='start' sideOffset={5}>
                          <p className='mb-1 font-medium text-xs'>
                            Also known as
                          </p>
                          <ul className='list-disc pl-4 text-xs'>
                            {aliases.map((alias) => (
                              <li key={alias}>{unescapePlayerName(alias)}</li>
                            ))}
                          </ul>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <p className='mt-0.5 text-muted-foreground text-sm'>
                  @{discord_user.username}
                </p>

                <div className='mt-2 flex flex-wrap items-center gap-1.5'>
                  {discord_user.twitch_url && (
                    <a
                      href={discord_user.twitch_url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center justify-center rounded-md border bg-background p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-purple-500'
                    >
                      <SiTwitch className='size-3.5' />
                    </a>
                  )}
                  {discord_user.youtube_url && (
                    <a
                      href={discord_user.youtube_url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center justify-center rounded-md border bg-background p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-red-500'
                    >
                      <SiYoutube className='size-3.5' />
                    </a>
                  )}
                  {historicRankedData?.data &&
                    isNonNullish(historicRankedData.data.rank) && (
                      <Badge
                        variant='outline'
                        className='ml-1 border-amber-200/60 bg-amber-50/50 text-amber-700 text-xs dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-400'
                      >
                        <Calendar className='mr-1 size-3' />
                        {getSeasonDisplayName(historicRankedData.season)} #
                        {historicRankedData.data.rank}
                        {isNonNullish(historicRankedData.data.mmr) &&
                          ` · ${Math.round(historicRankedData.data.mmr)}`}
                      </Badge>
                    )}
                </div>

                {discord_user.active_ban && (
                  <div className='mt-2 flex flex-wrap items-center gap-2'>
                    <Badge
                      variant='destructive'
                      className='border-rose-200/70 bg-rose-50 text-rose-700 dark:border-rose-950 dark:bg-rose-950/40 dark:text-rose-300'
                    >
                      Banned
                    </Badge>
                    <p className='text-muted-foreground text-sm'>
                      {activeBanExpiryLabel ? (
                        <>
                          Expires{' '}
                          <span className='font-medium text-foreground'>
                            {activeBanExpiryLabel}
                          </span>
                        </>
                      ) : (
                        <span className='font-medium text-foreground'>
                          Permanent ban
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <Select
              value={season}
              onValueChange={(value) => setSeason(value as Season)}
            >
              <SelectTrigger className='h-9 w-full shrink-0 sm:w-[180px]'>
                <Calendar className='mr-2 size-3.5 text-muted-foreground' />
                <SelectValue placeholder='Season' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='season6'>
                  {getSeasonDisplayName('season6')}
                </SelectItem>
                <SelectItem value='season5'>
                  {getSeasonDisplayName('season5')}
                </SelectItem>
                <SelectItem value='season4'>
                  {getSeasonDisplayName('season4')}
                </SelectItem>
                <SelectItem value='season3'>
                  {getSeasonDisplayName('season3')}
                </SelectItem>
                <SelectItem value='season2'>
                  {getSeasonDisplayName('season2')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Queue Rating Cards ── */}
        <div
          className={cn(
            'grid grid-cols-1 gap-3 sm:grid-cols-2',
            lgGridCols[activeQueueCount] ?? 'lg:grid-cols-4'
          )}
        >
          <QueueCard
            queue='Ranked'
            mmr={hasRanked ? Math.round(rankedUserRank?.mmr) : null}
            rank={
              !!rankedLeaderboard && isNonNullish(rankedUserRank?.rank)
                ? rankedUserRank.rank
                : null
            }
            rankIcon={
              hasRanked ? getRankData(rankedUserRank?.mmr, 'ranked') : null
            }
            lastGame={lastRankedGame ?? null}
            mostPlayed={mostPlayedRanked}
            accentClass='border-violet-500/20 dark:border-violet-500/10'
            badgeClass='border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300'
          />
          {legacyAvailable && (
            <QueueCard
              queue='Legacy'
              mmr={hasLegacy ? Math.round(legacyUserRank?.mmr) : null}
              rank={
                !!legacyLeaderboard && isNonNullish(legacyUserRank?.rank)
                  ? legacyUserRank.rank
                  : null
              }
              rankIcon={
                hasLegacy ? getRankData(legacyUserRank?.mmr, 'legacy') : null
              }
              lastGame={lastLegacyGame ?? null}
              mostPlayed={mostPlayedLegacy}
              accentClass='border-orange-500/20 dark:border-orange-500/10'
              badgeClass='border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300'
            />
          )}
          {smallworldAvailable && (
            <QueueCard
              queue='Smallworld'
              mmr={hasSmallworld ? Math.round(smallWorldUserRank?.mmr) : null}
              rank={
                !!smallworldLeaderboard &&
                isNonNullish(smallWorldUserRank?.rank)
                  ? smallWorldUserRank.rank
                  : null
              }
              rankIcon={
                hasSmallworld
                  ? getRankData(smallWorldUserRank?.mmr, 'smallworld')
                  : null
              }
              lastGame={lastSmallworldGame ?? null}
              mostPlayed={mostPlayedSmallworld}
              accentClass='border-cyan-500/20 dark:border-cyan-500/10'
              badgeClass='border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-300'
            />
          )}
          {vanillaAvailable && (
            <QueueCard
              queue='Vanilla'
              mmr={hasVanilla ? Math.round(vanillaUserRank?.mmr) : null}
              rank={
                !!vanillaLeaderboard && isNonNullish(vanillaUserRank?.rank)
                  ? vanillaUserRank.rank
                  : null
              }
              rankIcon={
                hasVanilla ? getRankData(vanillaUserRank?.mmr, 'vanilla') : null
              }
              lastGame={lastVanillaGame ?? null}
              mostPlayed={mostPlayedVanilla}
              accentClass='border-amber-500/20 dark:border-amber-500/10'
              badgeClass='border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
            />
          )}
        </div>

        {/* ── Performance Summary ── */}
        <div className='mt-3 rounded-lg border bg-card p-4'>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
            <div className='flex items-center gap-6'>
              <div className='flex items-center gap-3'>
                <Swords className='size-4 text-muted-foreground' />
                <div>
                  <span className='font-bold text-lg tabular-nums'>
                    {meaningful_games}
                  </span>
                  <span className='ml-1.5 text-muted-foreground text-sm'>
                    games
                  </span>
                </div>
              </div>
              <div className='h-5 w-px bg-border' />
              <div className='flex items-center gap-4'>
                <span className='font-semibold text-emerald-600 tabular-nums dark:text-emerald-400'>
                  {wins}
                  <span className='ml-1 font-normal text-muted-foreground text-xs'>
                    W
                  </span>
                </span>
                <span className='font-semibold text-rose-600 tabular-nums dark:text-rose-400'>
                  {losses}
                  <span className='ml-1 font-normal text-muted-foreground text-xs'>
                    L
                  </span>
                </span>
                {ties > 0 && (
                  <span className='font-semibold text-muted-foreground tabular-nums'>
                    {ties}
                    <span className='ml-1 font-normal text-xs'>T</span>
                  </span>
                )}
              </div>
            </div>

            <div className='flex items-center gap-4'>
              {/* Win rate bar */}
              <div className='flex items-center gap-2.5'>
                <div className='h-2 w-24 overflow-hidden rounded-full bg-rose-500/20 sm:w-32'>
                  <div
                    className='h-full rounded-full bg-emerald-500 transition-all duration-500'
                    style={{ width: `${winRate}%` }}
                  />
                </div>
                <span className='font-semibold text-sm tabular-nums'>
                  {winRate}%
                </span>
              </div>
              {avgOpponentMmr > 0 && (
                <>
                  <div className='hidden h-5 w-px bg-border sm:block' />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className='hidden cursor-default text-muted-foreground text-sm sm:inline-flex sm:items-center sm:gap-1'>
                          Avg opp.{' '}
                          <span className='font-medium text-foreground tabular-nums'>
                            {Math.round(avgOpponentMmr)}
                          </span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Average opponent MMR in ranked
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <Tabs
          defaultValue='matches'
          value={activeTab}
          onValueChange={setActiveTab}
          className='mt-6 pb-8'
        >
          <div className='mb-4 flex items-center gap-2'>
            {/* Mobile/tablet: dropdown */}
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className='w-full md:hidden'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAB_OPTIONS.map((tab) => (
                  <SelectItem key={tab.value} value={tab.value}>
                    {tab.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Desktop: inline tabs */}
            <TabsList className='hidden md:inline-flex'>
              {TAB_OPTIONS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className='hidden flex-1 md:block' />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant='outline' className='shrink-0 gap-1.5'>
                  <ListFilter className='size-4' />
                  <span className='hidden sm:inline'>Filters</span>
                  {(leaderboardFilter !== 'all' || filter !== 'all') && (
                    <span className='flex size-4 items-center justify-center rounded-full bg-violet-500 font-medium text-[10px] text-white'>
                      {(leaderboardFilter !== 'all' ? 1 : 0) +
                        (filter !== 'all' ? 1 : 0)}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align='end' className='w-60 space-y-4'>
                <div className='space-y-1.5'>
                  <Label className='font-medium text-muted-foreground text-xs'>
                    Queue
                  </Label>
                  <Select
                    value={leaderboardFilter}
                    onValueChange={setLeaderboardFilter}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue placeholder='Queue' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>All Queues</SelectItem>
                      <SelectItem value='ranked'>Ranked</SelectItem>
                      <SelectItem value='smallworld'>Smallworld</SelectItem>
                      <SelectItem value='vanilla'>Vanilla</SelectItem>
                      <SelectItem value='legacy'>Legacy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label className='font-medium text-muted-foreground text-xs'>
                    Result
                  </Label>
                  <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className='w-full'>
                      <SelectValue placeholder='Result' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>All</SelectItem>
                      <SelectItem value='wins'>Wins</SelectItem>
                      <SelectItem value='losses'>Losses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <TabsContent value='matches' className='m-0'>
            <GamesTable
              userId={id}
              season={season}
              leaderboardFilter={leaderboardFilter}
              resultFilter={filter}
            />
          </TabsContent>
          <TabsContent value='opponents' className='m-0'>
            <OpponentsTable
              userId={id}
              season={season}
              gameType={
                leaderboardFilter === 'all'
                  ? undefined
                  : (leaderboardFilter as
                      | 'ranked'
                      | 'smallworld'
                      | 'vanilla'
                      | 'legacy'
                      | 'sandbox'
                      | 'casual')
              }
              result={
                filter === 'wins'
                  ? 'win'
                  : filter === 'losses'
                    ? 'loss'
                    : undefined
              }
            />
          </TabsContent>
          <TabsContent value='mmr-trends' className='m-0'>
            <div className='overflow-hidden rounded-lg border'>
              <div className='overflow-x-auto'>
                <MmrTrendChart
                  games={games}
                  season={season}
                  queueType={leaderboardFilter}
                />
              </div>
            </div>
          </TabsContent>
          <TabsContent value='winrate-trends' className='m-0'>
            <div className='overflow-hidden rounded-lg border'>
              <div className='overflow-x-auto'>
                <WinrateTrendChart
                  games={games}
                  season={season}
                  queueType={leaderboardFilter}
                />
              </div>
            </div>
          </TabsContent>
          <TabsContent value='deck-stake-stats' className='m-0'>
            <DeckStakeStatsChart games={filteredGames} season={season} />
          </TabsContent>
          <TabsContent value='bounties' className='m-0'>
            <BountiesSection bounties={bounties} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

/* ── Queue Card ── */

interface QueueCardProps {
  queue: string
  mmr: number | null
  rank: number | null
  rankIcon: { enhancement: string; tooltip: string } | null
  lastGame: {
    mmrChange: number
  } | null
  mostPlayed: { deck: string; stake: string }
  accentClass: string
  badgeClass: string
}

function QueueCard({
  queue,
  mmr,
  rank,
  rankIcon,
  lastGame,
  mostPlayed,
  accentClass,
  badgeClass,
}: QueueCardProps) {
  const hasData = mmr !== null

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-colors',
        accentClass,
        !hasData && 'hidden lg:block'
      )}
    >
      <div className='mb-3 flex items-center justify-between'>
        <Badge variant='outline' className={cn('text-xs', badgeClass)}>
          {queue}
        </Badge>
        {rank !== null && (
          <span className='text-muted-foreground text-xs tabular-nums'>
            #{rank}
          </span>
        )}
      </div>

      {hasData ? (
        <>
          <div className='flex items-center gap-2.5'>
            {rankIcon && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Image
                      src={rankIcon.enhancement}
                      alt={rankIcon.tooltip}
                      width={28}
                      height={28}
                      className='size-7'
                      unoptimized
                    />
                  </TooltipTrigger>
                  <TooltipContent>{rankIcon.tooltip}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <span className='font-bold text-2xl tabular-nums'>{mmr}</span>
            {lastGame && lastGame.mmrChange !== 0 && (
              <span
                className={cn(
                  'ml-auto inline-flex items-center font-medium text-xs tabular-nums',
                  lastGame.mmrChange > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                )}
              >
                {lastGame.mmrChange > 0 ? (
                  <ChevronUp className='size-3' />
                ) : (
                  <ChevronDown className='size-3' />
                )}
                {numberFormatter.format(Math.trunc(lastGame.mmrChange))}
              </span>
            )}
            {lastGame && lastGame.mmrChange === 0 && (
              <span className='ml-auto text-muted-foreground text-xs'>
                Tied
              </span>
            )}
          </div>

          {mostPlayed.deck !== 'unknown' && (
            <div className='mt-3 flex items-center gap-2 border-t pt-3'>
              <span className='text-muted-foreground text-xs'>Favorite</span>
              <div className='ml-auto flex items-center gap-1.5'>
                <DeckImage
                  deck={mostPlayed.deck}
                  width={16}
                  height={22}
                  className='h-5 w-auto'
                />
                <StakeImage
                  stake={mostPlayed.stake}
                  width={20}
                  height={20}
                  className='size-5'
                />
                <span className='text-muted-foreground text-xs capitalize'>
                  {mostPlayed.deck} / {mostPlayed.stake}
                </span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className='flex h-16 items-center justify-center'>
          <span className='text-muted-foreground text-sm'>No data</span>
        </div>
      )}
    </div>
  )
}

/* ── Bounties Section ── */

function bountyNameToIconPath(bountyName: string): string {
  console.log(bountyName)
  const slug = bountyName
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
  return `/bounties/${slug}.png`
}

function BountyIcon({ bounty }: { bounty: UserBounty }) {
  const [open, setOpen] = useState(false)
  const [imgError, setImgError] = useState(false)
  return (
    <>
      <TooltipProvider key={bounty.id}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              onClick={() => setOpen(true)}
              className='flex flex-col items-center gap-1.5 transition-opacity hover:opacity-80'
            >
              <div
                className={cn(
                  'relative rounded-md',
                  bounty.is_first &&
                    'shadow-[0_0_12px_4px_rgba(251,191,36,0.5)] ring-2 ring-amber-400/80 ring-offset-1 ring-offset-background'
                )}
              >
                <Image
                  src={
                    imgError
                      ? '/bounties/placeholder.png'
                      : bountyNameToIconPath(bounty.bounty_name)
                  }
                  alt={bounty.bounty_name}
                  width={256}
                  height={256}
                  className='size-24 rounded-md object-contain'
                  unoptimized
                  onError={() => setImgError(true)}
                />
              </div>
              <span className='line-clamp-2 max-w-24 text-center text-muted-foreground text-xs leading-tight'>
                {bounty.bounty_name}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent className='max-w-48'>
            <p className='font-semibold'>{bounty.bounty_name}</p>
            <p className='mt-0.5 text-xs'>{bounty.description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[80vh] max-w-2xl overflow-y-auto pt-10'>
          <DialogTitle className='sr-only'>{bounty.bounty_name}</DialogTitle>
          <BountyCompletions bountyName={bounty.bounty_name} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function BountiesSection({ bounties }: { bounties: UserBounty[] }) {
  if (bounties.length === 0) {
    return (
      <div className='flex h-32 items-center justify-center rounded-lg border'>
        <span className='text-muted-foreground text-sm'>
          No bounties earned yet
        </span>
      </div>
    )
  }

  const firstCompletions = bounties.filter((b) => b.is_first)
  const regularCompletions = bounties.filter((b) => !b.is_first)

  return (
    <div className='space-y-4 rounded-lg border bg-card p-4'>
      {firstCompletions.length > 0 && (
        <div>
          <h3 className='mb-3 font-semibold text-amber-500 text-md dark:text-amber-400'>
            First Completions
          </h3>
          <div className='flex flex-wrap gap-4'>
            {firstCompletions.map((bounty) => (
              <BountyIcon key={bounty.id} bounty={bounty} />
            ))}
          </div>
        </div>
      )}
      {regularCompletions.length > 0 && (
        <div>
          <h3 className='mb-3 font-semibold text-md'>Completions</h3>
          <div className='flex flex-wrap gap-4'>
            {regularCompletions.map((bounty) => (
              <BountyIcon key={bounty.id} bounty={bounty} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
