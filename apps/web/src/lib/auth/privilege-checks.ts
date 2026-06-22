import type { Privilege } from '@bmp/types'
import type { Player } from './types'

export function hasPrivilege(player: Player | null, priv: Privilege): boolean {
  return player?.privileges?.includes(priv) ?? false
}

export function isAdmin(player: Player | null): boolean {
  return hasPrivilege(player, 'admin')
}

export function isModerator(player: Player | null): boolean {
  return hasPrivilege(player, 'moderator') || hasPrivilege(player, 'admin')
}
