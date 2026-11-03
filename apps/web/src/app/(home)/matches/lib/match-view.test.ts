import { describe, expect, test } from 'bun:test'
import {
  hiddenPlayerIds,
  matchLink,
  shareControl,
  withOwnSideShared,
} from './match-view'
import type { PlayerLogRow, RunReplayResponse } from './types'

function side(
  playerId: string,
  over: Partial<PlayerLogRow> = {}
): PlayerLogRow {
  return {
    playerId,
    displayName: playerId.toUpperCase(),
    shared: false,
    hidden: false,
    compressedEvents: '',
    carbonHash: null,
    eventCount: 0,
    status: 'complete',
    flagReason: null,
    ...over,
  }
}

function response(
  logs: PlayerLogRow[],
  viewer: RunReplayResponse['viewer']
): RunReplayResponse {
  return {
    run: {
      id: 'run-1',
      lobbyCode: 'ABC',
      modId: 'MultiplayerPvP',
      lobbyType: 'private',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00Z',
      finalizedAt: null,
    },
    logs,
    viewer,
  }
}

describe('hiddenPlayerIds', () => {
  test('collects only the sides the server hid', () => {
    const ids = hiddenPlayerIds([
      side('a', { shared: true }),
      side('b', { hidden: true }),
    ])
    expect([...ids]).toEqual(['b'])
  })
})

describe('shareControl', () => {
  test('a public viewer gets no share control', () => {
    const data = response(
      [side('a', { shared: true }), side('b', { hidden: true })],
      {
        role: 'public',
      }
    )
    expect(shareControl(data)).toBeNull()
  })

  test('a logged-in viewer outside the match gets no share control', () => {
    const data = response([side('a', { shared: true })], {
      role: 'public',
      playerId: 'z',
    })
    expect(shareControl(data)).toBeNull()
  })

  test('a participant sees Share while their side is private', () => {
    const data = response([side('a'), side('b')], {
      role: 'participant',
      playerId: 'a',
    })
    expect(shareControl(data)).toEqual({ shared: false })
  })

  test('a participant sees Unshare and Copy link once shared', () => {
    const data = response([side('a', { shared: true }), side('b')], {
      role: 'participant',
      playerId: 'a',
    })
    expect(shareControl(data)).toEqual({ shared: true })
  })

  test('only the viewer own side counts, not the opponent side', () => {
    const data = response([side('a'), side('b', { shared: true })], {
      role: 'participant',
      playerId: 'a',
    })
    expect(shareControl(data)).toEqual({ shared: false })
  })

  test('a moderator who played in the match can share their side', () => {
    const data = response([side('a'), side('b')], {
      role: 'moderator',
      playerId: 'b',
    })
    expect(shareControl(data)).toEqual({ shared: false })
  })

  test('a moderator who did not play gets no share control', () => {
    const data = response([side('a')], { role: 'moderator', playerId: 'm' })
    expect(shareControl(data)).toBeNull()
  })
})

describe('withOwnSideShared', () => {
  test('flips only the viewer side', () => {
    const data = response([side('a'), side('b')], {
      role: 'participant',
      playerId: 'a',
    })
    const next = withOwnSideShared(data, true)
    expect(next.logs.map((l) => l.shared)).toEqual([true, false])
    expect(shareControl(next)).toEqual({ shared: true })
    expect(withOwnSideShared(next, false).logs.map((l) => l.shared)).toEqual([
      false,
      false,
    ])
  })
})

describe('matchLink', () => {
  test('is the full match page URL', () => {
    expect(matchLink('https://balatromp.com', 'run-1')).toBe(
      'https://balatromp.com/matches/run-1'
    )
  })
})
