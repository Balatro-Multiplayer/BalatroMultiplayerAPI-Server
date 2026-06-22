'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { NewSeasonDialog } from './components/new-season-dialog'
import { SeasonsTable } from './components/seasons-table'

interface Season {
  id: number
  name: string
  startedAt: string
  endsAt: string | null
  endedAt: string | null
  active: boolean
}

interface SeasonsResponse {
  seasons: Season[]
}

export default function AdminSeasonsPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [endsAt, setEndsAt] = useState('')

  const canAccess = isAdmin || isModerator

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data, isLoading } = useQuery<SeasonsResponse>({
    queryKey: ['admin-seasons'],
    queryFn: () => apiFetch('/webadmin/seasons'),
    enabled: canAccess,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-seasons'] })
  const onErr = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Request failed')

  const createMut = useMutation({
    mutationFn: (body: { name: string; endsAt: string | null }) =>
      apiFetch('/webadmin/seasons', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setOpen(false)
      setName('')
      setEndsAt('')
      toast.success('Season started')
      invalidate()
    },
    onError: onErr,
  })

  const activateMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/webadmin/seasons/${id}/activate`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Season activated')
      invalidate()
    },
    onError: onErr,
  })

  const endMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/webadmin/seasons/${id}/end`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Season ended')
      invalidate()
    },
    onError: onErr,
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  return (
    <div className='container max-w-4xl py-8 space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Seasons</h1>
          <p className='text-sm text-muted-foreground'>
            Start, activate, and end ranked seasons. The active season is the one
            results and leaderboards are recorded under.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>New Season</Button>
      </div>

      <SeasonsTable
        seasons={data?.seasons ?? []}
        isLoading={isLoading}
        activatePending={activateMut.isPending}
        endPending={endMut.isPending}
        onActivate={(id) => activateMut.mutate(id)}
        onEnd={(id) => endMut.mutate(id)}
      />

      <NewSeasonDialog
        open={open}
        name={name}
        endsAt={endsAt}
        isPending={createMut.isPending}
        onNameChange={setName}
        onEndsAtChange={setEndsAt}
        onClose={() => setOpen(false)}
        onSubmit={(n, e) => createMut.mutate({ name: n, endsAt: e })}
      />
    </div>
  )
}
