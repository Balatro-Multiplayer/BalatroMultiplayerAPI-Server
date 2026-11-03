import { describe, expect, test } from 'bun:test'
import { gzipSync, strToU8 } from 'fflate'
import { parseReplayUpload } from './parse-upload'

const tuples = [
  [0, 'match_manifest', { mod_id: 'm' }],
  [5, 'select_blind', 0],
]

describe('parseReplayUpload', () => {
  test('reads a JSON array of tuples', () => {
    const out = parseReplayUpload(JSON.stringify(tuples), 'me.json')
    expect(out?.[0]?.playerId).toBe('me.json')
    expect(out?.[0]?.events).toHaveLength(2)
  })

  test('reads tuple-per-line text', () => {
    const text = tuples.map((t) => JSON.stringify(t)).join('\n')
    expect(parseReplayUpload(text, 'a')?.[0]?.events).toHaveLength(2)
  })

  test('reads base64 gzip', () => {
    const b64 = Buffer.from(gzipSync(strToU8(JSON.stringify(tuples)))).toString(
      'base64'
    )
    expect(parseReplayUpload(b64, 'a')?.[0]?.events).toHaveLength(2)
  })

  test('reads a run replay response', () => {
    const b64 = Buffer.from(gzipSync(strToU8(JSON.stringify(tuples)))).toString(
      'base64'
    )
    const out = parseReplayUpload(
      JSON.stringify({ logs: [{ playerId: 'p1', compressedEvents: b64 }] }),
      'a'
    )
    expect(out?.[0]?.playerId).toBe('p1')
  })

  test('rejects garbage', () => {
    expect(parseReplayUpload('hello world', 'a')).toBe(null)
  })
})
