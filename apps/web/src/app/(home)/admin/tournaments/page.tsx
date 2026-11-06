'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { CloseTournamentDialog } from './components/close-tournament-dialog'
import { TournamentList } from './components/tournament-list'
import {
  type AdminTournamentDetail,
  CLOSE_REASON_LABEL,
  FORMAT_LABEL,
  formatTime,
  isOver,
  type ListFilter,
  STATUS_LABEL,
  type TournamentsResponse,
} from './components/tournament-types'

const PAGE_SIZE = 50

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex justify-between gap-4 text-sm'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-right'>{children}</span>
    </div>
  )
}

function PlayerText({ text, empty }: { text: string; empty: string }) {
  return text.trim() === '' ? (
    <p className='text-muted-foreground text-sm'>{empty}</p>
  ) : (
    <p className='whitespace-pre-wrap break-words text-sm'>{text}</p>
  )
}

export default function AdminTournamentsPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const canAccess = isAdmin || isModerator
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ListFilter>('active')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data, error: listError } = useQuery<TournamentsResponse>({
    queryKey: ['admin-tournaments', search, filter, page],
    queryFn: () =>
      apiFetch(
        `/webadmin/tournaments?status=${filter}&page=${page}&limit=${PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
    enabled: canAccess,
    refetchInterval: 15_000,
  })

  const { data: detail } = useQuery<{ tournament: AdminTournamentDetail }>({
    queryKey: ['admin-tournament-detail', selectedId],
    queryFn: () => apiFetch(`/webadmin/tournaments/${selectedId}`),
    enabled: !!selectedId,
    refetchInterval: 15_000,
  })

  const closeMutation = useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      apiFetch(`/webadmin/tournaments/${vars.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ reason: vars.reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['admin-tournament-detail', selectedId],
      })
      qc.invalidateQueries({ queryKey: ['admin-tournaments'] })
      setClosing(false)
    },
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  const t = detail?.tournament
  const closeError =
    closeMutation.error instanceof ApiError
      ? closeMutation.error.message
      : closeMutation.error
        ? 'Could not close the tournament.'
        : null

  return (
    <div className='container space-y-6 py-8'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>Tournaments</h1>
        <p className='text-muted-foreground text-sm'>
          Every player-run tournament, private ones and drafts included. Check
          what players see and close a tournament that breaks the rules.
        </p>
        {listError && (
          <p className='mt-2 text-destructive text-sm'>
            {listError instanceof ApiError
              ? listError.message
              : 'Could not load tournaments.'}
          </p>
        )}
      </div>

      <div className='grid grid-cols-1 gap-6 font-readable lg:grid-cols-[340px_1fr]'>
        <TournamentList
          tournaments={data?.tournaments ?? []}
          total={data?.total ?? 0}
          selectedId={selectedId}
          search={search}
          filter={filter}
          page={page}
          limit={PAGE_SIZE}
          onSearchChange={setSearch}
          onFilterChange={setFilter}
          onSelect={setSelectedId}
          onPageChange={setPage}
        />

        <div>
          {!t ? (
            <div className='flex h-full min-h-[40vh] items-center justify-center rounded-lg border border-border border-dashed text-muted-foreground text-sm'>
              Select a tournament to review.
            </div>
          ) : (
            <div className='space-y-4'>
              <div className='flex items-start justify-between gap-4'>
                <div className='min-w-0'>
                  <h2 className='break-words font-bold text-lg tracking-tight'>
                    {t.name}
                  </h2>
                  <div className='mt-1 flex flex-wrap gap-1'>
                    <Badge
                      variant={
                        t.status === 'cancelled' ? 'destructive' : 'outline'
                      }
                      className='text-[10px]'
                    >
                      {STATUS_LABEL[t.status]}
                    </Badge>
                    <Badge variant='outline' className='text-[10px]'>
                      {t.visibility}
                    </Badge>
                    {t.official && (
                      <Badge
                        variant='outline'
                        className='text-[10px] text-bal-gold'
                      >
                        official
                      </Badge>
                    )}
                    {t.requireRanked && (
                      <Badge variant='outline' className='text-[10px]'>
                        ranked profile
                      </Badge>
                    )}
                  </div>
                </div>
                <Button
                  variant='destructive'
                  size='sm'
                  disabled={isOver(t.status)}
                  onClick={() => {
                    closeMutation.reset()
                    setClosing(true)
                  }}
                >
                  Close Tournament
                </Button>
              </div>

              {t.closed && (
                <Card>
                  <CardHeader>
                    <CardTitle className='text-base'>
                      {CLOSE_REASON_LABEL[t.closed.reason] ?? 'Cancelled'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-1'>
                    {t.closed.message && (
                      <p className='whitespace-pre-wrap break-words text-sm'>
                        {t.closed.message}
                      </p>
                    )}
                    <p className='text-muted-foreground text-xs'>
                      {formatTime(t.closed.at)}
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <PlayerText text={t.description} empty='No description.' />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Notice board</CardTitle>
                </CardHeader>
                <CardContent>
                  <PlayerText text={t.notice} empty='Empty.' />
                </CardContent>
              </Card>

              <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
                <Card>
                  <CardHeader>
                    <CardTitle className='text-base'>Details</CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-1'>
                    <Field label='Format'>
                      {FORMAT_LABEL[t.format] ?? t.format}
                    </Field>
                    <Field label='Game mode'>{t.gameMode}</Field>
                    <Field label='Ruleset'>{t.ruleset}</Field>
                    <Field label='Players'>
                      {t.entrants.length}/{t.maxPlayers}
                      {t.waitlist.length > 0 &&
                        ` (+${t.waitlist.length} waiting)`}
                    </Field>
                    <Field label='Invite code'>
                      <span className='font-mono'>{t.inviteCode}</span>
                    </Field>
                    <Field label='Created'>{formatTime(t.createdAt)}</Field>
                    <Field label={t.startedAt ? 'Started' : 'Starts'}>
                      {formatTime(t.startedAt ?? t.startsAt)}
                    </Field>
                    {t.finishedAt && (
                      <Field label='Ended'>{formatTime(t.finishedAt)}</Field>
                    )}
                    <Field label='Id'>
                      <span className='font-mono text-xs'>{t.id}</span>
                    </Field>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className='text-base'>Organisers</CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-1 text-sm'>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium'>{t.organiser.name}</span>
                      <Badge
                        variant='outline'
                        className='text-[10px] text-bal-gold'
                      >
                        organiser
                      </Badge>
                    </div>
                    {t.coOrganisers.map((c) => (
                      <div key={c.id} className='flex items-center gap-2'>
                        <span>{c.name || c.id}</span>
                        <Badge variant='outline' className='text-[10px]'>
                          co-organiser
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Players ({t.entrants.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {t.entrants.length === 0 ? (
                    <p className='text-muted-foreground text-sm'>
                      Nobody has joined.
                    </p>
                  ) : (
                    <div className='flex flex-wrap gap-2'>
                      {t.entrants.map((e) => (
                        <Badge
                          key={e.id}
                          variant='outline'
                          className={e.dropped ? 'opacity-60' : undefined}
                        >
                          {e.name}
                          {e.checkedIn && ' ✓'}
                          {e.dropped && ' (dropped out)'}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {t.waitlist.length > 0 && (
                    <p className='mt-3 text-muted-foreground text-xs'>
                      Waitlist: {t.waitlist.map((w) => w.name).join(', ')}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      <CloseTournamentDialog
        target={
          closing && t ? { name: t.name, players: t.entrants.length } : null
        }
        isPending={closeMutation.isPending}
        error={closeError}
        onConfirm={(reason) => t && closeMutation.mutate({ id: t.id, reason })}
        onClose={() => setClosing(false)}
      />
    </div>
  )
}
