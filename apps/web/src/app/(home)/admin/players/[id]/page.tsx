'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import { UndoStrip } from '@/components/admin/decision-bar/decision-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { itemIdOf } from '../../service-queue/lib/links'
import { useClaimRenewal } from '../../service-queue/lib/use-claim-renewal'
import { ChatTab } from '../components/chat-tab'
import { HistoryTab } from '../components/history-tab'
import {
  LinkedAccountsTab,
  useIdentity,
} from '../components/linked-accounts-tab'
import { MatchesTab, ReportsTab } from '../components/list-tabs'
import { type BarStart, PlayerActionBar } from '../components/player-action-bar'
import { SideColumn } from '../components/side-column'
import { StaffRoleCard } from '../components/staff-role-card'
import type { LiftTarget, PlayerAction } from '../lib/player-bar'
import {
  backToQueueItem,
  openingTab,
  type PlayerTab,
  sourceTypeOf,
  TAB_LABELS,
  tabsFor,
} from '../lib/player-tab'
import { historyOf } from '../lib/player-view'
import type { PlayerPage } from '../lib/types'

const HEADER_BUTTONS: { action: PlayerAction; label: string; red?: boolean }[] =
  [
    { action: 'note', label: 'Add note' },
    { action: 'warn', label: 'Warn' },
    { action: 'chat_ban', label: 'Chat ban' },
    { action: 'queue_ban', label: 'Queue ban', red: true },
  ]

export default function AdminPlayerPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense
      fallback={
        <div className='container py-8 text-muted-foreground'>Loading…</div>
      }
    >
      <PlayerPageView />
    </Suspense>
  )
}

function PlayerPageView() {
  const { id } = useParams<{ id: string }>()
  const fromItem = itemIdOf(useSearchParams().get('item'))
  const { isAdmin, isModerator } = useAuth()
  const canAccess = isAdmin || isModerator
  useClaimRenewal(canAccess ? fromItem : null)
  const [chosenTab, setChosenTab] = useState<PlayerTab | null>(null)
  const [bar, setBar] = useState<BarStart | null>(null)
  const [now] = useState(() => Date.now())

  const { data, isLoading, error } = useQuery<PlayerPage>({
    queryKey: ['admin-player-page', id],
    queryFn: () => apiFetch(`/webadmin/players/${id}/page`),
    enabled: canAccess,
    retry: false,
  })
  const identity = useIdentity(id, isAdmin && canAccess)
  const history = useMemo(() => (data ? historyOf(data) : []), [data])

  if (!canAccess) return null
  if (isLoading)
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  if (error || !data)
    return <div className='container py-8'>Player not found.</div>

  const { player } = data
  const items = data.queueItems
  const tab: PlayerTab = chosenTab ?? openingTab(sourceTypeOf(fromItem, items))
  const back = backToQueueItem(fromItem, items)
  const openBar = (action: PlayerAction, lift?: LiftTarget) =>
    setBar((b) => ({ action, lift, nonce: (b?.nonce ?? 0) + 1 }))
  const openItems = items.filter((i) => i.status === 'open').length

  const counts: Record<PlayerTab, number | null> = {
    history: history.length,
    chat: data.chat.length,
    matches: data.matchTotal,
    reports: items.length,
    linked: identity.data ? identity.data.linkedAccounts.length : null,
  }

  return (
    <div className={cn('container max-w-6xl space-y-4 py-8', bar && 'pb-80')}>
      <div className='space-y-2'>
        {back ? (
          <Link
            href={back.href}
            className='text-bal-blue text-sm hover:underline'
            data-testid='back-to-item'
          >
            {back.text}
          </Link>
        ) : (
          <Link
            href='/admin/players'
            className='text-bal-blue text-sm hover:underline'
          >
            All players
          </Link>
        )}
        <div className='flex flex-wrap items-center gap-3'>
          <h1 className='font-pixel text-4xl'>{player.steamName}</h1>
          {player.privileges.map((p) => (
            <Badge key={p} variant='secondary'>
              {p}
            </Badge>
          ))}
          {player.deletedAt && <Badge variant='destructive'>deleted</Badge>}
          {openItems > 0 && (
            <Badge variant='destructive'>
              {openItems} open {openItems === 1 ? 'item' : 'items'}
            </Badge>
          )}
          <div className='ml-auto flex flex-wrap gap-2' data-testid='player-actions'>
            {HEADER_BUTTONS.map((b) => (
              <Button
                key={b.action}
                size='sm'
                variant={b.red ? 'destructive' : 'outline'}
                data-action={b.action}
                onClick={() => openBar(b.action)}
              >
                {b.label}
              </Button>
            ))}
            {isAdmin && (
              <Button
                size='sm'
                variant='destructive'
                data-action='account_ban'
                onClick={() => openBar('account_ban')}
              >
                Account ban
              </Button>
            )}
          </div>
        </div>
        <p className='flex flex-wrap items-center gap-3 text-xs'>
          <span className='font-mono text-muted-foreground'>{player.id}</span>
          <Link
            href={`/players/${player.id}`}
            className='text-bal-blue hover:underline'
          >
            Public profile
          </Link>
        </p>
      </div>

      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <section className='min-w-0 rounded-lg border border-border bg-card/80'>
          <div
            className='flex flex-wrap gap-x-5 gap-y-1 border-border border-b px-4 pt-3'
            role='tablist'
          >
            {tabsFor(isAdmin).map((t) => (
              <button
                key={t}
                type='button'
                role='tab'
                aria-selected={t === tab}
                data-tab={t}
                onClick={() => setChosenTab(t)}
                className={cn(
                  '-mb-px border-b-2 pb-2 font-medium text-sm',
                  t === tab
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {TAB_LABELS[t]}
                {counts[t] !== null && (
                  <span className='ml-1.5 text-muted-foreground text-xs'>
                    {counts[t]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className='p-4' role='tabpanel' data-testid={`tab-${tab}`}>
            {tab === 'history' && (
              <HistoryTab
                entries={history}
                now={now}
                onLift={isAdmin ? (target) => openBar('lift', target) : null}
              />
            )}
            {tab === 'chat' && <ChatTab playerId={id} fromItem={fromItem} />}
            {tab === 'matches' && (
              <MatchesTab
                matches={data.matches}
                total={data.matchTotal}
                fromItem={fromItem}
              />
            )}
            {tab === 'reports' && <ReportsTab items={items} />}
            {tab === 'linked' && isAdmin && (
              <LinkedAccountsTab playerId={id} fromItem={fromItem} />
            )}
          </div>
        </section>
        <SideColumn playerId={id} page={data} now={now}>
          {isAdmin && (
            <StaffRoleCard
              key={player.privileges.join(',')}
              playerId={id}
              privileges={player.privileges}
            />
          )}
        </SideColumn>
      </div>

      <div className='fixed inset-x-0 bottom-0 z-40'>
        <UndoStrip className='bg-sky-950' />
        {bar && (
          <PlayerActionBar
            playerId={id}
            playerName={player.steamName}
            page={data}
            isAdmin={isAdmin}
            start={bar}
            onClose={() => setBar(null)}
          />
        )}
      </div>
    </div>
  )
}
