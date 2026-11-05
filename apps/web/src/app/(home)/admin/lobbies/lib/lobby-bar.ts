import type { BarAction } from '@/components/admin/decision-bar/pick'

export interface LobbyPlayer {
  id: string
  // The site player; null when the lobby user has no player row.
  playerId: string | null
  displayName: string
  connected: boolean
}

// Kick needs a player picked in the list; Close lobby does not.
export const kickAction = (name: string): BarAction => ({
  key: 'kick',
  label: 'Kick player',
  hint: name,
  destructive: true,
})

export const closeAction: BarAction = {
  key: 'close',
  label: 'Close lobby',
  destructive: true,
}

export function lobbyActions(kickName: string | null): BarAction[] {
  return kickName === null ? [closeAction] : [kickAction(kickName), closeAction]
}

// Short ready-made notes for lobby actions.
export const LOBBY_REASONS = [
  'Away and holding the lobby',
  'Abusive lobby name',
  'Harassment',
  'Suspected cheating',
  'Test lobby',
] as const

// What the Undo strip says.
export function lobbyJobLabel(
  action: 'kick' | 'close',
  code: string,
  playerName: string | null
): string {
  return action === 'kick' && playerName
    ? `Kick ${playerName} from ${code}`
    : `Close lobby ${code}`
}

// The id the kick route takes: the site player when known (so the staff log
// names the player), else the lobby user.
export const kickTargetId = (p: LobbyPlayer): string => p.playerId ?? p.id

// The lobby has no away flag; a player who is not connected counts as away.
export const isDisconnected = (p: LobbyPlayer): boolean => !p.connected

export const playerHref = (p: LobbyPlayer): string | null =>
  p.playerId ? `/admin/players/${p.playerId}` : null

export const matchHref = (runId: string | null): string | null =>
  runId ? `/matches/${runId}` : null

// The picked player stays only while that player is still in the lobby.
export function stillInLobby(
  pickedId: string | null,
  players: readonly LobbyPlayer[]
): string | null {
  return players.some((p) => p.id === pickedId) ? pickedId : null
}
