// The service queue's routes (apps/server webadmin/service-queue.route.ts),
// and the query keys their caches live under.
import { ApiError, apiFetch } from '@/lib/api'
import type {
  ActionBody,
  ActionResult,
  AutomaticGroup,
  Claim,
  ItemDetail,
  ItemEvents,
  ItemType,
  QueueList,
  QueueSort,
  RefusalCode,
  StatusFilter,
} from './types'

const BASE = '/webadmin/service-queue'

export interface ListFilters {
  lane: 'main' | null
  itemType: ItemType | null
  status: StatusFilter
  sort: QueueSort
  subject: string
  claimedByMe: boolean
  olderThanHours: number
  page: number
}

export const queueKeys = {
  all: ['service-queue'] as const,
  list: (filters: ListFilters) => ['service-queue', 'list', filters] as const,
  automatic: ['service-queue', 'automatic'] as const,
  detail: (id: number) => ['service-queue', 'item', id] as const,
  events: (id: number) => ['service-queue', 'events', id] as const,
}

export const PAGE_SIZE = 50

export function listQueue(filters: ListFilters): Promise<QueueList> {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: String(PAGE_SIZE),
    status: filters.status,
    sort: filters.sort,
  })
  if (filters.lane) params.set('lane', filters.lane)
  if (filters.itemType) params.set('itemType', filters.itemType)
  if (filters.subject.trim()) params.set('subject', filters.subject.trim())
  if (filters.claimedByMe) params.set('claimedByMe', '1')
  if (filters.olderThanHours > 0)
    params.set('olderThanHours', String(filters.olderThanHours))
  return apiFetch(`${BASE}?${params}`)
}

export const listAutomatic = (): Promise<{ groups: AutomaticGroup[] }> =>
  apiFetch(`${BASE}/automatic`)

export interface BulkDismissResult {
  dismissed: number
  failed: { itemId: number; code: string }[]
}

export const dismissAutomatic = (
  playerId: string,
  reason: string
): Promise<BulkDismissResult> =>
  apiFetch(`${BASE}/automatic/${encodeURIComponent(playerId)}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })

export const getItem = (id: number): Promise<ItemDetail> =>
  apiFetch(`${BASE}/${id}`)

export const getEvents = (id: number): Promise<ItemEvents> =>
  apiFetch(`${BASE}/${id}/events`)

export type ClaimOutcome =
  | { kind: 'claimed'; claim: Claim }
  | { kind: 'held'; claim: Claim }

// A claim held by someone else is an answer, not an error.
export async function claimItem(id: number): Promise<ClaimOutcome> {
  try {
    const { claim } = await apiFetch<{ claim: Claim }>(`${BASE}/${id}/claim`, {
      method: 'POST',
    })
    return { kind: 'claimed', claim }
  } catch (err) {
    const held = heldClaimOf(err)
    if (held) return { kind: 'held', claim: held }
    throw err
  }
}

// keepalive: a release sent as the page closes still reaches the server.
export const releaseItem = (id: number, force = false): Promise<unknown> =>
  apiFetch(`${BASE}/${id}/claim${force ? '?force=1' : ''}`, {
    method: 'DELETE',
    keepalive: true,
  })

export function runAction(id: number, body: ActionBody): Promise<ActionResult> {
  const { action, ...rest } = body
  return apiFetch(`${BASE}/${id}/actions/${action}`, {
    method: 'POST',
    body: JSON.stringify(rest),
  })
}

export function refusalCodeOf(err: unknown): RefusalCode | null {
  if (!(err instanceof ApiError)) return null
  const code = err.body.code
  return typeof code === 'string' ? (code as RefusalCode) : null
}

// A 409 claimed refusal's holder.
export function heldClaimOf(err: unknown): Claim | null {
  if (!(err instanceof ApiError) || refusalCodeOf(err) !== 'claimed')
    return null
  const { claimedBy, claimedByName, claimedUntil } = err.body
  if (typeof claimedBy !== 'string' || typeof claimedUntil !== 'string')
    return null
  return {
    claimedBy,
    claimedByName: typeof claimedByName === 'string' ? claimedByName : null,
    claimedUntil,
  }
}

// A stored run's replay as a JSON file download (authenticated, so fetched
// rather than linked).
export async function downloadReplay(runId: string): Promise<void> {
  const data = await apiFetch(`/runs/${runId}/replay`)
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `replay-${runId}.json`
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
