'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmCard } from '@/components/admin/confirm-card'
import { Button } from '@/components/ui/button'
import { ApiError, apiFetch, apiFetchWithReason } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { ActiveSeasonCard } from './components/active-season-card'
import { NewSeasonCard } from './components/new-season-card'
import { SeasonReplayPanel } from './components/season-replay-panel'
import { SeasonsTable } from './components/seasons-table'
import { formatDay, type Season } from './components/seasons-types'

interface SeasonsResponse {
  seasons: Season[]
}

const END_PRESETS = [
  'Reached its end date',
  'Started by mistake',
  'Rating reset needed',
]
const ACTIVATE_PRESETS = ['Wrong season ended', 'Reopened by mistake']

type Pending = { kind: 'end' | 'activate'; season: Season } | null

export default function AdminSeasonsPage() {
  const { isAdmin, isModerator, isOwner, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [confirm, setConfirm] = useState<Pending>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const canAccess = isAdmin || isModerator

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data, isLoading } = useQuery<SeasonsResponse>({
    queryKey: ['admin-seasons'],
    queryFn: () => apiFetch('/webadmin/seasons'),
    enabled: canAccess,
  })
  const seasons = data?.seasons ?? []
  const active = seasons.find((s) => s.active)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-seasons'] })
  const onErr = (e: unknown) =>
    toast.error(
      e instanceof ApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Request failed'
    )

  const createMut = useMutation({
    mutationFn: (body: { name: string; endsAt: string | null }) =>
      apiFetchWithReason('/webadmin/seasons', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setName('')
      setEndsAt('')
      toast.success('Season started')
      invalidate()
    },
    onError: onErr,
  })

  const actMut = useMutation({
    mutationFn: ({
      kind,
      season,
      note,
    }: {
      kind: 'end' | 'activate'
      season: Season
      note: string
    }) =>
      apiFetchWithReason(
        `/webadmin/seasons/${season.id}/${kind}`,
        { method: 'POST' },
        note
      ),
    onSuccess: (_d, v) => {
      toast.success(v.kind === 'end' ? 'Season ended' : 'Season activated')
      setConfirm(null)
      invalidate()
    },
    onError: onErr,
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  const busy = actMut.isPending
  const confirmCard = confirm && (
    <ConfirmCard
      key={`${confirm.kind}-${confirm.season.id}`}
      title={
        confirm.kind === 'end'
          ? `End ${confirm.season.name}?`
          : `Activate ${confirm.season.name}?`
      }
      rows={
        confirm.kind === 'end'
          ? [
              {
                label: confirm.season.name,
                value: (
                  <>
                    <s className='text-muted-foreground'>Active</s> to Ended
                    today
                  </>
                ),
              },
              {
                label: 'New results',
                value: 'Go under no season until you start or activate one',
              },
              {
                label: 'Leaderboard',
                value: `The ${confirm.season.name} board freezes`,
              },
            ]
          : [
              {
                label: confirm.season.name,
                value: <>Ended {formatDay(confirm.season.endedAt)} to Active</>,
              },
              {
                label: 'Current season',
                value: active ? `${active.name} ends now` : 'None is active',
              },
              {
                label: 'New results',
                value: `Go under ${confirm.season.name}`,
              },
            ]
      }
      presets={confirm.kind === 'end' ? END_PRESETS : ACTIVATE_PRESETS}
      placeholder={
        confirm.kind === 'end' ? 'Why end this season?' : 'Why activate it?'
      }
      confirmLabel={
        confirm.kind === 'end'
          ? `End ${confirm.season.name}`
          : `Activate ${confirm.season.name}`
      }
      pending={busy}
      onCancel={() => setConfirm(null)}
      onConfirm={(note) =>
        actMut.mutate({ kind: confirm.kind, season: confirm.season, note })
      }
    />
  )

  return (
    <div className='container max-w-6xl space-y-6 py-8'>
      <div className='text-muted-foreground text-sm'>
        Staff / Ops / <span className='text-primary'>Seasons</span>
      </div>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div className='flex flex-wrap items-baseline gap-x-4'>
          <h1 className='font-pixel text-4xl'>Seasons</h1>
          <p className='text-muted-foreground text-sm'>
            The active season is the one results and leaderboards are recorded
            under.
          </p>
        </div>
        <Button onClick={() => nameRef.current?.focus()}>New season</Button>
      </div>

      <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]'>
        <div className='space-y-6'>
          <ActiveSeasonCard
            season={active}
            busy={busy}
            onEnd={(season) => setConfirm({ kind: 'end', season })}
          />
          <SeasonsTable
            seasons={seasons}
            isLoading={isLoading}
            busy={busy}
            onEnd={(season) => setConfirm({ kind: 'end', season })}
            onActivate={(season) => setConfirm({ kind: 'activate', season })}
          />
          {isOwner && <SeasonReplayPanel />}
        </div>
        <div className='space-y-6'>
          {confirmCard}
          <NewSeasonCard
            name={name}
            endsAt={endsAt}
            isPending={createMut.isPending}
            nameRef={nameRef}
            onNameChange={setName}
            onEndsAtChange={setEndsAt}
            onSubmit={(n, e) => createMut.mutate({ name: n, endsAt: e })}
          />
        </div>
      </div>
    </div>
  )
}
