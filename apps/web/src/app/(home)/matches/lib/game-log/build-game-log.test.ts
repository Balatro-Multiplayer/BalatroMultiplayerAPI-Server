import { describe, expect, test } from 'bun:test'
import { buildGameLog, parseIdolTokens } from './build-game-log'

type Ev = [number, string, unknown]

const joker = (id: number, key = 'j_joker'): unknown[] => [-id, 'Joker', key]

function player(playerId: string, events: Ev[]) {
  return { playerId, events }
}

const opening: Ev[] = [
  [0, 'match_manifest', { mod_id: 'MultiplayerPvP', lobby_code: 'ABC' }],
  [1, 'lobby_info', { ruleset: 'ruleset_mp_blitz', gamemode: 'gm' }],
  [2, 'run_info', { deck: 'Red Deck', seed: 'SEED1', stake: 1 }],
]

describe('buildGameLog', () => {
  test('splits rounds at select/skip and labels blinds', () => {
    const log = buildGameLog([
      player('a', [
        ...opening,
        [10, 'select_blind', 0],
        [20, 'skip_blind', 0],
        [30, 'select_blind', 0],
        [40, 'select_blind', 0],
      ]),
    ])
    const rounds = log.players[0]?.rounds ?? []
    expect(rounds.map((r) => r.label)).toEqual([
      'Ante 1 · Small Blind',
      'Ante 1 · Big Blind (skipped)',
      'Ante 1 · Boss / PvP Blind',
      'Ante 2 · Small Blind',
    ])
    expect(log.match?.lobby_code).toBe('ABC')
    expect(log.players[0]?.seed).toBe('SEED1')
  })

  test('attaches hand_result to the hand and derives the hand score', () => {
    const log = buildGameLog([
      player('a', [
        [10, 'select_blind', 0],
        [11, 'play', [[1], [[-1, 'pc', 'Hearts', 'King']]]],
        [12, 'hand_result', ['300', 3]],
        [13, 'play', [[1], [[-2, 'pc', 'Spades', '10', 'e:m_glass']]]],
        [14, 'hand_result', ['1000', 2]],
      ]),
    ])
    const events = log.players[0]?.rounds[0]?.events ?? []
    const hands = events.filter((e) => e.type === 'hand')
    expect(hands.map((h) => h.type === 'hand' && h.handScore)).toEqual([
      '300',
      '700',
    ])
    expect(log.players[0]?.rounds[0]?.finalScore).toBe('1000')
    expect(log.players[0]?.rounds[0]?.handsPlayed).toBe(2)
  })

  test('reconstructs jokers from buy, sell and reorder', () => {
    const log = buildGameLog([
      player('a', [
        [10, 'select_blind', 0],
        [11, 'buy', [1, 1, joker(1, 'j_a'), 4]],
        [12, 'money_delta', -4],
        [13, 'buy', [1, 1, joker(2, 'j_b'), 5]],
        [14, 'money_delta', -5],
        [
          15,
          'reorder',
          [
            4,
            [2, 1],
            [
              [[2], 2, 1],
              [[1], 1, 2],
            ],
          ],
        ],
        [16, 'play', [[1], [[-3, 'pc', 'Hearts', 'Ace']]]],
        [17, 'sell', [4, 1, [2]]],
      ]),
    ])
    const player0 = log.players[0]
    const hand = player0?.rounds[0]?.events.find((e) => e.type === 'hand')
    expect(
      hand?.type === 'hand' &&
        hand.jokers.map((j) => (j.type === 'other_card' ? j.ident : ''))
    ).toEqual(['j_b', 'j_a'])
    expect(
      player0?.finalJokers.map((j) => (j.type === 'other_card' ? j.ident : ''))
    ).toEqual(['j_a'])
    expect(player0?.itemizedPurchases).toBe(9)
    // costs consume the following money_delta, so no stray money events
    expect(player0?.rounds[0]?.events.some((e) => e.type === 'money')).toBe(
      false
    )
    expect(player0?.rounds[0]?.moneySpent).toBe(9)
  })

  test('already-seen refs take their current tags', () => {
    const log = buildGameLog([
      player('a', [
        [10, 'select_blind', 0],
        [11, 'discard', [[1], [[-1, 'pc', 'Hearts', 'King']]]],
        [12, 'play', [[1], [[1, 'ed:foil']]]],
      ]),
    ])
    const hands = (log.players[0]?.rounds[0]?.events ?? []).flatMap((e) =>
      e.type === 'hand' ? [e] : []
    )
    expect(hands[1]?.cards[0]?.tags).toEqual(['ed:foil'])
  })

  test('reads idol_roll payloads', () => {
    expect(parseIdolTokens(['KS4', 'TH1', '10D2', 'bad'])).toEqual([
      { rank: 'K', suit: 'S', count: 4 },
      { rank: '10', suit: 'H', count: 1 },
      { rank: '10', suit: 'D', count: 2 },
    ])
  })

  test('declares the PvP winner from both players boss-blind scores', () => {
    const rounds = (score: string): Ev[] => [
      [1, 'select_blind', 0],
      [2, 'select_blind', 0],
      [3, 'select_blind', 0],
      [4, 'play', [[1], [[-1, 'pc', 'Hearts', 'King']]]],
      [5, 'hand_result', [score, 3]],
    ]
    const log = buildGameLog([
      player('a', rounds('500')),
      player('b', rounds('900')),
    ])
    expect(log.pvp).toHaveLength(1)
    expect(log.pvp[0]?.winnerId).toBe('b')
  })

  test('uses the blind key, joker snapshot, idol roll and deck from newer logs', () => {
    const log = buildGameLog([
      player('a', [
        [10, 'select_blind', [0, 'bl_mp_nemesis']],
        [11, 'idol_roll', [0.5, 'QH', ['KS4', 'QH3']]],
        [
          12,
          'play',
          [
            [1],
            [[-1, 'pc', 'Hearts', 'King']],
            ['j_blueprint|foil', 'j_joker'],
          ],
        ],
        [13, 'deck_snapshot', [['HK', 'SA|e:m_glass|ed:foil']]],
      ]),
    ])
    const p = log.players[0]
    const round = p?.rounds[0]
    expect(round?.label).toBe('Ante 1 · PvP Blind')
    expect(round?.isPvp).toBe(true)
    const hand = round?.events.find((e) => e.type === 'hand')
    expect(
      hand?.type === 'hand' &&
        hand.jokers.map((j) => (j.type === 'other_card' ? j.tags.join() : ''))
    ).toEqual(['ed:foil', ''])
    const idol = round?.events.find((e) => e.type === 'idol')
    expect(idol?.type === 'idol' && idol.winner).toBe('QH')
    expect(p?.finalDeck).toHaveLength(2)
    expect(
      p?.finalDeck[1]?.type === 'playing_card' && p.finalDeck[1].value
    ).toBe('Ace')
  })

  test('puts shops in their own section with the idol roll first', () => {
    const idol = (t: number, roll: number, winner: string): Ev => [
      t,
      'idol_roll',
      { roll, winner, cards: ['KS2', 'QH1'] },
    ]
    const log = buildGameLog([
      player('a', [
        ...opening,
        idol(5, 0.1, 'KS'),
        [10, 'select_blind', [0, 'bl_small']],
        idol(20, 0.9, 'QH'),
        [21, 'cashout', null],
        [25, 'reroll', null],
        [26, 'money_delta', [-5]],
        [30, 'leave_shop', null],
        [31, 'select_blind', [0, 'bl_big']],
      ]),
    ])
    const rounds = log.players[0]?.rounds ?? []
    expect(rounds.map((r) => [r.kind, r.index])).toEqual([
      ['blind', 1],
      ['shop', 1.5],
      ['blind', 2],
    ])
    // The opening roll opens the first blind; the end-of-blind roll opens
    // the shop and is labelled with the blind it applies to.
    expect(rounds[0]?.events[0]?.type).toBe('idol')
    const shop = rounds[1]
    expect(shop?.events[0]?.type).toBe('idol')
    expect(shop?.events[0]?.type === 'idol' && shop.events[0].appliesTo).toBe(
      'Ante 1 · Big Blind'
    )
    expect(shop?.shopSpent).toBe(5)
    expect(shop?.shopRerolls).toBe(1)
    expect(rounds[0]?.events.some((e) => e.type === 'cashout')).toBe(true)
  })
})
