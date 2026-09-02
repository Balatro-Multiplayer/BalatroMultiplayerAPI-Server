'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { AntiCheatDetail } from '../components/anti-cheat-detail'
import { FlaggedChatDetail } from '../components/flagged-chat-detail'
import { ForfeitReconciliationDetail } from '../components/forfeit-reconciliation-detail'
import { MatchConflictDetail } from '../components/match-conflict-detail'
import { ReportDetail } from '../components/report-detail'
import type { QueueItemEnvelope, ServiceQueueItemType } from '../types'

interface QueueItemDetailResponse {
  item: QueueItemEnvelope
  detail: unknown
}

const TYPE_LABELS: Record<ServiceQueueItemType, string> = {
  report: 'Report',
  flagged_chat: 'Flagged Chat',
  match_conflict: 'Match Conflict',
  forfeit_reconciliation: 'Forfeit Reconciliation',
  anti_cheat: 'Anti-Cheat',
}

export default function AdminServiceQueueItemDetailPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const canAccess = isAdmin || isModerator
  const params = useParams()
  const id = params.id as string

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data } = useQuery<QueueItemDetailResponse>({
    queryKey: ['admin-service-queue-item', id],
    queryFn: () => apiFetch(`/webadmin/service-queue/${id}`),
    enabled: canAccess,
  })

  if (pending) return <div className='container py-8'>Loading…</div>
  if (!canAccess) return null

  const item = data?.item

  return (
    <div className='container max-w-3xl py-8 space-y-6'>
      <div>
        <a href='/admin/service-queue' className='text-sm text-bal-blue hover:underline'>
          ← Back to service queue
        </a>
        <h1 className='text-2xl font-bold tracking-tight'>
          {item ? TYPE_LABELS[item.itemType] : 'Queue Item'} #{id}
        </h1>
      </div>

      {!item ? (
        <p className='text-muted-foreground'>Loading…</p>
      ) : (
        <>
          <div className='flex items-center gap-3 text-sm'>
            <Badge variant={item.status === 'open' ? 'destructive' : 'secondary'}>
              {item.status === 'open' ? 'Open' : 'Resolved'}
            </Badge>
            <span className='text-muted-foreground'>{new Date(item.createdAt).toLocaleString()}</span>
            {item.subjectPlayerId && (
              <a href={`/players/${item.subjectPlayerId}`} className='text-bal-blue hover:underline'>
                Subject: {item.subjectPlayerId.slice(0, 8)}…
              </a>
            )}
            {item.status === 'resolved' && item.resolutionAction && (
              <span className='text-muted-foreground'>
                Resolved via {item.resolutionAction} by {item.resolvedBy}
              </span>
            )}
          </div>

          {item.itemType === 'report' && <ReportDetail item={item} detail={data.detail} />}
          {item.itemType === 'flagged_chat' && <FlaggedChatDetail item={item} detail={data.detail} />}
          {item.itemType === 'match_conflict' && <MatchConflictDetail item={item} detail={data.detail} />}
          {item.itemType === 'forfeit_reconciliation' && (
            <ForfeitReconciliationDetail item={item} detail={data.detail} />
          )}
          {item.itemType === 'anti_cheat' && <AntiCheatDetail item={item} detail={data.detail} />}
        </>
      )}
    </div>
  )
}
