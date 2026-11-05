'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  type ClaimOutcome,
  claimItem,
  getItem,
  queueKeys,
  releaseItem,
} from '../lib/api'
import {
  formatTime,
  LOBBY_KIND_LABELS,
  minutesLeft,
  playerNamesOf,
  TYPE_LABELS,
} from '../lib/format'
import type { ItemDetail } from '../lib/types'
import { ActionBar } from './action-bar'
import { AppealDecisionBar } from './appeal-decision-bar'
import { ItemEvidence } from './evidence/item-evidence'
import { Empty } from './evidence/shared'
import { HistoryTimeline } from './history-timeline'
import { SubjectCard } from './subject-card'

// A claim lasts 15 minutes server-side; renew well before it runs out.
const CLAIM_RENEW_MS = 10 * 60_000

// Claims an open item while it's on screen and releases it after. Returns
// who holds it, and a way for an admin to take it over.
function useClaim(itemId: number, isOpen: boolean) {
  const qc = useQueryClient()
  const [outcome, setOutcome] = useState<ClaimOutcome | null>(null)

  const claim = useCallback(async () => {
    try {
      const next = await claimItem(itemId)
      setOutcome(next)
      qc.invalidateQueries({ queryKey: ['service-queue', 'list'] })
    } catch (err) {
      toast.error(`Could not claim: ${(err as Error).message}`)
    }
  }, [itemId, qc])

  useEffect(() => {
    setOutcome(null)
    if (!isOpen) return
    void claim()
    const renew = setInterval(() => void claim(), CLAIM_RENEW_MS)
    // Only our own claim is released; someone else's is left alone.
    const release = () => void releaseItem(itemId).catch(() => {})
    // Closing the tab or navigating away skips React cleanup.
    window.addEventListener('pagehide', release)
    return () => {
      clearInterval(renew)
      window.removeEventListener('pagehide', release)
      release()
    }
  }, [itemId, isOpen, claim])

  const takeOver = useCallback(async () => {
    await releaseItem(itemId, true).catch((err: Error) =>
      toast.error(`Could not release: ${err.message}`)
    )
    await claim()
  }, [itemId, claim])

  return { outcome, takeOver }
}

function ClaimBanner({
  outcome,
  isAdmin,
  onTakeOver,
  now,
}: {
  outcome: ClaimOutcome | null
  isAdmin: boolean
  onTakeOver: () => void
  now: number
}) {
  if (!outcome) return null
  if (outcome.kind === 'claimed')
    return (
      <p className='text-muted-foreground text-xs' data-testid='claim-mine'>
        Claimed by you for {minutesLeft(outcome.claim.claimedUntil, now)} more
        minutes.
      </p>
    )
  return (
    <div
      className='flex flex-wrap items-center gap-2 rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm'
      data-testid='claim-held'
    >
      Being handled by{' '}
      <strong>{outcome.claim.claimedByName ?? outcome.claim.claimedBy}</strong>{' '}
      ({minutesLeft(outcome.claim.claimedUntil, now)} min left). You can add
      notes only.
      {isAdmin && (
        <Button size='sm' variant='outline' onClick={onTakeOver}>
          Take over
        </Button>
      )}
    </div>
  )
}

function Header({ detail }: { detail: ItemDetail }) {
  const { item } = detail
  return (
    <div className='space-y-1'>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge variant='outline'>{TYPE_LABELS[item.itemType]}</Badge>
        <Badge variant={item.status === 'open' ? 'destructive' : 'secondary'}>
          {item.status}
          {item.resolutionAction && ` · ${item.resolutionAction}`}
        </Badge>
        {item.context.lobbyKind && (
          <Badge variant='outline'>
            {LOBBY_KIND_LABELS[item.context.lobbyKind]}
          </Badge>
        )}
        <span className='text-muted-foreground text-xs'>
          #{item.id} · priority {item.priority ?? '—'} · created{' '}
          {formatTime(item.createdAt)}
        </span>
      </div>
      <h2 className='font-semibold text-lg'>{item.summary}</h2>
      {item.resolutionNotes && (
        <p className='text-muted-foreground text-sm'>
          Resolution note: {item.resolutionNotes}
        </p>
      )}
    </div>
  )
}

export function InvestigationPanel({
  itemId,
  now,
  onOpenItem,
  onShowAllItems,
  onSkip,
  onClosed,
}: {
  itemId: number
  now: number
  onOpenItem: (id: number) => void
  onShowAllItems: (playerId: string) => void
  onSkip: () => void
  onClosed: () => void
}) {
  const [showHistory, setShowHistory] = useState(false)
  const {
    data: detail,
    error,
    isLoading,
  } = useQuery({
    queryKey: queueKeys.detail(itemId),
    queryFn: () => getItem(itemId),
  })
  const { outcome, takeOver } = useClaim(itemId, detail?.item.status === 'open')
  const names = useMemo(
    () => (detail ? playerNamesOf(detail) : new Map<string, string>()),
    [detail]
  )

  if (isLoading) return <Empty>Loading item…</Empty>
  if (error || !detail)
    return (
      <Empty>
        Could not load item #{itemId}: {(error as Error | null)?.message}
      </Empty>
    )

  return (
    <div
      className='flex min-h-0 flex-1 flex-col'
      data-testid='investigation-panel'
    >
      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-4'>
        <Header detail={detail} />
        <ClaimBanner
          outcome={outcome}
          isAdmin={detail.role === 'admin'}
          onTakeOver={() => void takeOver()}
          now={now}
        />
        <div>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setShowHistory((s) => !s)}
          >
            {showHistory ? 'Hide history' : 'History'}
          </Button>
          {showHistory && <HistoryTimeline itemId={itemId} />}
        </div>
        {detail.subject && (
          <SubjectCard
            card={detail.subject}
            now={now}
            onOpenItem={onOpenItem}
            onShowAllItems={onShowAllItems}
          />
        )}
        <ItemEvidence detail={detail} names={names} />
      </div>
      <AppealDecisionBar
        detail={detail}
        heldByOther={outcome?.kind === 'held'}
        onDone={onClosed}
      />
      <ActionBar
        detail={detail}
        names={names}
        heldByOther={outcome?.kind === 'held'}
        onDone={onClosed}
        onSkip={onSkip}
      />
    </div>
  )
}
