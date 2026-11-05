import { describe, expect, test } from 'bun:test'
import { ladderSentence, ladderTrack } from './ladder-track'
import type { LadderSummary } from './strikes'

const summary = (
  recommended: LadderSummary['recommended'],
  applied: string[]
): LadderSummary =>
  ({
    steps: ['warning', '24h', '7d', '30d', 'permanent'],
    recommended,
    counting: applied.map((appliedStep, i) => ({ id: String(i), appliedStep })),
  }) as unknown as LadderSummary

describe('ladderTrack', () => {
  test('marks the used steps and the next step', () => {
    const track = ladderTrack('chat', summary('24h', ['warning']))
    expect(track.map((s) => s.state)).toEqual([
      'hit',
      'next',
      'ahead',
      'ahead',
      'ahead',
    ])
    expect(track.map((s) => s.label)).toEqual([
      'Warn',
      'Ban 24h',
      'Ban 7d',
      'Ban 30d',
      'Perm',
    ])
  })

  test('the play ladder says Queue', () => {
    expect(ladderTrack('play', summary('warning', []))[1]?.label).toBe(
      'Queue 24h'
    )
  })

  test('a custom length hits no step', () => {
    const track = ladderTrack('chat', summary('warning', ['custom']))
    expect(track.filter((s) => s.state === 'hit')).toHaveLength(0)
  })
})

describe('ladderSentence', () => {
  test('counts strikes and names the next step', () => {
    expect(ladderSentence('chat', summary('24h', ['warning']))).toBe(
      '1 strike. Next step: Chat ban 24h.'
    )
    expect(ladderSentence('play', summary('warning', []))).toBe(
      '0 strikes. Next step: warning.'
    )
  })
})
