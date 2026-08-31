import type { CardRegistry } from './card-ref'
import { resolveCardRef } from './card-ref'
import type { DecodedPlayerLog } from './decode-player-logs'
import { extractRefs } from './opcode-refs'

// One registry per player, built by walking each player's own events in
// their original recorded order (NOT the cross-player merged/sorted
// timeline -- a first-seen ref must be resolved before any later
// already-seen ref pointing at the same id, and ids are only meaningful
// within the player that assigned them).
export function buildCardRegistries(
  playerLogs: readonly DecodedPlayerLog[]
): Map<string, CardRegistry> {
  const registries = new Map<string, CardRegistry>()

  for (const { playerId, events } of playerLogs) {
    const registry: CardRegistry = new Map()
    for (const [, opcode, args] of events) {
      for (const ref of extractRefs(opcode, args)) {
        resolveCardRef(ref, registry)
      }
    }
    registries.set(playerId, registry)
  }

  return registries
}
