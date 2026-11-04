'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { Privilege } from '@bmp/types'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PlayerList } from './components/player-list'
import { PrivilegeManager } from './components/privilege-manager'

interface AdminPlayer {
  id: string
  steamName: string
  discordUsername: string | null
  privileges: Privilege[]
  chatEnabled: boolean
  chatBlocked: boolean
  // The Notice version the player accepted (0 = none), and when (null when
  // the acceptance predates stored times).
  tosAcceptedVersion: number
  noticeAcceptedAt: string | null
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

interface PlayerDetailResponse {
  player: AdminPlayer
}

// Every staff action needs a reason for the staff log; nothing is sent without one.
function askReason(question: string): string | null {
  const reason = window.prompt(question)?.trim()
  return reason || null
}

function noticeLine(player: Pick<AdminPlayer, 'tosAcceptedVersion' | 'noticeAcceptedAt'>): string {
  if (player.tosAcceptedVersion <= 0) return 'Notice: not accepted'
  const when = player.noticeAcceptedAt ? new Date(player.noticeAcceptedAt).toLocaleString() : 'time not recorded'
  return `Notice: version ${player.tosAcceptedVersion}, accepted ${when}`
}

export default function AdminUsersPage() {
  const { isAdmin, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const canAccess = isAdmin
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
  const detail = detailResp?.player ?? null

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-player-detail', selectedId] })
    qc.invalidateQueries({ queryKey: ['admin-players'] })
  }

  const privMutation = useMutation({
    mutationFn: (vars: { playerId: string; privileges: Privilege[]; reason: string }) =>
      apiFetch(`/webadmin/players/${vars.playerId}/privileges`, {
        method: 'PATCH',
        body: JSON.stringify({ privileges: vars.privileges, reason: vars.reason }),
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
        <h1 className='text-2xl font-bold tracking-tight'>Staff roles</h1>
        <p className='text-sm text-muted-foreground'>
          Search players and grant or remove staff roles. Bans and warnings are on the player page.
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
                <a
                  href={`/admin/players/${detail.id}`}
                  className='text-xs text-bal-blue hover:underline'
                >
                  Open player page
                </a>
                <p className='text-xs text-muted-foreground'>{noticeLine(detail)}</p>
              </div>

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
                      onRemove={(pr) => {
                        const reason = askReason(`Reason for removing ${pr}`)
                        if (reason)
                          privMutation.mutate({
                            playerId: detail.id,
                            privileges: detail.privileges.filter((x) => x !== pr),
                            reason,
                          })
                      }}
                      onInputChange={setPrivInput}
                      onGrant={() => {
                        const v = privInput.trim() as Privilege
                        if (v && !detail.privileges.includes(v)) {
                          const reason = askReason(`Reason for granting ${v}`)
                          if (!reason) return
                          privMutation.mutate({
                            playerId: detail.id,
                            privileges: [...detail.privileges, v],
                            reason,
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
