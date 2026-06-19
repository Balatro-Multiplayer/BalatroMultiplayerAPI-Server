import { describe, expect, test } from 'bun:test'
import { detectCheatFlags } from '@/lib/log-cheat-flags'

describe('detectCheatFlags', () => {
  test('includes stake on first shop overspend flags', () => {
    const flags = detectCheatFlags([
      {
        deck: 'Red Deck',
        gameIndex: 0,
        logOwnerName: 'Alice',
        moneySpentPerShop: [21],
        options: { stake: 5, ruleset: 'ranked' },
      },
    ])

    expect(flags).toEqual([
      {
        type: 'first_shop_overspend',
        gameIndex: 0,
        deck: 'Red',
        stake: 'Blue Stake',
        gameMode: 'ranked',
        threshold: 20,
        offenders: [
          {
            playerName: 'Alice',
            amount: 21,
            role: 'logOwner',
          },
        ],
        startDate: null,
      },
    ])
  })

  test('flags first round over-earn by one dollar', () => {
    const flags = detectCheatFlags([
      {
        deck: 'Red Deck',
        gameIndex: 0,
        logOwnerName: 'Alice',
        options: { stake: 1, ruleset: 'ranked' },
        events: [
          { text: 'Started Small Blind (Blind #1)', type: 'event' },
          { text: 'Gained $3', type: 'event' },
          { text: 'Gained $3', type: 'event' },
          { text: 'Gained $1', type: 'event' },
          { text: 'Moved to Shop', type: 'status' },
        ],
      },
    ])

    expect(flags).toEqual([
      {
        type: 'first_round_overearn',
        gameIndex: 0,
        deck: 'Red',
        stake: 'White Stake',
        blindName: 'Small Blind',
        gameMode: 'ranked',
        expectedEarned: 6,
        actualEarned: 7,
        expectedMoney: 10,
        actualMoney: 11,
        playerName: 'Alice',
        startDate: null,
      },
    ])
  })

  test('uses green deck hand money and disables interest', () => {
    const flags = detectCheatFlags([
      {
        deck: 'Green Deck',
        gameIndex: 0,
        logOwnerName: 'Alice',
        options: { stake: 1, ruleset: 'ranked' },
        events: [
          { text: 'Started Small Blind (Blind #1)', type: 'event' },
          { text: 'Gained $3', type: 'event' },
          { text: 'Gained $10', type: 'event' },
          { text: 'Moved to Shop', type: 'status' },
        ],
      },
    ])

    expect(flags).toEqual([
      {
        type: 'first_round_overearn',
        gameIndex: 0,
        deck: 'Green',
        stake: 'White Stake',
        blindName: 'Small Blind',
        gameMode: 'ranked',
        expectedEarned: 12,
        actualEarned: 13,
        expectedMoney: 16,
        actualMoney: 17,
        playerName: 'Alice',
        startDate: null,
      },
    ])
  })

  test('uses 2 discards for green deck on blue stake and above', () => {
    const flags = detectCheatFlags([
      {
        deck: 'Green Deck',
        gameIndex: 0,
        logOwnerName: 'Alice',
        options: { stake: 5, ruleset: 'ranked' },
        events: [
          { text: 'Started Small Blind (Blind #1)', type: 'event' },
          { text: 'Gained $3', type: 'event' },
          { text: 'Gained $6', type: 'event' },
          { text: 'Moved to Shop', type: 'status' },
        ],
      },
    ])

    expect(flags).toEqual([
      {
        type: 'first_round_overearn',
        gameIndex: 0,
        deck: 'Green',
        stake: 'Blue Stake',
        blindName: 'Small Blind',
        gameMode: 'ranked',
        expectedEarned: 8,
        actualEarned: 9,
        expectedMoney: 12,
        actualMoney: 13,
        playerName: 'Alice',
        startDate: null,
      },
    ])
  })
})
