import type { DecodedPlayerLog } from './decode-player-logs'

// Framing opcodes carry match metadata/trailers rather than gameplay actions
// -- mirrors FRAMING_OPCODES in apps/server's replay-log.service.ts.
export const FRAMING_OPCODES = new Set(['manifest', 'end', 'chk'])

export interface TimelineEntry {
  id: string
  t: number
  opcode: string
  args: unknown
  playerId: string
}

// Mirrors MPAPI.playback.build_timeline (BalatroMultiplayerAPI/api/playback/timeline.lua):
// concatenate every player's decoded events tagged with their player id, then
// stable-sort by elapsed time. Array.prototype.sort has been spec-guaranteed
// stable since ES2019, so ties keep their concatenation order. `id` is
// derived from each event's position within its own player's stream --
// stable across renders, unlike a post-sort array index -- so it doubles as
// a React list key.
export function buildTimeline(
  playerLogs: readonly DecodedPlayerLog[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const { playerId, events } of playerLogs) {
    events.forEach(([t, opcode, args], index) => {
      entries.push({ id: `${playerId}:${index}`, t, opcode, args, playerId })
    })
  }
  return entries.sort((a, b) => a.t - b.t)
}
