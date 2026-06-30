// Leaderboards are temporarily disabled. The full implementation is preserved
// (commented out) below; restore it to re-enable the page.

export default function LeaderboardsPage() {
  return (
    <div className='mx-auto flex min-h-[60vh] w-full max-w-fd-container items-center justify-center py-20'>
      <h1 className='font-bold text-3xl tracking-tight text-muted-foreground'>
        Coming Soon
      </h1>
    </div>
  )
}

// ===================== ORIGINAL LEADERBOARDS PAGE (disabled) =====================
// 'use client'
//
// import { useQuery } from '@tanstack/react-query'
// import { parseAsInteger, parseAsString, useQueryState } from 'nuqs'
// import { Suspense, useEffect, useState } from 'react'
// import { apiFetch } from '@/lib/api'
// import {
//   LEADERBOARD_CATEGORIES,
//   firstMode,
//   formatMetric,
//   gameModeKey,
//   getCategory,
//   getMode,
// } from '@/lib/leaderboards'
// import { Badge } from '@/components/ui/badge'
// import { Button } from '@/components/ui/button'
// import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
// import { Input } from '@/components/ui/input'
//
// interface Season {
//   id: number
//   name: string
//   startedAt: string
//   endsAt: string | null
//   endedAt: string | null
// }
//
// interface LeaderboardEntry {
//   rank: number
//   playerId: string
//   displayName: string
//   rating: number
//   wins: number
//   losses: number
//   gamesPlayed: number
//   seasonBest: number | null
// }
//
// interface SeasonsResponse {
//   seasons: Season[]
//   current: number | null
// }
//
// interface LeaderboardResponse {
//   season: number
//   modId: string
//   gameMode: string
//   page: number
//   pageSize: number
//   total: number
//   totalPages: number
//   entries: LeaderboardEntry[]
// }
//
// export default function LeaderboardsPage() {
//   // useQueryState() reads search params; wrap in Suspense so static prerender
//   // doesn't bail out of CSR.
//   return (
//     <Suspense fallback={<div className='container py-8 text-muted-foreground'>Loading…</div>}>
//       <LeaderboardsContent />
//     </Suspense>
//   )
// }
//
// function LeaderboardsContent() {
//   const [search, setSearch] = useState('')
//   const [categoryParam, setCategoryParam] = useQueryState(
//     'category',
//     parseAsString.withDefault('speedrun'),
//   )
//   const [modeParam, setModeParam] = useQueryState('mode', parseAsString)
//   const [seasonParam, setSeasonParam] = useQueryState('season', parseAsInteger)
//   const [page, setPage] = useState(1)
//   const [debouncedSearch, setDebouncedSearch] = useState('')
//
//   // Debounce the search box, and reset to page 1 when the term changes — the
//   // server searches the whole list, so a match can live on any page.
//   useEffect(() => {
//     const t = setTimeout(() => {
//       setDebouncedSearch(search)
//       setPage(1)
//     }, 300)
//     return () => clearTimeout(t)
//   }, [search])
//
//   const category = getCategory(categoryParam)
//   const mode = getMode(category, modeParam)
//
//   const { data: seasonsData } = useQuery<SeasonsResponse>({
//     queryKey: ['seasons'],
//     queryFn: () => apiFetch('/stats/seasons'),
//   })
//
//   const seasons = seasonsData?.seasons ?? []
//   const currentSeasonId = seasonsData?.current ?? seasons.at(-1)?.id ?? null
//   const selectedSeason = seasonParam ?? currentSeasonId
//
//   const { data: leaderboardData, isLoading: lbLoading } = useQuery<LeaderboardResponse>({
//     queryKey: ['leaderboard', category.modId, mode.id, selectedSeason, page, debouncedSearch],
//     queryFn: () =>
//       apiFetch(
//         `/stats/leaderboard?modId=${encodeURIComponent(category.modId)}&gameMode=${encodeURIComponent(gameModeKey(mode.id))}${selectedSeason != null ? `&season=${selectedSeason}` : ''}&page=${page}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`,
//       ),
//     enabled: selectedSeason != null,
//     placeholderData: (prev) => prev,
//   })
//
//   const entries = leaderboardData?.entries ?? []
//
//   return (
//     <div className='container py-8 space-y-6'>
//       <div className='space-y-1'>
//         <h1 className='text-3xl font-bold tracking-tight'>Leaderboards</h1>
//         <p className='text-muted-foreground'>Ranked standings by game and mode, per season.</p>
//       </div>
//
//       {/* Category selector (Speedrun / PvP) */}
//       <div className='flex flex-wrap gap-2'>
//         {LEADERBOARD_CATEGORIES.map((c) => (
//           <button
//             key={c.id}
//             type='button'
//             onClick={() => {
//               setCategoryParam(c.id === 'speedrun' ? null : c.id)
//               setModeParam(null)
//               setPage(1)
//             }}
//             className={`rounded-md border px-4 py-2 text-sm font-bold transition-colors ${
//               category.id === c.id
//                 ? 'bg-primary text-primary-foreground border-primary'
//                 : 'bg-muted text-muted-foreground border-border hover:bg-accent'
//             }`}
//           >
//             {c.label}
//           </button>
//         ))}
//       </div>
//
//       {/* Mode tabs (depend on category) */}
//       <div className='flex flex-wrap gap-1 border-b border-border'>
//         {category.modes.map((m) => (
//           <button
//             key={m.id}
//             type='button'
//             onClick={() => {
//               setModeParam(m.id === firstMode(category).id ? null : m.id)
//               setPage(1)
//             }}
//             className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
//               mode.id === m.id
//                 ? 'border-primary text-foreground'
//                 : 'border-transparent text-muted-foreground hover:text-foreground'
//             }`}
//           >
//             {m.label}
//           </button>
//         ))}
//       </div>
//
//       {/* Season pills */}
//       {seasons.length > 0 && (
//         <div className='flex flex-wrap gap-2'>
//           {seasons.map((s) => (
//             <button
//               key={s.id}
//               type='button'
//               onClick={() => {
//                 setSeasonParam(s.id === currentSeasonId ? null : s.id)
//                 setPage(1)
//               }}
//               className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
//                 selectedSeason === s.id
//                   ? 'bg-primary text-primary-foreground border-primary'
//                   : 'bg-muted text-muted-foreground border-border hover:bg-accent'
//               }`}
//             >
//               {s.name ?? `Season ${s.id}`}
//               {s.id === currentSeasonId && (
//                 <span className='ml-1.5 text-[10px] text-bal-green'>LIVE</span>
//               )}
//             </button>
//           ))}
//         </div>
//       )}
//
//       {/* Search + table */}
//       <div className='space-y-4'>
//         <Input
//           placeholder='Search players…'
//           value={search}
//           onChange={(e) => setSearch(e.target.value)}
//           className='max-w-sm'
//         />
//
//         <Card>
//           <CardHeader>
//             <CardTitle className='text-base'>
//               {category.label} · {mode.label} · Season {selectedSeason ?? '…'}
//             </CardTitle>
//           </CardHeader>
//           <CardContent className='p-0'>
//             {lbLoading ? (
//               <p className='p-6 text-sm text-muted-foreground'>Loading…</p>
//             ) : entries.length === 0 ? (
//               <p className='p-6 text-sm text-muted-foreground'>No entries found.</p>
//             ) : (
//               <div className='overflow-x-auto'>
//                 <table className='w-full text-sm font-readable'>
//                   <thead>
//                     <tr className='border-b border-border bg-muted/40'>
//                       {['Rank', 'Player', 'Rating', category.metricLabel, 'W', 'L', 'Games'].map(
//                         (h) => (
//                           <th
//                             key={h}
//                             className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground'
//                           >
//                             {h}
//                           </th>
//                         ),
//                       )}
//                     </tr>
//                   </thead>
//                   <tbody className='divide-y divide-border'>
//                     {entries.map((entry) => (
//                       <tr key={entry.playerId} className='hover:bg-muted/30 transition-colors'>
//                         <td className='px-4 py-3'>
//                           <RankBadge rank={entry.rank} />
//                         </td>
//                         <td className='px-4 py-3 font-semibold'>
//                           <a
//                             href={`/players/${entry.playerId}`}
//                             className='hover:text-primary transition-colors'
//                           >
//                             {entry.displayName}
//                           </a>
//                         </td>
//                         <td className='px-4 py-3 font-bold text-bal-gold'>
//                           {Math.round(entry.rating)}
//                         </td>
//                         <td className='px-4 py-3 font-semibold text-bal-blue'>
//                           {formatMetric(category.metric, entry.seasonBest)}
//                         </td>
//                         <td className='px-4 py-3 text-bal-green'>{entry.wins}</td>
//                         <td className='px-4 py-3 text-bal-red'>{entry.losses}</td>
//                         <td className='px-4 py-3 text-muted-foreground'>{entry.gamesPlayed}</td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//             )}
//           </CardContent>
//         </Card>
//
//         {(leaderboardData?.totalPages ?? 1) > 1 && (
//           <div className='flex items-center justify-between'>
//             <span className='text-xs text-muted-foreground'>
//               {leaderboardData ? `${leaderboardData.total} ranked players` : ''}
//             </span>
//             <div className='flex items-center gap-2'>
//               <Button
//                 variant='outline'
//                 size='sm'
//                 onClick={() => setPage((p) => Math.max(1, p - 1))}
//                 disabled={page <= 1}
//               >
//                 Previous
//               </Button>
//               <span className='text-sm text-muted-foreground'>
//                 Page {page} of {leaderboardData?.totalPages ?? 1}
//               </span>
//               <Button
//                 variant='outline'
//                 size='sm'
//                 onClick={() => setPage((p) => Math.min(leaderboardData?.totalPages ?? 1, p + 1))}
//                 disabled={page >= (leaderboardData?.totalPages ?? 1)}
//               >
//                 Next
//               </Button>
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   )
// }
//
// function RankBadge({ rank }: { rank: number }) {
//   if (rank === 1) return <Badge className='bg-yellow-500/20 text-bal-gold border-yellow-500/30'>#1</Badge>
//   if (rank === 2) return <Badge className='bg-slate-400/20 text-slate-300 border-slate-400/30'>#2</Badge>
//   if (rank === 3) return <Badge className='bg-amber-700/20 text-bal-orange border-amber-700/30'>#3</Badge>
//   return <span className='text-muted-foreground text-sm'>#{rank}</span>
// }
