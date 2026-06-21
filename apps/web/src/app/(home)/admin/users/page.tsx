'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AdminPlayer {
  id: string
  steamName: string
  discordUsername: string | null
  privileges: string[]
  chatEnabled: boolean
  chatBlocked: boolean
  tosAcceptedVersion: string | null
  createdAt: string
  updatedAt: string
  activeBans: number
}

interface PlayersResponse {
  players: AdminPlayer[]
  total: number
  page: number
  limit: number
}

interface Ban {
  id: number
  reason: string
  banType: string
  expiresAt: string | null
  liftedAt: string | null
  createdAt: string
}

interface PlayerDetailResponse {
  player: AdminPlayer
  bans: Ban[]
}

const BAN_TYPES = ['chat', 'queue', 'account']
const PRIVILEGES = ['admin', 'moderator', 'trusted', 'developer']

export default function AdminUsersPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const canAccess = isAdmin || isModerator
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [banReason, setBanReason] = useState('')
  const [banType, setBanType] = useState('chat')
  const [banExpiry, setBanExpiry] = useState('')
  const [privInput, setPrivInput] = useState('')

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data } = useQuery<PlayersResponse>({
    queryKey: ['admin-players', search, page],
    queryFn: () =>
      apiFetch(
        `/webadmin/players?page=${page}&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    enabled: canAccess,
  })

  const { data: detailResp } = useQuery<PlayerDetailResponse>({
    queryKey: ['admin-player-detail', selectedId],
    queryFn: () => apiFetch(`/webadmin/players/${selectedId}`),
    enabled: !!selectedId,
  })
  const detail = detailResp ? { ...detailResp.player, bans: detailResp.bans } : null

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-player-detail', selectedId] })
    qc.invalidateQueries({ queryKey: ['admin-players'] })
  }

  const banMutation = useMutation({
    mutationFn: (vars: { playerId: string; reason: string; type: string; expiresAt: string | null }) =>
      apiFetch(`/webadmin/players/${vars.playerId}/bans`, {
        method: 'POST',
        body: JSON.stringify({ reason: vars.reason, type: vars.type, expiresAt: vars.expiresAt }),
      }),
    onSuccess: () => {
      refresh()
      setBanReason('')
      setBanExpiry('')
    },
  })

  const liftBanMutation = useMutation({
    mutationFn: (vars: { playerId: string; banId: number }) =>
      apiFetch(`/webadmin/players/${vars.playerId}/bans/${vars.banId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })

  const privMutation = useMutation({
    mutationFn: (vars: { playerId: string; privileges: string[] }) =>
      apiFetch(`/webadmin/players/${vars.playerId}/privileges`, {
        method: 'PATCH',
        body: JSON.stringify({ privileges: vars.privileges }),
      }),
    onSuccess: refresh,
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  const players = data?.players ?? []

  return (
    <div className='container py-8 space-y-6'>
      <div>
        <h1 className='text-2xl font-bold tracking-tight'>Users &amp; Bans</h1>
        <p className='text-sm text-muted-foreground'>
          Search players, manage bans, and grant privileges.
        </p>
      </div>

      <div className='grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]'>
        {/* Player list */}
        <div className='space-y-3'>
          <Input
            placeholder='Search players…'
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
          <div className='max-h-[60vh] space-y-1 overflow-y-auto rounded-lg border border-border p-1'>
            {players.length === 0 ? (
              <p className='p-4 text-sm text-muted-foreground'>No players found.</p>
            ) : (
              players.map((p) => (
                <button
                  key={p.id}
                  type='button'
                  onClick={() => setSelectedId(p.id)}
                  className={`flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors ${
                    selectedId === p.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  <span className='font-semibold text-sm'>{p.steamName}</span>
                  <div className='flex flex-wrap gap-1'>
                    {p.activeBans > 0 && (
                      <Badge variant='destructive' className='text-[10px]'>
                        {p.activeBans} ban{p.activeBans === 1 ? '' : 's'}
                      </Badge>
                    )}
                    {p.privileges.map((pr) => (
                      <Badge key={pr} variant='outline' className='text-[10px] text-bal-gold'>
                        {pr}
                      </Badge>
                    ))}
                  </div>
                </button>
              ))
            )}
          </div>
          <div className='flex items-center justify-between'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <span className='text-xs text-muted-foreground'>Page {page}</span>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPage((p) => p + 1)}
              disabled={players.length < 50}
            >
              Next
            </Button>
          </div>
        </div>

        {/* Detail panel */}
        <div>
          {!detail ? (
            <div className='flex h-full min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground'>
              Select a player to manage.
            </div>
          ) : (
            <div className='space-y-4'>
              <div>
                <h2 className='text-lg font-bold tracking-tight'>{detail.steamName}</h2>
                <p className='font-mono text-xs text-muted-foreground'>{detail.id}</p>
              </div>

              {/* Bans */}
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Bans</CardTitle>
                </CardHeader>
                <CardContent className='space-y-4'>
                  {detail.bans.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>No bans on record.</p>
                  ) : (
                    <div className='space-y-2'>
                      {detail.bans.map((ban) => {
                        const active =
                          !ban.liftedAt &&
                          (!ban.expiresAt || new Date(ban.expiresAt) > new Date())
                        return (
                          <div
                            key={ban.id}
                            className='flex items-start justify-between gap-3 rounded-md border border-border p-2 text-sm'
                          >
                            <div className='space-y-0.5'>
                              <div className='flex items-center gap-2'>
                                <Badge variant={active ? 'destructive' : 'outline'}>
                                  {ban.banType}
                                </Badge>
                                {!active && (
                                  <span className='text-xs text-muted-foreground'>
                                    {ban.liftedAt ? 'lifted' : 'expired'}
                                  </span>
                                )}
                              </div>
                              <p className='text-muted-foreground'>{ban.reason || '—'}</p>
                              {ban.expiresAt && (
                                <p className='text-xs text-muted-foreground'>
                                  until {new Date(ban.expiresAt).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                            {active && (
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() =>
                                  liftBanMutation.mutate({ playerId: detail.id, banId: ban.id })
                                }
                              >
                                Lift
                              </Button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className='space-y-2 border-t border-border pt-4'>
                    <Label className='text-xs text-muted-foreground'>Issue a ban</Label>
                    <Input
                      placeholder='Reason'
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                    />
                    <div className='flex gap-2'>
                      <Select value={banType} onValueChange={setBanType}>
                        <SelectTrigger className='w-32'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BAN_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type='date'
                        value={banExpiry}
                        onChange={(e) => setBanExpiry(e.target.value)}
                        className='flex-1'
                      />
                      <Button
                        onClick={() =>
                          banMutation.mutate({
                            playerId: detail.id,
                            reason: banReason,
                            type: banType,
                            expiresAt: banExpiry ? new Date(banExpiry).toISOString() : null,
                          })
                        }
                        disabled={!banReason.trim() || banMutation.isPending}
                      >
                        Add Ban
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Privileges */}
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Privileges</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <div className='flex flex-wrap gap-2'>
                    {detail.privileges.length === 0 ? (
                      <p className='text-sm text-muted-foreground'>None.</p>
                    ) : (
                      detail.privileges.map((pr) => (
                        <Button
                          key={pr}
                          variant='outline'
                          size='sm'
                          className='text-bal-gold'
                          onClick={() =>
                            privMutation.mutate({
                              playerId: detail.id,
                              privileges: detail.privileges.filter((x) => x !== pr),
                            })
                          }
                        >
                          {pr} ✕
                        </Button>
                      ))
                    )}
                  </div>
                  <div className='flex gap-2'>
                    <Select value={privInput} onValueChange={setPrivInput}>
                      <SelectTrigger className='w-44'>
                        <SelectValue placeholder='Select privilege' />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIVILEGES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant='outline'
                      onClick={() => {
                        if (privInput && !detail.privileges.includes(privInput)) {
                          privMutation.mutate({
                            playerId: detail.id,
                            privileges: [...detail.privileges, privInput],
                          })
                          setPrivInput('')
                        }
                      }}
                      disabled={!privInput || detail.privileges.includes(privInput)}
                    >
                      Grant
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
