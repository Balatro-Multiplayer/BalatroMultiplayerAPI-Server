'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs'
import { Suspense, useEffect, useState } from 'react'
import {
  ContentCard,
  EmptyLine,
  PageHeader,
  PageShell,
} from '@/components/page-kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import {
  type BoardCounts,
  pickCategory,
  pickMode,
  sortCategoriesByEntries,
  sortModesByEntries,
} from '@/lib/leaderboard-order'
import {
  formatMetric,
  gameModeKey,
  LEADERBOARD_CATEGORIES,
} from '@/lib/leaderboards'

interface Season {
  id: number
  name: string
  startedAt: string
  endsAt: string | null
  endedAt: string | null
}

interface LeaderboardEntry {
  rank: number
  playerId: string
  displayName: string
  rating: number
  wins: number
  losses: number
  gamesPlayed: number
  seasonBest: number | string | null
}

interface BoardCountsResponse {
  season: number | null
  counts: BoardCounts
}

interface SeasonsResponse {
  seasons: Season[]
  current: number | null
}

interface LeaderboardResponse {
  season: number
  modId: string
  gameMode: string
  page: number
  pageSize: number
  total: number
  totalPages: number
  entries: LeaderboardEntry[]
}

export default function LeaderboardsPage() {
  // useQueryState() reads search params; wrap in Suspense so static prerender
  // doesn't bail out of CSR.
  return (
    <Suspense
      fallback={
        <div className='container py-8 text-muted-foreground'>Loading…</div>
      }
    >
      <LeaderboardsContent />
    </Suspense>
  )
}

function LeaderboardsContent() {
  const [search, setSearch] = useState('')
  const [categoryParam, setCategoryParam] = useQueryState(
    'category',
    parseAsString
  )
  const [modeParam, setModeParam] = useQueryState('mode', parseAsString)
  const [seasonParam, setSeasonParam] = useQueryState('season', parseAsInteger)
  const [page, setPage] = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce the search box, and reset to page 1 when the term changes — the
  // server searches the whole list, so a match can live on any page.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  // Mods and game modes are ordered by their entries in the current season.
  // With no choice in the URL the page opens on the biggest of each.
  const { data: countsData, isLoading: countsLoading } =
    useQuery<BoardCountsResponse>({
      queryKey: ['leaderboard-counts'],
      queryFn: () => apiFetch('/stats/leaderboard-counts'),
      staleTime: 10 * 60 * 1000,
    })
  const counts = countsData?.counts ?? {}
  const categories = sortCategoriesByEntries(LEADERBOARD_CATEGORIES, counts)
  const category = pickCategory(categories, categoryParam)
  const modes = sortModesByEntries(category, counts)
  const mode = pickMode(modes, modeParam)

  const { data: seasonsData } = useQuery<SeasonsResponse>({
    queryKey: ['seasons'],
    queryFn: () => apiFetch('/stats/seasons'),
  })

  const seasons = seasonsData?.seasons ?? []
  const currentSeasonId = seasonsData?.current ?? seasons.at(-1)?.id ?? null
  const selectedSeason = seasonParam ?? currentSeasonId

  const { data: leaderboardData, isLoading: lbLoading } =
    useQuery<LeaderboardResponse>({
      queryKey: [
        'leaderboard',
        category.modId,
        mode.id,
        selectedSeason,
        page,
        debouncedSearch,
      ],
      queryFn: () =>
        apiFetch(
          `/stats/leaderboard?modId=${encodeURIComponent(category.modId)}&gameMode=${encodeURIComponent(gameModeKey(mode.id))}${selectedSeason != null ? `&season=${selectedSeason}` : ''}&page=${page}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`
        ),
      enabled:
        selectedSeason != null &&
        (!countsLoading || (categoryParam != null && modeParam != null)),
      placeholderData: (prev) => prev,
    })

  const entries = leaderboardData?.entries ?? []

  return (
    <PageShell>
      <PageHeader
        title='Leaderboards'
        meta='Ranked standings by game and mode, per season.'
      />

      {/* Mod selector, biggest board first */}
      <div className='flex flex-wrap gap-2'>
        {categories.map((c) => (
          <button
            key={c.id}
            type='button'
            onClick={() => {
              setCategoryParam(c.id)
              setModeParam(null)
              setPage(1)
            }}
            className={`rounded-md border px-4 py-2 font-pixel text-lg transition-colors ${
              category.id === c.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Game mode tabs, biggest board first */}
      <div className='flex flex-wrap gap-1 border-border border-b'>
        {modes.map((m) => (
          <button
            key={m.id}
            type='button'
            onClick={() => {
              setModeParam(m.id)
              setPage(1)
            }}
            className={`-mb-px border-b-2 px-4 py-2 font-medium text-sm transition-colors ${
              mode.id === m.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Search + table */}
      <div className='space-y-4'>
        {seasons.length > 0 && (
          <div className='flex flex-wrap gap-2'>
            {seasons.map((s) => (
              <button
                key={s.id}
                type='button'
                onClick={() => {
                  setSeasonParam(s.id === currentSeasonId ? null : s.id)
                  setPage(1)
                }}
                className={`rounded-full border px-3 py-1 font-semibold text-xs transition-colors ${
                  selectedSeason === s.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {s.name ?? `Season ${s.id}`}
                {s.id === currentSeasonId && (
                  <span className='ml-1.5 text-[10px] text-bal-green'>
                    LIVE
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <Input
          placeholder='Search players...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-sm'
        />

        <ContentCard
          title={`${category.label} · ${mode.label} · Season ${selectedSeason ?? '...'}`}
          className='p-0 sm:p-0 [&>div:first-child]:px-4 [&>div:first-child]:pt-4'
        >
          {lbLoading ? (
            <EmptyLine>Loading...</EmptyLine>
          ) : entries.length === 0 ? (
            <div className='px-4 pb-4'>
              <EmptyLine>No entries found.</EmptyLine>
            </div>
          ) : (
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-border border-y text-muted-foreground text-xs'>
                  <th className='px-3 py-2 text-left font-medium sm:px-4'>
                    Rank
                  </th>
                  <th className='px-3 py-2 text-left font-medium sm:px-4'>
                    Player
                  </th>
                  <th className='px-3 py-2 text-left font-medium sm:px-4'>
                    Rating
                  </th>
                  <th className='hidden px-4 py-2 text-left font-medium md:table-cell'>
                    {category.metricLabel}
                  </th>
                  <th className='hidden px-4 py-2 text-left font-medium sm:table-cell'>
                    Wins
                  </th>
                  <th className='hidden px-4 py-2 text-left font-medium sm:table-cell'>
                    Losses
                  </th>
                  <th className='hidden px-4 py-2 text-left font-medium md:table-cell'>
                    Games
                  </th>
                  <th className='px-3 py-2 text-left font-medium sm:px-4'>
                    Win rate
                  </th>
                </tr>
              </thead>
              <tbody className='divide-y divide-border'>
                {entries.map((entry) => {
                  const g = entry.wins + entry.losses
                  return (
                    <tr
                      key={entry.playerId}
                      className='transition-colors hover:bg-muted/30'
                    >
                      <td className='px-3 py-3 sm:px-4'>
                        <RankBadge rank={entry.rank} />
                      </td>
                      <td className='max-w-0 px-3 py-3 font-medium sm:px-4'>
                        <Link
                          href={`/players/${entry.playerId}`}
                          className='block truncate hover:text-primary'
                        >
                          {entry.displayName}
                        </Link>
                      </td>
                      <td className='px-3 py-3 font-pixel text-bal-blue text-xl sm:px-4'>
                        {Math.round(entry.rating)}
                      </td>
                      <td className='hidden px-4 py-3 md:table-cell'>
                        {formatMetric(category.metric, entry.seasonBest)}
                      </td>
                      <td className='hidden px-4 py-3 sm:table-cell'>
                        {entry.wins}
                      </td>
                      <td className='hidden px-4 py-3 sm:table-cell'>
                        {entry.losses}
                      </td>
                      <td className='hidden px-4 py-3 md:table-cell'>
                        {entry.gamesPlayed}
                      </td>
                      <td className='px-3 py-3 text-muted-foreground sm:px-4'>
                        {g > 0 ? `${Math.round((entry.wins / g) * 100)}%` : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </ContentCard>

        {(leaderboardData?.totalPages ?? 1) > 1 && (
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-xs'>
              {leaderboardData ? `${leaderboardData.total} ranked players` : ''}
            </span>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className='text-muted-foreground text-sm'>
                Page {page} of {leaderboardData?.totalPages ?? 1}
              </span>
              <Button
                variant='outline'
                size='sm'
                onClick={() =>
                  setPage((p) =>
                    Math.min(leaderboardData?.totalPages ?? 1, p + 1)
                  )
                }
                disabled={page >= (leaderboardData?.totalPages ?? 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const color =
    rank === 1
      ? 'text-bal-gold'
      : rank === 2
        ? 'text-slate-300'
        : rank === 3
          ? 'text-bal-orange'
          : ''
  return <span className={`font-pixel text-xl ${color}`}>{rank}</span>
}
