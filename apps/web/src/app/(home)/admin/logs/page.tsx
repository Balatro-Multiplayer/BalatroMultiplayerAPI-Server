'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ChatLog {
  id: number
  playerId: string
  message: string
  flagged: boolean
  sentAt: string
}

interface ChatLogsResponse {
  logs: ChatLog[]
  total: number
  page: number
}

export default function AdminLogsPage() {
  const { isAdmin, isModerator } = useAuth()
  const [page, setPage] = useState(1)
  const [flaggedOnly, setFlaggedOnly] = useState(false)

  const { data } = useQuery<ChatLogsResponse>({
    queryKey: ['admin-chat-logs', page, flaggedOnly],
    queryFn: () =>
      apiFetch(`/webadmin/chat-logs?page=${page}&limit=100${flaggedOnly ? '&flagged=true' : ''}`),
    enabled: isAdmin || isModerator,
  })

  const logs = data?.logs ?? []

  return (
    <div className='container mx-auto max-w-5xl space-y-6'>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ color: 'var(--bal-cream)', fontSize: 20, fontWeight: 900, margin: 0 }}>Admin — Chat Logs</h1>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--bal-teal-gray)', fontSize: 12, cursor: 'pointer' }}>
          <input type='checkbox' checked={flaggedOnly} onChange={(e) => { setFlaggedOnly(e.target.checked); setPage(1) }} style={{ accentColor: 'var(--bal-coral)' }} />
          Flagged only
        </label>
      </div>
      <Card>
        <CardContent style={{ padding: 0 }}>
          {logs.length === 0 ? (
            <p style={{ padding: 24, color: 'var(--bal-teal-gray)' }}>No logs found.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--bal-panel-dark)', background: 'rgba(0,0,0,0.15)' }}>
                    {['Time', 'Player', 'Message', ''].map((h) => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--bal-gray-mid)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.1)', background: log.flagged ? 'rgba(253,95,85,0.06)' : undefined }}>
                      <td style={{ padding: '8px 12px', color: 'var(--bal-gray-mid)', whiteSpace: 'nowrap' }}>{new Date(log.sentAt).toLocaleString()}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <a href={`/players/${log.playerId}`} style={{ color: 'var(--bal-blue)', fontSize: 11 }}>{log.playerId.slice(0, 8)}…</a>
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--bal-teal-gray)', maxWidth: 480, wordBreak: 'break-word' }}>{log.message}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {log.flagged && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--bal-coral)', background: 'rgba(253,95,85,0.12)', borderRadius: 4, padding: '2px 6px' }}>FLAGGED</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type='button' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={PAGE_BTN}>← Prev</button>
        <span style={{ color: 'var(--bal-teal-gray)', fontSize: 11, alignSelf: 'center' }}>Page {page}</span>
        <button type='button' onClick={() => setPage((p) => p + 1)} disabled={(data?.logs.length ?? 0) < 100} style={PAGE_BTN}>Next →</button>
      </div>
    </div>
  )
}

const PAGE_BTN: React.CSSProperties = {
  background: 'var(--bal-panel)',
  border: '2px solid var(--bal-panel-dark)',
  color: 'var(--bal-teal-gray)',
  borderRadius: 4,
  padding: '6px 14px',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
}
