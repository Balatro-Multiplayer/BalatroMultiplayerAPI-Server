export interface Season {
  id: number
  name: string
  startedAt: string
  endsAt: string | null
  endedAt: string | null
  active: boolean
}

export function formatDay(d: string | null): string {
  return d ? new Date(d).toLocaleDateString() : '-'
}

export function daysLeft(
  endsAt: string | null,
  now = Date.now()
): number | null {
  if (!endsAt) return null
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 86_400_000))
}
