import { parseIdolTokens } from './build-game-log'
import type { IdolRoll } from './types'

const MARKER = 'IDOL_ROLL::'

function decodeBase64(payload: string): string | null {
  try {
    return atob(payload)
  } catch {
    return null
  }
}

/**
 * Reads the IDOL_ROLL:: debug lines the API writes to the Lovely log each
 * time The Idol picks its target (payload: base64 of
 * {"roll":0.62,"winner":"QH","cards":["KS4","QH3",...]}), in file order.
 * `t` is the roll's position in the log since a raw log line carries no
 * run-relative time.
 */
export function parseLovelyIdolRolls(text: string): IdolRoll[] {
  const rolls: IdolRoll[] = []
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(MARKER)
    if (at === -1) continue
    const payload = line
      .slice(at + MARKER.length)
      .trim()
      .split(/\s+/)[0]
    const json = payload ? decodeBase64(payload) : null
    if (!json) continue
    try {
      const data: unknown = JSON.parse(json)
      if (typeof data !== 'object' || data === null) continue
      const { roll, winner, cards } = data as Record<string, unknown>
      const parsed = parseIdolTokens(cards)
      if (typeof roll !== 'number' || typeof winner !== 'string') continue
      if (parsed.length === 0) continue
      rolls.push({ t: rolls.length, roll, winner, cards: parsed })
    } catch {
      // skip a malformed line
    }
  }
  return rolls
}
