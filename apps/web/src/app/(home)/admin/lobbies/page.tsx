'use client'

import {
  DecisionBar,
  UndoStrip,
  useDecisionBar,
} from '@/components/admin/decision-bar/decision-bar'
import { staffSend } from '@/components/admin/decision-bar/delayed-send'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ApiError, apiFetch, apiFetchWithReason } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { type AdminLobby, LOBBY_PAGE_SIZE, LobbyList } from './components/lobby-list'
import {
  LOBBY_REASONS,
  type LobbyPlayer,
  isDisconnected,
  kickTargetId,
  lobbyActions,
  lobbyJobLabel,
  matchHref,
  playerHref,
  stillInLobby,
} from './lib/lobby-bar'

interface LobbiesResponse {
  lobbies: AdminLobby[]
  total: number
  page: number
  limit: number
}

interface LobbyDetail extends AdminLobby {
  hostId: string | null
  createdAt: string
  metadata: Record<string, unknown>
  runId: string | null
}

interface LobbyDetailResponse {
  lobby: LobbyDetail
  players: LobbyPlayer[]
}

function openedFor(createdAt: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`
}

export default function AdminLobbiesPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const canAccess = isAdmin || isModerator
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [kickId, setKickId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const { data } = useQuery<LobbiesResponse>({
    queryKey: ['admin-lobbies', search, page],
    queryFn: () =>
      apiFetch(
        `/webadmin/lobbies?page=${page}&limit=${LOBBY_PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
    enabled: canAccess,
    refetchInterval: 5_000,
  })

  const { data: detail, error: detailError } = useQuery<LobbyDetailResponse>({
    queryKey: ['admin-lobby-detail', selectedCode],
    queryFn: () => apiFetch(`/webadmin/lobbies/${selectedCode}`),
    enabled: !!selectedCode,
    refetchInterval: 5_000,
    retry: false,
  })

  const players = detail?.players ?? []
  const pickedId = stillInLobby(kickId, players)
  const kickPlayer = players.find((p) => p.id === pickedId) ?? null
  const actions = useMemo(
    () => lobbyActions(kickPlayer?.displayName ?? null),
    [kickPlayer?.displayName]
  )
  const bar = useDecisionBar(
    actions,
    kickPlayer ? { action: 'kick', length: null } : null,
    selectedCode ?? ''
  )

  const select = (code: string) => {
    setSelectedCode(code)
    setKickId(null)
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-lobby-detail'] })
    qc.invalidateQueries({ queryKey: ['admin-lobbies'] })
  }

  const send = (note: string) => {
    const code = detail?.lobby.code
    if (!code || !bar.pick) return
    const failed = (e: Error) =>
      toast.error(
        e instanceof ApiError && e.status === 404
          ? 'The lobby or the player is gone.'
          : e.message
      )
    if (bar.pick.action === 'kick' && kickPlayer) {
      staffSend.start({
        tag: `lobby:${code}`,
        label: lobbyJobLabel('kick', code, kickPlayer.displayName),
        run: () =>
          apiFetchWithReason(
            `/webadmin/lobbies/${code}/kick/${kickTargetId(kickPlayer)}`,
            { method: 'POST' },
            note
          ),
        onDone: () => {
          toast.success(`Kicked ${kickPlayer.displayName}.`)
          refresh()
        },
        onError: failed,
      })
      setKickId(null)
      bar.setNote('')
      return
    }
    staffSend.start({
      tag: `lobby:${code}`,
      label: lobbyJobLabel('close', code, null),
      run: () =>
        apiFetchWithReason(`/webadmin/lobbies/${code}/close`, { method: 'POST' }, note),
      onDone: () => {
        toast.success(`Closed lobby ${code}.`)
        refresh()
      },
      onError: failed,
    })
    setSelectedCode((c) => (c === code ? null : c))
    setKickId(null)
  }

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  const lobbies = data?.lobbies ?? []
  const lobby = detail?.lobby
  const run = lobby ? matchHref(lobby.runId) : null
  const gone = !!selectedCode && !!detailError
  const asked = bar.pick?.action === 'kick' && kickPlayer

  return (
    <div className='w-full space-y-4 px-4 py-6'>
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <div>
          <h1 className='font-bold text-3xl tracking-tight'>Lobbies</h1>
          <p className='text-muted-foreground text-sm'>
            Live lobbies, refreshed every 5 s. Kick a player or close a lobby.
          </p>
        </div>
        <p className='text-muted-foreground text-sm'>
          {data?.total ?? 0} lobbies
        </p>
      </div>

      <div className='grid grid-cols-1 gap-4 lg:h-[calc(100dvh-12rem)] lg:grid-cols-[minmax(300px,380px)_1fr]'>
        <LobbyList
          lobbies={lobbies}
          total={data?.total ?? 0}
          selectedCode={selectedCode}
          search={search}
          page={page}
          onSearchChange={setSearch}
          onSelect={select}
          onPageChange={setPage}
        />

        <div className='flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card/80'>
          {!lobby ? (
            <p className='p-6 text-muted-foreground text-sm'>
              {gone
                ? 'This lobby is gone. Pick another one.'
                : 'Pick a lobby from the list.'}
            </p>
          ) : (
            <>
              <UndoStrip />
              <div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-5'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <p className='text-muted-foreground text-sm'>Lobby</p>
                    <h2 className='font-bold font-mono text-3xl tracking-tight'>
                      {lobby.code}
                    </h2>
                  </div>
                  {run ? (
                    <Link
                      href={run}
                      className='text-bal-blue text-sm hover:underline'
                    >
                      Open match
                    </Link>
                  ) : (
                    <span className='text-muted-foreground text-sm'>
                      No match running
                    </span>
                  )}
                </div>
                <div className='flex flex-wrap items-center gap-2 text-sm'>
                  <Badge variant='outline'>{lobby.modId}</Badge>
                  <span className='text-muted-foreground'>
                    {lobby.playerCount}/{lobby.maxPlayers} players
                  </span>
                </div>
                <p className='text-muted-foreground text-sm'>
                  Opened{' '}
                  <span className='font-mono'>
                    {openedFor(lobby.createdAt, now)}
                  </span>{' '}
                  ago
                </p>

                <section className='rounded-lg border border-border p-4'>
                  <h3 className='mb-3 font-bold text-lg'>Players</h3>
                  {players.length === 0 ? (
                    <p className='text-muted-foreground text-sm'>
                      No players in this lobby.
                    </p>
                  ) : (
                    <div className='space-y-2'>
                      {players.map((p) => {
                        const href = playerHref(p)
                        const picked = p.id === pickedId
                        return (
                          <div
                            key={p.id}
                            className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                              picked
                                ? 'border-destructive bg-destructive/10'
                                : 'border-border'
                            }`}
                          >
                            <div className='flex flex-wrap items-center gap-2'>
                              {href ? (
                                <Link
                                  href={href}
                                  className='font-semibold text-bal-blue hover:underline'
                                >
                                  {p.displayName}
                                </Link>
                              ) : (
                                <span className='font-semibold'>
                                  {p.displayName}
                                </span>
                              )}
                              {p.id === lobby.hostId && (
                                <Badge
                                  variant='outline'
                                  className='text-bal-gold'
                                >
                                  host
                                </Badge>
                              )}
                              {isDisconnected(p) && (
                                <Badge variant='outline'>away</Badge>
                              )}
                            </div>
                            <Button
                              variant='outline'
                              size='sm'
                              onClick={() => setKickId(p.id)}
                            >
                              {picked ? 'Kicking' : 'Kick'}
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>

                <section className='rounded-lg border border-border p-4'>
                  <h3 className='mb-3 font-bold text-lg'>Settings</h3>
                  {Object.keys(lobby.metadata).length === 0 ? (
                    <p className='text-muted-foreground text-sm'>
                      This lobby has no settings.
                    </p>
                  ) : (
                    <pre className='overflow-x-auto rounded-md bg-background/60 p-3 font-mono text-muted-foreground text-xs'>
                      {JSON.stringify(lobby.metadata, null, 2)}
                    </pre>
                  )}
                </section>
              </div>

              <div className='border-border border-t px-4 pt-3 text-sm'>
                {asked ? (
                  <>
                    Kick {kickPlayer.displayName} from lobby {lobby.code}. If
                    they are in a match, it counts as a forfeit. They can join
                    another lobby right away.
                  </>
                ) : (
                  <>
                    Close lobby {lobby.code}. This removes all {lobby.playerCount}{' '}
                    players and deletes the lobby. Anyone in a match forfeits.
                  </>
                )}
              </div>
              <DecisionBar
                actions={actions}
                pick={bar.pick}
                onChoose={bar.choose}
                onChooseLength={bar.chooseLength}
                note={bar.note}
                onNoteChange={bar.setNote}
                onSend={send}
                sendHint='Undo for 5 s'
                chips={
                  <div className='flex flex-wrap gap-1.5' data-testid='preset-chips'>
                    {LOBBY_REASONS.map((text) => (
                      <button
                        key={text}
                        type='button'
                        onClick={() => bar.setNote(text)}
                        className='rounded-full border border-border border-dashed px-3 py-1 text-left text-muted-foreground text-xs hover:bg-accent hover:text-foreground'
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                }
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
