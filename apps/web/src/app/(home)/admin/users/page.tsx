'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

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

export default function AdminUsersPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [banReason, setBanReason] = useState('')
  const [banType, setBanType] = useState('chat')
  const [banExpiry, setBanExpiry] = useState('')
  const [privInput, setPrivInput] = useState('')

  useEffect(() => {
    if (!pending && !isAdmin && !isModerator) {
      router.replace('/')
    }
  }, [pending, isAdmin, isModerator, router])

  const { data } = useQuery<PlayersResponse>({
    queryKey: ['admin-players', search, page],
    queryFn: () =>
      apiFetch(`/webadmin/players?page=${page}&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    enabled: isAdmin || isModerator,
  })

  const { data: detailResp } = useQuery<PlayerDetailResponse>({
    queryKey: ['admin-player-detail', selectedId],
    queryFn: () => apiFetch(`/webadmin/players/${selectedId}`),
    enabled: !!selectedId,
  })
  const detail = detailResp ? { ...detailResp.player, bans: detailResp.bans } : null

  const banMutation = useMutation({
    mutationFn: ({ playerId, reason, type, expiresAt }: { playerId: string; reason: string; type: string; expiresAt: string | null }) =>
      apiFetch(`/webadmin/players/${playerId}/bans`, {
        method: 'POST',
        body: JSON.stringify({ reason, type, expiresAt }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-player-detail', selectedId] })
      setBanReason('')
      setBanExpiry('')
    },
  })

  const liftBanMutation = useMutation({
    mutationFn: ({ playerId, banId }: { playerId: string; banId: number }) =>
      apiFetch(`/webadmin/players/${playerId}/bans/${banId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-player-detail', selectedId] })
    },
  })

  const privMutation = useMutation({
    mutationFn: ({ playerId, privileges }: { playerId: string; privileges: string[] }) =>
      apiFetch(`/webadmin/players/${playerId}/privileges`, {
        method: 'PATCH',
        body: JSON.stringify({ privileges }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-player-detail', selectedId] })
      qc.invalidateQueries({ queryKey: ['admin-players'] })
    },
  })

  const players = data?.players ?? []

  return (
    <div style={{ display: 'flex', gap: 24, minHeight: '70vh' }}>
      {/* Player list */}
      <div style={{ flex: '0 0 340px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 style={{ color: 'var(--bal-cream)', fontSize: 20, fontWeight: 900, margin: 0 }}>Admin — Users</h1>
        <Input
          placeholder='Search players…'
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
          {players.map((p) => (
            <button
              key={p.id}
              type='button'
              onClick={() => setSelectedId(p.id)}
              style={{
                ...PLAYER_ROW_STYLE,
                ...(selectedId === p.id ? PLAYER_ROW_ACTIVE_STYLE : {}),
              }}
            >
              <span style={{ color: 'var(--bal-cream)', fontWeight: 700, fontSize: 12 }}>{p.steamName}</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                {p.activeBans > 0 && <Chip label={`${p.activeBans} ban`} color='var(--bal-coral)' />}
                {p.privileges.map((pr) => <Chip key={pr} label={pr} color='var(--bal-amber)' />)}
              </div>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type='button' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={PAGE_BTN_STYLE}>←</button>
          <span style={{ color: 'var(--bal-teal-gray)', fontSize: 11, alignSelf: 'center' }}>Page {page}</span>
          <button type='button' onClick={() => setPage((p) => p + 1)} disabled={(data?.players.length ?? 0) < 50} style={PAGE_BTN_STYLE}>→</button>
        </div>
      </div>

      {/* Detail panel */}
      {selectedId && detail && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ color: 'var(--bal-cream)', fontSize: 16, fontWeight: 900, margin: 0 }}>{detail.steamName}</h2>
          <p style={{ color: 'var(--bal-gray-mid)', fontSize: 11, margin: 0 }}>ID: {detail.id}</p>

          {/* Bans */}
          <Card>
            <CardHeader><CardTitle style={{ color: 'var(--bal-coral)', fontSize: 13 }}>Bans</CardTitle></CardHeader>
            <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {detail.bans.length === 0 && (
                <p style={{ color: 'var(--bal-teal-gray)', fontSize: 12 }}>No active bans.</p>
              )}
              {detail.bans.map((ban) => (
                <div key={ban.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 12 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: 'var(--bal-cream)', fontWeight: 700 }}>{ban.banType}</span>
                    {' — '}
                    <span style={{ color: 'var(--bal-teal-gray)' }}>{ban.reason}</span>
                    {ban.expiresAt && <span style={{ color: 'var(--bal-gray-mid)', marginLeft: 6 }}>until {new Date(ban.expiresAt).toLocaleDateString()}</span>}
                  </div>
                  {!ban.liftedAt && (
                    <button type='button' onClick={() => liftBanMutation.mutate({ playerId: detail.id, banId: ban.id })} style={SMALL_BTN_STYLE}>Lift</button>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <input
                  placeholder='Reason'
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  style={INPUT_STYLE}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={banType} onChange={(e) => setBanType(e.target.value)} style={INPUT_STYLE}>
                    <option value='chat'>Chat</option>
                    <option value='game'>Game</option>
                    <option value='all'>All</option>
                  </select>
                  <input
                    type='date'
                    placeholder='Expires (optional)'
                    value={banExpiry}
                    onChange={(e) => setBanExpiry(e.target.value)}
                    style={{ ...INPUT_STYLE, flex: 1 }}
                  />
                </div>
                <button
                  type='button'
                  onClick={() => banMutation.mutate({
                    playerId: detail.id,
                    reason: banReason,
                    type: banType,
                    expiresAt: banExpiry ? new Date(banExpiry).toISOString() : null,
                  })}
                  disabled={!banReason}
                  style={{ ...SMALL_BTN_STYLE, background: 'var(--bal-coral)', color: 'var(--bal-white)' }}
                >
                  Add Ban
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Privileges */}
          <Card>
            <CardHeader><CardTitle style={{ color: 'var(--bal-amber)', fontSize: 13 }}>Privileges</CardTitle></CardHeader>
            <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {detail.privileges.map((pr) => (
                  <button
                    key={pr}
                    type='button'
                    onClick={() => privMutation.mutate({ playerId: detail.id, privileges: detail.privileges.filter((p) => p !== pr) })}
                    style={{ ...SMALL_BTN_STYLE, background: 'rgba(0,0,0,0.2)', color: 'var(--bal-amber)' }}
                  >
                    {pr} ×
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={privInput} onChange={(e) => setPrivInput(e.target.value)} style={INPUT_STYLE}>
                  <option value=''>Select privilege</option>
                  {['admin', 'moderator', 'trusted', 'developer'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <button
                  type='button'
                  onClick={() => { if (privInput && !detail.privileges.includes(privInput)) privMutation.mutate({ playerId: detail.id, privileges: [...detail.privileges, privInput] }) }}
                  disabled={!privInput || detail.privileges.includes(privInput)}
                  style={SMALL_BTN_STYLE}
                >
                  Grant
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, color, background: 'rgba(0,0,0,0.2)', borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase' }}>
      {label}
    </span>
  )
}

const PLAYER_ROW_STYLE: React.CSSProperties = {
  background: 'var(--bal-panel)',
  border: '2px solid transparent',
  borderRadius: 6,
  padding: '8px 12px',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const PLAYER_ROW_ACTIVE_STYLE: React.CSSProperties = {
  borderColor: 'var(--bal-coral)',
  background: 'rgba(var(--bal-coral-rgb, 253,95,85), 0.08)',
}

const PAGE_BTN_STYLE: React.CSSProperties = {
  background: 'var(--bal-panel)',
  border: '2px solid var(--bal-panel-dark)',
  color: 'var(--bal-teal-gray)',
  borderRadius: 4,
  padding: '4px 10px',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
}

const SMALL_BTN_STYLE: React.CSSProperties = {
  background: 'var(--bal-panel)',
  border: '2px solid var(--bal-panel-dark)',
  color: 'var(--bal-teal-gray)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const INPUT_STYLE: React.CSSProperties = {
  padding: '8px 10px',
  background: 'var(--bal-panel-dark)',
  border: '2px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: 'var(--bal-cream)',
  fontFamily: 'inherit',
  fontSize: 12,
  outline: 'none',
  flex: 1,
}
