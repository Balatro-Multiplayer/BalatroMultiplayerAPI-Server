import { gunzipSync, strFromU8 } from 'fflate'

// Mirrors the wire format written by apps/server's replay-log.service.ts
// (finalizeRun): base64(gzip(JSON.stringify(events))), events being
// [t, opcode, args] positional tuples -- the same shape
// MPAPI.playback.build_timeline reads on the Lua client side.
export type LogEventTuple = [t: number, opcode: string, args: unknown]

export type DecodeResult =
  | { ok: true; events: LogEventTuple[] }
  | { ok: false; error: string }

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function isLogEventTuple(value: unknown): value is LogEventTuple {
  return (
    Array.isArray(value) &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'string'
  )
}

export function decodeReplayLog(compressedEvents: string): DecodeResult {
  try {
    const compressedBytes = base64ToBytes(compressedEvents)
    const json = strFromU8(gunzipSync(compressedBytes))
    const parsed: unknown = JSON.parse(json)

    if (!Array.isArray(parsed) || !parsed.every(isLogEventTuple)) {
      return { ok: false, error: 'Decoded log is not a valid event array' }
    }
    return { ok: true, events: parsed }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to decode replay log',
    }
  }
}
