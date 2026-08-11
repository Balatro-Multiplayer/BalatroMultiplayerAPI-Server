import { isPlainRecord } from './plain-record'
import type { TimelineEntry } from './timeline'

// The manifest event's args come from the client's begin_run bootstrap
// payload (seed/ruleset/gamemode/deck/stake plus mod-specific extras) --
// shape varies by which mod recorded it, so every field is optional here.
export function findManifestArgs(
  timeline: readonly TimelineEntry[]
): Record<string, unknown> | null {
  const entry = timeline.find(
    (e) => e.opcode === 'manifest' && isPlainRecord(e.args)
  )
  return entry ? (entry.args as Record<string, unknown>) : null
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
