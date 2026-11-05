import { describe, expect, test } from 'bun:test'
import {
  hasOpenItem,
  initialPlaces,
  matchBarActions,
  placesProblem,
  resultBody,
} from './match-edit'

const open = { status: 'open' as const }
const resolved = { status: 'resolved' as const }
const keys = (a: { key: string }[]) => a.map((x) => x.key)

describe('matchBarActions', () => {
  test('always gives an admin Void match and Set result', () => {
    expect(keys(matchBarActions('admin', []))).toEqual(['void', 'result'])
    expect(keys(matchBarActions('admin', [resolved]))).toEqual([
      'void',
      'result',
    ])
  })

  test('gives a moderator both only while an item is open', () => {
    expect(keys(matchBarActions('moderator', [resolved, open]))).toEqual([
      'void',
      'result',
    ])
  })

  test('gives a moderator Report to admins when no item is open', () => {
    expect(keys(matchBarActions('moderator', []))).toEqual(['report'])
    expect(keys(matchBarActions('moderator', [resolved]))).toEqual(['report'])
    expect(hasOpenItem([resolved])).toBe(false)
  })
})

describe('result places', () => {
  test('starts from the recorded places', () => {
    expect(
      initialPlaces([
        { playerId: 'a', place: 2 },
        { playerId: 'b', place: 1 },
      ])
    ).toEqual({ a: 2, b: 1 })
    expect(initialPlaces(null)).toEqual({})
  })

  test('refuses too few players, bad places and no winner', () => {
    expect(placesProblem({ a: 1 }) === null).toBe(false)
    expect(placesProblem({ a: 1, b: 0 }) === null).toBe(false)
    expect(placesProblem({ a: 2, b: 3 }) === null).toBe(false)
    expect(placesProblem({ a: 1.5, b: 1 }) === null).toBe(false)
    expect(placesProblem({ a: 1, b: 2 })).toBeNull()
    expect(placesProblem({ a: 1, b: 1 })).toBeNull()
  })

  test('builds the request body', () => {
    expect(resultBody({ a: 2, b: 1 }, 'fix')).toEqual({
      reason: 'fix',
      placements: [
        { playerId: 'a', place: 2 },
        { playerId: 'b', place: 1 },
      ],
    })
  })
})
