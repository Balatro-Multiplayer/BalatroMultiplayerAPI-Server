import type { PlayerLogRow, RunReplayResponse } from './types'

// Pure rules for the match page: which sides the server reduced, and what
// the Share control shows for the viewer.

export function hiddenPlayerIds(
  logs: readonly PlayerLogRow[]
): ReadonlySet<string> {
  return new Set(logs.filter((l) => l.hidden).map((l) => l.playerId))
}

export interface ShareControl {
  /** The viewer's own side is shared: show Unshare and Copy link. */
  shared: boolean
}

// Null when the viewer has no side of their own in this match (a public
// viewer, or a moderator who did not play), so no Share button shows.
export function shareControl(data: RunReplayResponse): ShareControl | null {
  const viewerId = data.viewer.playerId
  if (!viewerId) return null
  const own = data.logs.find((l) => l.playerId === viewerId)
  return own ? { shared: own.shared } : null
}

export function withOwnSideShared(
  data: RunReplayResponse,
  shared: boolean
): RunReplayResponse {
  const viewerId = data.viewer.playerId
  return {
    ...data,
    logs: data.logs.map((l) =>
      l.playerId === viewerId ? { ...l, shared } : l
    ),
  }
}

export function matchLink(origin: string, runId: string): string {
  return `${origin}/matches/${runId}`
}
