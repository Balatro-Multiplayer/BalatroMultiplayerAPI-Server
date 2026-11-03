import type { DecodedPlayerLog } from '../decode-player-logs'
import { decodeReplayLog, type LogEventTuple } from '../decode-replay-log'
import { isPlainRecord } from '../plain-record'

function isTuple(value: unknown): value is LogEventTuple {
  return (
    Array.isArray(value) &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'string'
  )
}

function tuplesFromJson(value: unknown): LogEventTuple[] | null {
  return Array.isArray(value) && value.length > 0 && value.every(isTuple)
    ? value
    : null
}

// One tuple per line, as the server stores a player's log.
function tuplesFromLines(text: string): LogEventTuple[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return null
  const out: LogEventTuple[] = []
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isTuple(parsed)) return null
      out.push(parsed)
    } catch {
      return null
    }
  }
  return out
}

function fromCompressed(text: string): LogEventTuple[] | null {
  const result = decodeReplayLog(text.trim())
  return result.ok ? result.events : null
}

/**
 * Reads one exported replay file into per-player logs. Accepts the stored
 * wire form (base64 gzip), a JSON array of [t, opcode, args] tuples,
 * tuple-per-line text, or a run replay response ({ logs: [{ playerId,
 * compressedEvents }] }). A file without a player id is named after the file.
 */
export function parseReplayUpload(
  text: string,
  fileName: string
): DecodedPlayerLog[] | null {
  const trimmed = text.trim()
  if (trimmed === '') return null

  try {
    const json: unknown = JSON.parse(trimmed)
    const direct = tuplesFromJson(json)
    if (direct) return [{ playerId: fileName, events: direct }]

    const logs =
      isPlainRecord(json) && Array.isArray(json.logs) ? json.logs : null
    if (logs) {
      const out: DecodedPlayerLog[] = []
      for (const log of logs) {
        if (
          isPlainRecord(log) &&
          typeof log.playerId === 'string' &&
          typeof log.compressedEvents === 'string'
        ) {
          const events = fromCompressed(log.compressedEvents)
          if (events) out.push({ playerId: log.playerId, events })
        }
      }
      return out.length > 0 ? out : null
    }
  } catch {
    // not a single JSON document; try the other forms
  }

  const lines = tuplesFromLines(trimmed)
  if (lines) return [{ playerId: fileName, events: lines }]

  const compressed = fromCompressed(trimmed)
  if (compressed) return [{ playerId: fileName, events: compressed }]

  return null
}
