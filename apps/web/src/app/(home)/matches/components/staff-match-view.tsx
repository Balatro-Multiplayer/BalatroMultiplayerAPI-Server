'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { type ReactNode, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ageText } from '../../admin/service-queue/lib/format'
import { TYPE_LABELS } from '../../admin/service-queue/lib/format'
import { useClaimRenewal } from '../../admin/service-queue/lib/use-claim-renewal'
import { formatElapsedMs } from '../lib/format'
import type { GameLog } from '../lib/game-log/types'
import {
  actionText,
  backToQueueItem,
  connectionText,
  matchTitle,
  playerPageHref,
  queueItemHref,
  queueItemStatusText,
  ratingChangeText,
  STAFF_LOG_HREF,
  type StaffTabKey,
  staffTabs,
} from '../lib/staff-view'
import type {
  MatchChatResponse,
  MatchStaffResponse,
  PlayerLogRow,
  RunConnections,
  RunReplayResponse,
} from '../lib/types'
import {
  MatchEditBar,
  MatchEditButtons,
  MatchUndoStrip,
} from './match-edit-bar'
import { GameLogView } from './game-log/game-log-view'
import { MatchTimeline } from './match-timeline'
import { PlayerLabel } from './player-label'
import { RunStatusBadge } from './status-badge'

const REFRESH_MS = 30_000

// The match page as staff see it: the player names link to their pages, the
// tabs add Timeline, Chat, Rounds and Logs, and a side column holds the
// result, the queue items about the match and the staff actions taken on it.
export function StaffMatchView({
  runId,
  data,
  gameLog,
  names,
  hidden,
  failureNotes,
  fromItem,
  shareSlot,
}: {
  runId: string
  data: RunReplayResponse
  gameLog: GameLog
  names: ReadonlyMap<string, string>
  hidden: ReadonlySet<string>
  failureNotes: ReactNode
  /** The queue item staff came from (the `item` query value), if any. */
  fromItem: number | null
  shareSlot: ReactNode
}) {
  useClaimRenewal(fromItem)
  const [tab, setTab] = useState<StaffTabKey>('timeline')
  const [editing, setEditing] = useState<string | null>(null)
  const viewerId = data.viewer.playerId ?? null

  const staff = useQuery<MatchStaffResponse>({
    queryKey: ['match-staff', runId],
    queryFn: () => apiFetch(`/webadmin/matches/${runId}/staff`),
    refetchInterval: REFRESH_MS,
  })
  const chat = useQuery<MatchChatResponse>({
    queryKey: ['match-chat', runId],
    queryFn: () => apiFetch(`/webadmin/matches/${runId}/chat`),
  })

  const players = useMemo(
    () => data.logs.map((l) => ({ id: l.playerId, name: l.displayName })),
    [data.logs]
  )
  const back = backToQueueItem(fromItem, staff.data?.queueItems ?? [])
  const tabs = staffTabs({
    chat: chat.data ? chat.data.lines.length : null,
    rounds: gameLog.players[0]?.rounds.length ?? 0,
    logs: data.logs.length,
    connections: staff.data?.connections
      ? staff.data.connections.events.length
      : null,
  })
  const now = Date.now()

  return (
    <div className='container max-w-6xl space-y-6 py-8'>
      <div className='space-y-3'>
        {back ? (
          <Link
            href={back.href}
            className='text-bal-blue text-sm hover:underline'
          >
            {back.text}
          </Link>
        ) : (
          <Link
            href='/matches'
            className='text-bal-blue text-sm hover:underline'
          >
            Back to matches
          </Link>
        )}
        <div className='flex flex-wrap items-center gap-3'>
          <h1 className='font-pixel text-3xl'>
            {matchTitle(players.map((p) => p.name))}
          </h1>
          {staff.data?.match && (
            <Badge variant='outline'>{staff.data.match.gameMode}</Badge>
          )}
          {data.run.lobbyCode && (
            <Badge variant='outline' className='font-mono'>
              lobby {data.run.lobbyCode}
            </Badge>
          )}
          <RunStatusBadge status={data.run.status} />
          {shareSlot}
          {staff.data && (
            <MatchEditButtons
              role={staff.data.viewer.role}
              items={staff.data.queueItems}
              onOpen={setEditing}
            />
          )}
        </div>
        <MatchUndoStrip />
        <p className='text-muted-foreground text-sm'>
          {data.run.modId} · Started{' '}
          {new Date(data.run.startedAt).toLocaleString()}
        </p>
      </div>

      <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <Card>
          <CardHeader className='pb-0'>
            <div className='flex gap-1 border-b' role='tablist'>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type='button'
                  role='tab'
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    '-mb-px border-b-2 px-3 py-2 text-sm',
                    tab === t.key
                      ? 'border-bal-red text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                  {t.count !== null && (
                    <span className='ml-1 text-xs'>{t.count}</span>
                  )}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className='pt-4'>
            {failureNotes}
            {tab === 'timeline' && (
              <MatchTimeline logs={data.logs} viewerId={viewerId} />
            )}
            {tab === 'chat' && (
              <ChatTab
                chat={chat.data}
                loading={chat.isLoading}
                failed={chat.isError}
                startedAt={data.run.startedAt}
              />
            )}
            {tab === 'rounds' &&
              (gameLog.players.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  No player logs were recorded for this match.
                </p>
              ) : (
                <GameLogView
                  log={gameLog}
                  hiddenPlayerIds={hidden}
                  playerLabel={(id) => (
                    <PlayerLabel
                      playerId={id}
                      displayName={names.get(id)}
                      viewerId={viewerId}
                      href={playerPageHref(id)}
                    />
                  )}
                />
              ))}
            {tab === 'logs' && <LogsTab logs={data.logs} />}
            {tab === 'connections' && (
              <ConnectionsTab
                connections={staff.data?.connections}
                loading={staff.isLoading}
                failed={staff.isError}
                startedAt={data.run.startedAt}
              />
            )}
          </CardContent>
        </Card>

        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='font-pixel'>Result</CardTitle>
            </CardHeader>
            <CardContent>
              <ResultTable staff={staff.data} state={staff} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='font-pixel'>Queue items</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 text-sm'>
              {!staff.data ? (
                <Pending failed={staff.isError} />
              ) : staff.data.queueItems.length === 0 ? (
                <p className='text-muted-foreground'>None about this match.</p>
              ) : (
                staff.data.queueItems.map((item) => (
                  <div key={item.id} className='flex items-start gap-3'>
                    <span className='w-10 shrink-0 font-mono text-muted-foreground text-xs'>
                      {ageText(item.createdAt, now)}
                    </span>
                    <div className='min-w-0 flex-1'>
                      <p>{item.summary || TYPE_LABELS[item.itemType]}</p>
                      <p className='text-muted-foreground text-xs'>
                        {queueItemStatusText(item)}
                      </p>
                    </div>
                    <Link
                      href={queueItemHref(item.id)}
                      className='text-bal-blue hover:underline'
                    >
                      Open
                    </Link>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='font-pixel'>Staff actions</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 text-sm'>
              {!staff.data ? (
                <Pending failed={staff.isError} />
              ) : staff.data.staffActions.length === 0 ? (
                <p className='text-muted-foreground'>None on this match yet.</p>
              ) : (
                staff.data.staffActions.map((a) => (
                  <div key={a.id} className='space-y-0.5'>
                    <p>
                      <Link
                        href={STAFF_LOG_HREF}
                        className='text-bal-blue hover:underline'
                      >
                        {actionText(a.action)}
                      </Link>{' '}
                      <span className='text-muted-foreground'>
                        by {a.staffName ?? 'unknown'}, {ageText(a.at, now)} ago
                      </span>
                    </p>
                    <p className='text-muted-foreground text-xs'>{a.reason}</p>
                    {a.itemId !== null && (
                      <Link
                        href={queueItemHref(a.itemId)}
                        className='text-bal-blue text-xs hover:underline'
                      >
                        Queue item
                      </Link>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {staff.data && editing && (
        <MatchEditBar
          runId={runId}
          role={staff.data.viewer.role}
          items={staff.data.queueItems}
          result={staff.data.result}
          players={players}
          picked={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function Pending({ failed }: { failed: boolean }) {
  return (
    <p className='text-muted-foreground'>
      {failed ? 'Could not load this.' : 'Loading…'}
    </p>
  )
}

function ResultTable({
  staff,
  state,
}: {
  staff: MatchStaffResponse | undefined
  state: { isError: boolean }
}) {
  if (!staff) return <Pending failed={state.isError} />
  if (!staff.result || staff.result.length === 0)
    return <p className='text-muted-foreground text-sm'>No result recorded.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className='px-2'>Player</TableHead>
          <TableHead className='w-12 px-2'>Place</TableHead>
          <TableHead className='w-32 px-2'>Rating</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {staff.result.map((row) => (
          <TableRow key={row.playerId}>
            <TableCell className='max-w-0 truncate px-2'>
              <Link
                href={playerPageHref(row.playerId)}
                title={row.displayName ?? row.playerId}
                className='text-bal-blue hover:underline'
              >
                {row.displayName ?? row.playerId.slice(0, 8)}
              </Link>
              {row.place === 1 && staff.result && staff.result.length > 1 && (
                <span className='ml-1 text-muted-foreground'>won</span>
              )}
            </TableCell>
            <TableCell className='px-2'>{row.place}</TableCell>
            <TableCell
              className={cn(
                'px-2',
                row.delta !== null && row.delta > 0 && 'text-green-500',
                row.delta !== null && row.delta < 0 && 'text-red-500'
              )}
            >
              {ratingChangeText(row)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ChatTab({
  chat,
  loading,
  failed,
  startedAt,
}: {
  chat: MatchChatResponse | undefined
  loading: boolean
  failed: boolean
  startedAt: string
}) {
  if (loading) return <p className='text-muted-foreground text-sm'>Loading…</p>
  if (failed || !chat)
    return <p className='text-destructive text-sm'>Could not load the chat.</p>
  if (chat.lines.length === 0)
    return (
      <p className='text-muted-foreground text-sm'>
        No chat lines in this match.
      </p>
    )
  const start = new Date(startedAt).getTime()
  return (
    <div className='space-y-1.5 text-sm'>
      {chat.lines.map((line) => (
        <div key={line.id} className='flex items-start gap-3'>
          <span className='w-16 shrink-0 font-mono text-muted-foreground text-xs'>
            {formatElapsedMs(new Date(line.sentAt).getTime() - start)}
          </span>
          <span className='min-w-0 flex-1'>
            <Link
              href={playerPageHref(line.playerId)}
              className='font-medium text-bal-blue hover:underline'
            >
              {line.displayName ?? line.playerId.slice(0, 8)}
            </Link>
            : {line.message}
            {line.flagged && (
              <Badge variant='destructive' className='ml-2'>
                flagged
              </Badge>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function LogsTab({ logs }: { logs: readonly PlayerLogRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Player</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Events</TableHead>
          <TableHead>Check</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.playerId}>
            <TableCell>
              <Link
                href={playerPageHref(log.playerId)}
                className='text-bal-blue hover:underline'
              >
                {log.displayName}
              </Link>
            </TableCell>
            <TableCell>{log.status}</TableCell>
            <TableCell className='font-mono'>{log.eventCount}</TableCell>
            <TableCell>
              {log.flagReason ? (
                <Badge variant='destructive'>
                  {log.flagReason.replaceAll('_', ' ')}
                </Badge>
              ) : (
                'ok'
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ConnectionsTab({
  connections,
  loading,
  failed,
  startedAt,
}: {
  connections: RunConnections | null | undefined
  loading: boolean
  failed: boolean
  startedAt: string
}) {
  if (loading) return <p className='text-muted-foreground text-sm'>Loading…</p>
  if (failed)
    return (
      <p className='text-destructive text-sm'>Could not load the connections.</p>
    )
  if (!connections)
    return (
      <p className='text-muted-foreground text-sm'>
        This match was stored before joins and leaves were kept.
      </p>
    )
  const start = new Date(startedAt).getTime()
  return (
    <div className='space-y-6'>
      {connections.events.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Nobody joined, left or dropped during this match.
        </p>
      ) : (
        <div className='space-y-1.5 text-sm'>
          {connections.events.map((e) => (
            <div
              key={`${e.playerId}-${e.at}-${e.kind}`}
              className='flex items-start gap-3'
            >
              <span className='w-16 shrink-0 font-mono text-muted-foreground text-xs'>
                {formatElapsedMs(e.at - start)}
              </span>
              <span className='min-w-0 flex-1'>
                <Link
                  href={playerPageHref(e.playerId)}
                  className='font-medium text-bal-blue hover:underline'
                >
                  {e.displayName ?? e.playerId.slice(0, 8)}
                </Link>
                : {connectionText(e)}
              </span>
            </div>
          ))}
        </div>
      )}
      {connections.logHeld.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Log events held at the end</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.logHeld.map((row) => (
              <TableRow key={row.playerId}>
                <TableCell>
                  <Link
                    href={playerPageHref(row.playerId)}
                    className='text-bal-blue hover:underline'
                  >
                    {row.displayName ?? row.playerId.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell className='font-mono'>{row.held}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
