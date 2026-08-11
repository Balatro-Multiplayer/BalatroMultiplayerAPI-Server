import type { DecodedPlayerLog } from './decode-player-logs'

// Framing opcodes carry match metadata/trailers rather than gameplay actions.
// match_manifest/lobby_info/run_info replace the old single 'manifest' event
// (see BalatroMultiplayerAPI/api/replay/framing_codes.lua) -- required, not
// cosmetic: without these three, the new framing events show up as rows in
// the gameplay Timeline table. 'end'/'chk' are excluded from apps/server's
// own FRAMING_OPCODES too (they still carry the anti-cheat trailer/outcome).
export const FRAMING_OPCODES = new Set([
  'match_manifest',
  'lobby_info',
  'run_info',
  'end',
  'chk',
])

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
