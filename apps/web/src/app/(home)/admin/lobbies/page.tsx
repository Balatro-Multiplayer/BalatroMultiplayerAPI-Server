'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { CloseLobbyDialog } from './components/close-lobby-dialog'
import { KickPlayerDialog } from './components/kick-player-dialog'
import { LobbyList } from './components/lobby-list'

interface AdminLobby {
  code: string
  modId: string
  type: 'public' | 'private'
  hostId: string
  hostName: string | null
  playerCount: number
  maxPlayers: number
  createdAt: string
  isReported: boolean
}

interface LobbiesResponse {
  lobbies: AdminLobby[]
  total: number
  page: number
  limit: number
}

interface LobbyPlayer {
  id: string
  displayName: string
  preferredJoker: string
  isAway: boolean
}

interface LobbyDetailResponse {
  lobby: AdminLobby & { metadata: Record<string, unknown> }
  players: LobbyPlayer[]
}

export default function AdminLobbiesPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const canAccess = isAdmin || isModerator
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [kickTarget, setKickTarget] = useState<{
    id: string
    displayName: string
  } | null>(null)
  const [closeTarget, setCloseTarget] = useState<{
    code: string
    playerCount: number
  } | null>(null)

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data } = useQuery<LobbiesResponse>({
    queryKey: ['admin-lobbies', search, page],
    queryFn: () =>
      apiFetch(
        `/webadmin/lobbies?page=${page}&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
    enabled: canAccess,
    refetchInterval: 5_000,
  })

  const { data: detail } = useQuery<LobbyDetailResponse>({
    queryKey: ['admin-lobby-detail', selectedCode],
    queryFn: () => apiFetch(`/webadmin/lobbies/${selectedCode}`),
    enabled: !!selectedCode,
    refetchInterval: 5_000,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-lobby-detail', selectedCode] })
    qc.invalidateQueries({ queryKey: ['admin-lobbies'] })
  }

  const kickMutation = useMutation({
    mutationFn: (vars: { code: string; playerId: string }) =>
      apiFetch(`/webadmin/lobbies/${vars.code}/kick/${vars.playerId}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      refresh()
      setKickTarget(null)
    },
  })

  const closeMutation = useMutation({
    mutationFn: (code: string) =>
      apiFetch(`/webadmin/lobbies/${code}/close`, { method: 'POST' }),
    onSuccess: () => {
      refresh()
      setCloseTarget(null)
      setSelectedCode(null)
    },
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  const lobbies = data?.lobbies ?? []

  return (
    <div className='container space-y-6 py-8'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>Lobbies</h1>
        <p className='text-muted-foreground text-sm'>
          Search live lobbies by code or player name, kick players, or
          force-close a lobby.
        </p>
      </div>

      <div className='grid grid-cols-1 gap-6 font-readable lg:grid-cols-[340px_1fr]'>
        <LobbyList
          lobbies={lobbies}
          selectedCode={selectedCode}
          search={search}
          page={page}
          onSearchChange={setSearch}
          onSelect={setSelectedCode}
          onPageChange={setPage}
        />

        <div>
          {!detail ? (
            <div className='flex h-full min-h-[40vh] items-center justify-center rounded-lg border border-border border-dashed text-muted-foreground text-sm'>
              Select a lobby to manage.
            </div>
          ) : (
            <div className='space-y-4'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <h2 className='font-bold font-mono text-lg tracking-tight'>
                    {detail.lobby.code}
                  </h2>
                  <p className='text-muted-foreground text-xs'>
                    {detail.lobby.modId} · {detail.lobby.type} ·{' '}
                    {detail.lobby.playerCount}/{detail.lobby.maxPlayers} players
                  </p>
                </div>
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={() =>
                    setCloseTarget({
                      code: detail.lobby.code,
                      playerCount: detail.lobby.playerCount,
                    })
                  }
                >
                  Close Lobby
                </Button>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Players</CardTitle>
                </CardHeader>
                <CardContent className='space-y-2'>
                  {detail.players.length === 0 ? (
                    <p className='text-muted-foreground text-sm'>
                      No players in this lobby.
                    </p>
                  ) : (
                    detail.players.map((p) => (
                      <div
                        key={p.id}
                        className='flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2'
                      >
                        <div className='flex items-center gap-2'>
                          <span className='font-medium text-sm'>
                            {p.displayName}
                          </span>
                          {p.id === detail.lobby.hostId && (
                            <Badge
                              variant='outline'
                              className='text-[10px] text-bal-gold'
                            >
                              host
                            </Badge>
                          )}
                          {p.isAway && (
                            <Badge variant='outline' className='text-[10px]'>
                              away
                            </Badge>
                          )}
                        </div>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() =>
                            setKickTarget({
                              id: p.id,
                              displayName: p.displayName,
                            })
                          }
                        >
                          Kick
                        </Button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {Object.keys(detail.lobby.metadata).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className='text-base'>Metadata</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className='overflow-x-auto text-muted-foreground text-xs'>
                      {JSON.stringify(detail.lobby.metadata, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      <KickPlayerDialog
        target={kickTarget}
        isPending={kickMutation.isPending}
        onConfirm={() =>
          kickTarget &&
          selectedCode &&
          kickMutation.mutate({ code: selectedCode, playerId: kickTarget.id })
        }
        onClose={() => setKickTarget(null)}
      />
      <CloseLobbyDialog
        target={closeTarget}
        isPending={closeMutation.isPending}
        onConfirm={() => closeTarget && closeMutation.mutate(closeTarget.code)}
        onClose={() => setCloseTarget(null)}
      />
    </div>
  )
}
