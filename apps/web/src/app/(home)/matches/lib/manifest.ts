import { isPlainRecord } from './plain-record'
import type { TimelineEntry } from './timeline'

// Merges the first match_manifest + first lobby_info event (from any
// player -- both are per-match, identical across players) into one display
// object for the Match Info card. Replaces the old single 'manifest' event
// now that match framing is split across three events fired at three
// different scopes (see BalatroMultiplayerAPI/api/replay/framing_codes.lua).
// run_info (seed/deck/stake, fired per individual Balatro run rather than
// per match) deliberately isn't merged in here -- it belongs on the
// gameplay Timeline, not the match-level summary card. Shape varies by
// which mod recorded lobby_info (its `options` field is mod-specific), so
// every field stays optional here, same as before.
export function findMatchInfo(
  timeline: readonly TimelineEntry[]
): Record<string, unknown> | null {
  const matchManifest = timeline.find(
    (e) => e.opcode === 'match_manifest' && isPlainRecord(e.args)
  )
  const lobbyInfo = timeline.find(
    (e) => e.opcode === 'lobby_info' && isPlainRecord(e.args)
  )
  if (!matchManifest && !lobbyInfo) return null
  return {
    ...(isPlainRecord(matchManifest?.args) ? matchManifest.args : {}),
    ...(isPlainRecord(lobbyInfo?.args) ? lobbyInfo.args : {}),
  }
}

const OUTCOME_OPCODES = new Set(['end', 'chk'])

// Each player emits their own `end` (result) and `chk` (checksum) trailer,
// and the two carry disjoint keys, so merging a single player's pair is
// safe -- but two different players' trailers must stay separate, since
// each reports their own individual result (e.g. one player's "loss" is the
// other's "win"), so this is scoped to one playerId rather than the whole
// timeline.
export function findPlayerOutcomeArgs(
  timeline: readonly TimelineEntry[],
  playerId: string
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {}
  let found = false
  for (const entry of timeline) {
    if (
      entry.playerId === playerId &&
      OUTCOME_OPCODES.has(entry.opcode) &&
      isPlainRecord(entry.args)
    ) {
      Object.assign(merged, entry.args)
      found = true
    }
  }
  return found ? merged : null
}
