import { describe, expect, test } from 'bun:test'
import {
  type FeatureFlag,
  addAllowlistMessage,
  allowlistChanges,
  canSaveSection,
  changeLabel,
  changedFlags,
  flagsSummary,
  laddersSummary,
  modChanges,
  pickSection,
  presetsSummary,
  upsertDraftMod,
} from './drafts'

const flags = (over: Partial<Record<FeatureFlag, boolean>> = {}) => ({
  chatEnabled: true,
  rankedEnabled: true,
  casualQueueEnabled: true,
  groupQueueEnabled: true,
  lobbyCreationEnabled: true,
  achievementsEnabled: false,
  ...over,
})

const mod = (modId: string, version = '1.0') => ({
  modId,
  displayName: modId,
  version,
  downloadUrl: `https://x/${modId}`,
})

describe('flags', () => {
  test('lists only the flags that differ', () => {
    expect(changedFlags(flags(), flags({ rankedEnabled: false }))).toEqual({
      rankedEnabled: false,
    })
    expect(changedFlags(flags(), flags())).toEqual({})
  })
  test('summary counts the flags that are on', () => {
    expect(flagsSummary(flags())).toBe('5 of 6 on')
  })
})

describe('allowlist', () => {
  test('finds adds and removes', () => {
    expect(allowlistChanges(['a', 'b'], ['b', 'c'])).toEqual({
      add: ['c'],
      remove: ['a'],
    })
  })
  test('add trims and skips empty and repeated text', () => {
    expect(addAllowlistMessage(['a'], '  b ')).toEqual(['a', 'b'])
    expect(addAllowlistMessage(['a'], 'a')).toEqual(['a'])
    expect(addAllowlistMessage(['a'], '  ')).toEqual(['a'])
  })
})

describe('mods', () => {
  test('finds upserts and removes', () => {
    const saved = [mod('a'), mod('b')]
    const draft = [mod('a', '2.0'), mod('c')]
    const out = modChanges(saved, draft)
    expect(out.upsert.map((m) => m.modId)).toEqual(['a', 'c'])
    expect(out.remove).toEqual(['b'])
  })
  test('no change gives nothing', () => {
    expect(modChanges([mod('a')], [mod('a')])).toEqual({
      upsert: [],
      remove: [],
    })
  })
  test('form entry replaces the same id', () => {
    expect(upsertDraftMod([mod('a')], mod('a', '9'))[0]?.version).toBe('9')
    expect(upsertDraftMod([mod('a')], mod('b'))).toHaveLength(2)
  })
})

describe('save rules', () => {
  test('needs a change and a note', () => {
    expect(canSaveSection(0, 'why', false)).toBe(false)
    expect(canSaveSection(2, '  ', false)).toBe(false)
    expect(canSaveSection(2, 'why', true)).toBe(false)
    expect(canSaveSection(2, 'why', false)).toBe(true)
  })
  test('labels', () => {
    expect(changeLabel(1)).toBe('1 change')
    expect(changeLabel(3)).toBe('3 changes')
    expect(laddersSummary(5, 1)).toBe('Chat 5 steps, play 1 step')
    expect(presetsSummary(8, 31)).toBe('8 queue item types, 31 notes')
  })
})

describe('leaving a section', () => {
  test('opens at once when clean', () => {
    expect(pickSection('flags', 'mods', false)).toEqual({
      open: 'mods',
      pending: null,
    })
  })
  test('warns when dirty', () => {
    expect(pickSection('flags', 'mods', true)).toEqual({
      open: 'flags',
      pending: 'mods',
    })
  })
  test('same section is a no-op', () => {
    expect(pickSection('flags', 'flags', true)).toEqual({
      open: 'flags',
      pending: null,
    })
  })
})
