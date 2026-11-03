import type { PlayerLogRow, RunReplayResponse } from './types'

// Pure rules for the match page: which sides the server reduced, and what
// the Share control shows for the viewer.

export function hiddenPlayerIds(
  logs: readonly PlayerLogRow[]
): ReadonlySet<string> {
  return new Set(logs.filter((l) => l.hidden).map((l) => l.playerId))
}

/** The viewer's own side of the match, or undefined (public, or not in it). */
export function ownSide(data: RunReplayResponse): PlayerLogRow | undefined {
  const viewerId = data.viewer.playerId
  return viewerId ? data.logs.find((l) => l.playerId === viewerId) : undefined
}

export interface ShareControl {
  /** The viewer's own side is shared: show Unshare and Copy link. */
  shared: boolean
}

// Null when the viewer has no side of their own in this match (a public
// viewer, or a moderator who did not play), so no Share button shows.
export function shareControl(data: RunReplayResponse): ShareControl | null {
  const own = ownSide(data)
  return own ? { shared: own.shared } : null
}

export function withOwnSideShared(
  data: RunReplayResponse,
  shared: boolean
): RunReplayResponse {
  const own = ownSide(data)
  return {
    ...data,
    logs: data.logs.map((l) => (l === own ? { ...l, shared } : l)),
  }
}

export function matchLink(origin: string, runId: string): string {
  return `${origin}/matches/${runId}`
}
