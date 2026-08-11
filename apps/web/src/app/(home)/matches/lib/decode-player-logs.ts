import { decodeReplayLog, type LogEventTuple } from './decode-replay-log'
import type { PlayerLogRow } from './types'

export interface DecodedPlayerLog {
  playerId: string
  events: LogEventTuple[]
}

export interface PlayerLogDecodeFailure {
  playerId: string
  error: string
}

export interface DecodedPlayerLogs {
  decoded: DecodedPlayerLog[]
  failures: PlayerLogDecodeFailure[]
}

export function decodePlayerLogs(
  logs: readonly PlayerLogRow[]
): DecodedPlayerLogs {
  const decoded: DecodedPlayerLog[] = []
  const failures: PlayerLogDecodeFailure[] = []

  for (const log of logs) {
    const result = decodeReplayLog(log.compressedEvents)
    if (result.ok)
      decoded.push({ playerId: log.playerId, events: result.events })
    else failures.push({ playerId: log.playerId, error: result.error })
  }

  return { decoded, failures }
}
