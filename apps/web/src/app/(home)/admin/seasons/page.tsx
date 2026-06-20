'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleDateString() : '—'
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
    toast.error(e instanceof Error ? e.message : 'Request failed')

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

  const seasons = data?.seasons ?? []

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

      <div className='overflow-hidden rounded-lg border border-border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Ends</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className='text-right'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className='text-muted-foreground'>
                  Loading…
                </TableCell>
              </TableRow>
            ) : seasons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className='text-muted-foreground'>
                  No seasons yet
                </TableCell>
              </TableRow>
            ) : (
              seasons.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.id}</TableCell>
                  <TableCell className='font-medium'>{s.name}</TableCell>
                  <TableCell>{fmt(s.startedAt)}</TableCell>
                  <TableCell>{fmt(s.endsAt)}</TableCell>
                  <TableCell>
                    {s.active ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant='outline'>Ended</Badge>
                    )}
                  </TableCell>
                  <TableCell className='text-right'>
                    {s.active ? (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => endMut.mutate(s.id)}
                        disabled={endMut.isPending}
                      >
                        End
                      </Button>
                    ) : (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => activateMut.mutate(s.id)}
                        disabled={activateMut.isPending}
                      >
                        Activate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Season</DialogTitle>
            <DialogDescription>
              Starts a new season and makes it active — this ends the current
              season.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='s-name'>Name</Label>
              <Input
                id='s-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='Season 1'
                disabled={createMut.isPending}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='s-ends'>Ends at (optional — defaults to +90 days)</Label>
              <Input
                id='s-ends'
                type='date'
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                disabled={createMut.isPending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setOpen(false)}
              disabled={createMut.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!name.trim()) {
                  toast.error('Name is required')
                  return
                }
                createMut.mutate({
                  name: name.trim(),
                  endsAt: endsAt ? new Date(endsAt).toISOString() : null,
                })
              }}
              disabled={createMut.isPending}
            >
              {createMut.isPending ? 'Starting…' : 'Start Season'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
