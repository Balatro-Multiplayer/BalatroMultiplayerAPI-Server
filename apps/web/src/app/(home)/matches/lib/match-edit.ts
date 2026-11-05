import type { BarAction } from '@/components/admin/decision-bar/pick'
import type { StaffQueueItem, StaffResultRow } from './types'

// Pure rules for Void match, Set result and Report to admins on the match
// page. The server enforces the same role rule; this only decides what to show.

export type StaffRole = 'moderator' | 'admin'

export const VOID_ACTION: BarAction = {
  key: 'void',
  label: 'Void match',
  destructive: true,
}
export const RESULT_ACTION: BarAction = {
  key: 'result',
  label: 'Set result',
  destructive: true,
}
export const REPORT_ACTION: BarAction = {
  key: 'report',
  label: 'Report to admins',
}

/** Whether a moderator may change the match: it has an open queue item they see. */
export const hasOpenItem = (items: readonly Pick<StaffQueueItem, 'status'>[]) =>
  items.some((i) => i.status === 'open')

/**
 * The bar's buttons. An admin always gets Void match and Set result. A
 * moderator gets them only while the match has an open queue item, and
 * "Report to admins" otherwise.
 */
export function matchBarActions(
  role: StaffRole,
  items: readonly Pick<StaffQueueItem, 'status'>[]
): BarAction[] {
  if (role === 'admin' || hasOpenItem(items))
    return [VOID_ACTION, RESULT_ACTION]
  return [REPORT_ACTION]
}

/** Place of each player id, as the form holds it. */
export type Places = Readonly<Record<string, number>>

/** The recorded places, to start the form with. */
export function initialPlaces(
  result: readonly Pick<StaffResultRow, 'playerId' | 'place'>[] | null
): Places {
  return Object.fromEntries((result ?? []).map((r) => [r.playerId, r.place]))
}

/** Why the places cannot be sent, or null when they can. */
export function placesProblem(places: Places): string | null {
  const entries = Object.values(places)
  if (entries.length < 2) return 'A result needs at least 2 players.'
  if (entries.some((p) => !Number.isInteger(p) || p < 1))
    return 'Each place must be a whole number from 1.'
  if (!entries.includes(1)) return 'Someone must be in place 1.'
  return null
}

/** The request body of Set result. */
export function resultBody(places: Places, reason: string) {
  return {
    reason,
    placements: Object.entries(places).map(([playerId, place]) => ({
      playerId,
      place,
    })),
  }
}
