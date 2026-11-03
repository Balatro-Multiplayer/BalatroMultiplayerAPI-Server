import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { buildGameLog } from './build-game-log'
import {
  isCurrentLovelyLog,
  parseCurrentLovelyLog,
  parseRefToken,
} from './parse-lovely-current'

// A real excerpt of a Lovely log written by API/PvP 1.0.3 (one ranked PvP
// game start through its first shops, then the closing END line).
const text = readFileSync(
  new URL('./__fixtures__/lovely-pvp-excerpt.log', import.meta.url),
  'utf8'
)

describe('parseRefToken', () => {
  test('reads first-seen and seen-before refs, rejects lost ones', () => {
    expect(parseRefToken('-16.Booster.p_buffoon_normal_2')).toEqual([
      -16,
      'Booster',
      'p_buffoon_normal_2',
    ])
    expect(parseRefToken('24')).toEqual([24])
    expect(parseRefToken('table: 0x2a0ea208.table: 0x1')).toBe(null)
    expect(parseRefToken('')).toBe(null)
  })
})

describe('parseCurrentLovelyLog', () => {
  const parsed = parseCurrentLovelyLog(text)

  test('detects the format and finds the game', () => {
    expect(isCurrentLovelyLog(text)).toBe(true)
    expect(parsed.games).toHaveLength(1)
    expect(parsed.games[0]?.gamemode).toBe('ranked:pvp_ranked_expanded')
  })

  test('keeps blind keys from the human line', () => {
    const log = buildGameLog([
      { playerId: 'me', events: parsed.games[0]?.events ?? [] },
    ])
    const labels = log.players[0]?.rounds.map((r) => r.label)
    expect(labels).toContain('Ante 1 · Small Blind')
    expect(labels).toContain('Ante 1 · Big Blind (skipped)')
    expect(labels).toContain('Ante 1 · The Manacle')
  })

  test('reads shops, costs, scores, idol rolls and the result', () => {
    const log = buildGameLog([
      { playerId: 'me', events: parsed.games[0]?.events ?? [] },
    ])
    const player = log.players[0]
    const events = player?.rounds.flatMap((r) => r.events) ?? []
    expect(player?.result).toBe('loss')
    expect(events.some((e) => e.type === 'idol')).toBe(true)
    const bought = events.find((e) => e.type === 'shop' && e.action === 'buy')
    expect(bought?.type === 'shop' && bought.cost).toBe(0)
    const pack = events.find(
      (e) => e.type === 'shop' && e.action === 'open_pack'
    )
    expect(pack?.type === 'shop' && pack.cost).toBe(4)
    const hand = events.find((e) => e.type === 'hand' && e.kind === 'play')
    expect(hand?.type === 'hand' && hand.positions.length).toBe(5)
    expect(events.some((e) => e.type === 'leave_shop')).toBe(true)
  })

  test('puts idol rolls outside any game aside', () => {
    const payload = btoa(
      JSON.stringify({ roll: 0.5, winner: 'AS', cards: ['AS1'] })
    )
    const out = parseCurrentLovelyLog(`INFO - [G] IDOL_ROLL::${payload}`)
    expect(out.games).toHaveLength(0)
    expect(out.orphanIdolRolls).toHaveLength(1)
  })
})

describe('newer carbon text', () => {
  const lines = [
    'INFO - [G] 2026-11-01 10:00:00 :: DEBUG :: MULTIPLAYER :: Game starting — 2026-11-01T10:00:00-0400',
    'INFO - [G] :: TRACE :: MULTIPLAYER :: MP_RLOG: 100 select_blind 0 bl_small',
    'INFO - [G] :: TRACE :: MULTIPLAYER :: MP_RLOG: 200 play 1.2 -1.pc.Hearts.King,-2.pc.Spades.10.e:m_glass j_blueprint|foil.j_joker',
    'INFO - [G] :: TRACE :: MULTIPLAYER :: MP_RLOG: 300 idol_roll 0.5 QH KS4.QH3',
    'INFO - [G] :: DEBUG :: IdolAlgo :: IDOL_ROLL::' +
      btoa(JSON.stringify({ roll: 0.5, winner: 'QH', cards: ['KS4', 'QH3'] })),
    'INFO - [G] :: TRACE :: MULTIPLAYER :: MP_RLOG: 400 deck_snapshot HK.SA|e:m_glass',
  ].join(String.fromCharCode(10))

  test('reads card lists, joker snapshots and new opcodes, deduping the idol line', () => {
    const game = parseCurrentLovelyLog(lines).games[0]
    const log = buildGameLog([{ playerId: 'me', events: game?.events ?? [] }])
    const p = log.players[0]
    const hand = p?.rounds[0]?.events.find((e) => e.type === 'hand')
    expect(hand?.type === 'hand' && hand.cards.length).toBe(2)
    expect(hand?.type === 'hand' && hand.jokers.length).toBe(2)
    expect(p?.rounds[0]?.events.filter((e) => e.type === 'idol')).toHaveLength(
      1
    )
    expect(p?.finalDeck).toHaveLength(2)
    expect(p?.rounds[0]?.label).toBe('Ante 1 · Small Blind')
  })
})

describe('older carbon text', () => {
  test('ignores table: noise instead of reading it as jokers or refs', () => {
    const line = [
      'INFO - [G] 2026-10-30 00:18:30 :: DEBUG :: MULTIPLAYER :: Game starting — 2026-10-30T00:18:30-0400',
      'INFO - [G] :: TRACE :: MULTIPLAYER :: MP_RLOG: 25139 play 1.2.3.5.6 table: 0x2a3664d8.table: 0x2ae19400.table: 0x2bccd848',
    ].join(String.fromCharCode(10))
    const events = parseCurrentLovelyLog(line).games[0]?.events ?? []
    const play = events.find((e) => e[1] === 'play')
    expect(play?.[2]).toEqual([[1, 2, 3, 5, 6], []])
    const log = buildGameLog([{ playerId: 'me', events }])
    const hand = log.players[0]?.rounds[0]?.events.find(
      (e) => e.type === 'hand'
    )
    expect(hand?.type === 'hand' && hand.jokers.length).toBe(0)
  })
})
