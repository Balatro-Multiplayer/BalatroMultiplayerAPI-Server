import { describe, expect, test } from 'bun:test'
import { parseLogSource } from './log-source-parser'

const TIMESTAMP = '2026-01-01 00:00:00'

/** Minimal marker line the parser recognizes as the start of a multiplayer game. */
function startGameLine(ts = TIMESTAMP): string {
  return `${ts} Info: startgame message (seed: TESTSEED)`
}

/** Minimal marker line the parser recognizes as the end of a game — needed so the
 * game actually gets pushed into the returned list (an unterminated game is dropped). */
function endGameLine(ts = TIMESTAMP): string {
  return `${ts} Info: Client got receiveEndGameJokers message  (keys: )`
}

function encodedIdolRollLine(payload: unknown, ts = TIMESTAMP): string {
  const token = Buffer.from(JSON.stringify(payload)).toString('base64')
  return `${ts} Info: IDOL_ROLL::${token}`
}

function rawIdolRollLine(rawJson: string, ts = TIMESTAMP): string {
  return `${ts} Info: IDOL_ROLL::${rawJson}`
}

/** Minimal single-game log: start marker, optional body lines, end marker. */
function singleGameLog(bodyLines: string[] = []): string {
  return [startGameLine(), ...bodyLines, endGameLine()].join('\n')
}

describe('parseLogSource — IDOL_ROLL handling', () => {
  test('a valid base64 IDOL_ROLL line attaches a hit to the current game', async () => {
    const payload = {
      roll: 0.3536,
      winner: 'TC',
      cards: ['AS1', 'AH1', 'TC4', 'KS4'],
    }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games).toHaveLength(1)
    expect(games[0]?.idolHits).toHaveLength(1)
    const hit = games[0]?.idolHits[0]
    expect(hit?.roll).toBe(0.3536)
    expect(hit?.winner).toEqual({ rank: 'T', suit: 'C' })
    expect(hit?.cards).toEqual([
      { rank: 'A', suit: 'S', count: 1 },
      { rank: 'A', suit: 'H', count: 1 },
      { rank: 'T', suit: 'C', count: 4 },
      { rank: 'K', suit: 'S', count: 4 },
    ])
  })

  test('raw (un-base64d) JSON is rejected — only base64 is accepted', async () => {
    const rawJson = JSON.stringify({
      roll: 0.12,
      winner: 'AS',
      cards: ['AS1', 'KH2'],
    })
    const games = await parseLogSource(
      singleGameLog([rawIdolRollLine(rawJson)])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('negative count is rejected without throwing', async () => {
    const payload = { roll: 0.5, winner: 'QC', cards: ['QC-5', 'AS1'] }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('zero count is rejected without throwing', async () => {
    const payload = { roll: 0.5, winner: 'QC', cards: ['QC0', 'AS1'] }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('junk-suffixed count is rejected without throwing', async () => {
    const payload = { roll: 0.5, winner: 'QC', cards: ['QC5abc', 'AS1'] }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('a single unparseable token among otherwise-valid ones rejects the whole hit', async () => {
    const payload = { roll: 0.5, winner: 'AS', cards: ['AS1', 'XX0abc', 'KS4'] }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('winner not present in cards is rejected', async () => {
    const payload = { roll: 0.5, winner: 'AD', cards: ['AS1', 'KS4'] }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('empty cards array is rejected', async () => {
    const payload = { roll: 0.5, winner: 'AS', cards: [] }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('a non-string token is rejected', async () => {
    const payload = { roll: 0.5, winner: 'AS', cards: ['AS1', 123, 'KS4'] }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('invalid base64 payload is rejected without throwing', async () => {
    // Only characters outside the base64 alphabet: Node's lenient base64
    // decoder discards them all, leaving an empty buffer whose "JSON" fails
    // to parse — exercising the catch path rather than a crash.
    const games = await parseLogSource(
      singleGameLog([rawIdolRollLine('$$$***###')])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('empty payload is rejected without throwing', async () => {
    const games = await parseLogSource(
      singleGameLog([`${TIMESTAMP} Info: IDOL_ROLL::`])
    )
    expect(games[0]?.idolHits).toHaveLength(0)
  })

  test('a missing roll still yields a hit with roll === null', async () => {
    const payload = { winner: 'AS', cards: ['AS1', 'KS4'] }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games[0]?.idolHits).toHaveLength(1)
    expect(games[0]?.idolHits[0]?.roll).toBeNull()
    expect(games[0]?.idolHits[0]?.winner).toEqual({ rank: 'A', suit: 'S' })
  })

  test('a non-numeric roll still yields a hit with roll === null', async () => {
    const payload = { roll: 'oops', winner: 'AS', cards: ['AS1', 'KS4'] }
    const games = await parseLogSource(
      singleGameLog([encodedIdolRollLine(payload)])
    )
    expect(games[0]?.idolHits).toHaveLength(1)
    expect(games[0]?.idolHits[0]?.roll).toBeNull()
  })

  test('a log with no idol lines produces games whose idolHits is []', async () => {
    const games = await parseLogSource(singleGameLog())
    expect(games).toHaveLength(1)
    expect(games[0]?.idolHits).toEqual([])
  })
})
