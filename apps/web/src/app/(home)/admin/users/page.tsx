'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { BanType, Privilege } from '@bmp/types'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BanList } from './components/ban-list'
import { IssueBanForm } from './components/issue-ban-form'
import { PlayerList } from './components/player-list'
import { PrivilegeManager } from './components/privilege-manager'

interface AdminPlayer {
  id: string
  steamName: string
  discordUsername: string | null
  privileges: Privilege[]
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
  banType: BanType
  expiresAt: string | null
  liftedAt: string | null
  createdAt: string
}

interface PlayerDetailResponse {
  player: AdminPlayer
  bans: Ban[]
}

export default function AdminUsersPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const canAccess = isAdmin || isModerator
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [banReason, setBanReason] = useState('')
  const [banType, setBanType] = useState<BanType>('chat')
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
    mutationFn: (vars: { playerId: string; privileges: Privilege[] }) =>
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

      <div className='grid grid-cols-1 gap-6 font-readable lg:grid-cols-[340px_1fr]'>
        <PlayerList
          players={players}
          selectedId={selectedId}
          search={search}
          page={page}
          onSearchChange={setSearch}
          onSelect={setSelectedId}
          onPageChange={setPage}
        />

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

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Bans</CardTitle>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <BanList
                    bans={detail.bans}
                    liftPending={liftBanMutation.isPending}
                    onLift={(banId) => liftBanMutation.mutate({ playerId: detail.id, banId })}
                  />
                  <IssueBanForm
                    banType={banType}
                    banReason={banReason}
                    banExpiry={banExpiry}
                    isPending={banMutation.isPending}
                    onBanTypeChange={setBanType}
                    onReasonChange={setBanReason}
                    onExpiryChange={setBanExpiry}
                    onSubmit={() =>
                      banMutation.mutate({
                        playerId: detail.id,
                        reason: banReason,
                        type: banType,
                        expiresAt: banExpiry ? new Date(banExpiry).toISOString() : null,
                      })
                    }
                  />
                </CardContent>
              </Card>

              {/* Granting/revoking privileges is admin-only (matches the server-side
                  gate on PATCH .../privileges) -- moderators can do everything else
                  on this page, but this card is entirely absent for them, not just
                  disabled. */}
              {isAdmin && (
                <Card>
                  <CardHeader>
                    <CardTitle className='text-base'>Privileges</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PrivilegeManager
                      privileges={detail.privileges}
                      privInput={privInput}
                      isPending={privMutation.isPending}
                      onRemove={(pr) =>
                        privMutation.mutate({
                          playerId: detail.id,
                          privileges: detail.privileges.filter((x) => x !== pr),
                        })
                      }
                      onInputChange={setPrivInput}
                      onGrant={() => {
                        const v = privInput.trim() as Privilege
                        if (v && !detail.privileges.includes(v)) {
                          privMutation.mutate({
                            playerId: detail.id,
                            privileges: [...detail.privileges, v],
                          })
                          setPrivInput('')
                        }
                      }}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
