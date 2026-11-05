import { describe, expect, test } from 'bun:test'
import type { ModProfile, ModSummary } from '../components/ranked-mods-types'
import {
  filterCounts,
  filterMods,
  modDeleteImpact,
  profileDeleteImpact,
} from './mods-view'

const mod = (over: Partial<ModSummary>): ModSummary => ({
  id: 'm',
  title: 'Mod',
  author: 'Someone',
  rankedVersion: null,
  rankedVersionSha256: null,
  rankedDownloadUrl: null,
  rankedSource: null,
  rankedDownloadStatus: null,
  smodsIds: [],
  featured: false,
  hidden: false,
  thunderstoreFullName: null,
  isCustom: false,
  trackGithub: false,
  sourceType: 'release',
  ...over,
})

const pvp = mod({
  id: 'pvp',
  title: 'Multiplayer PvP',
  rankedVersion: '1.4.2',
  smodsIds: ['MultiplayerPvP'],
  isCustom: true,
  featured: true,
})
const lite = mod({
  id: 'lite',
  title: 'Cryptid Lite',
  author: 'MathIsFun',
  rankedVersion: '0.5.7',
  rankedDownloadStatus: 'unavailable',
})
const mouse = mod({ id: 'mouse', title: 'Better Mouse', hidden: true })
const mods = [mouse, lite, pvp]

describe('filterMods', () => {
  test('pinned keeps only mods with a ranked version, ordered by title', () => {
    expect(filterMods(mods, 'pinned', '').map((m) => m.id)).toEqual([
      'lite',
      'pvp',
    ])
  })

  test('all lists pinned mods first, then the rest', () => {
    expect(filterMods(mods, 'all', '').map((m) => m.id)).toEqual([
      'lite',
      'pvp',
      'mouse',
    ])
  })

  test('custom, featured, hidden and unavailable pick by their flag', () => {
    expect(filterMods(mods, 'custom', '').map((m) => m.id)).toEqual(['pvp'])
    expect(filterMods(mods, 'featured', '').map((m) => m.id)).toEqual(['pvp'])
    expect(filterMods(mods, 'hidden', '').map((m) => m.id)).toEqual(['mouse'])
    expect(filterMods(mods, 'unavailable', '').map((m) => m.id)).toEqual([
      'lite',
    ])
  })

  test('search matches title, author and id, ignoring case', () => {
    expect(filterMods(mods, 'all', 'mathis').map((m) => m.id)).toEqual(['lite'])
    expect(filterMods(mods, 'all', 'MOUSE').map((m) => m.id)).toEqual(['mouse'])
    expect(filterMods(mods, 'all', 'pvp').map((m) => m.id)).toEqual(['pvp'])
  })
})

describe('filterCounts', () => {
  test('counts each chip', () => {
    expect(filterCounts(mods)).toEqual({
      pinned: 2,
      all: 3,
      custom: 1,
      featured: 1,
      hidden: 1,
      unavailable: 1,
    })
  })
})

const profile = (
  slug: string,
  entries: { modId: string; allowed?: boolean }[]
): ModProfile => ({
  id: slug,
  name: slug.toUpperCase(),
  slug,
  description: null,
  entries: entries.map((e, i) => ({
    id: i,
    profileId: slug,
    modId: e.modId,
    versionMode: 'latest',
    pinnedVersion: null,
    allowed: e.allowed ?? true,
  })),
})

describe('modDeleteImpact', () => {
  const profiles = [
    profile('mppvp', [{ modId: 'pvp' }, { modId: 'lite' }]),
    profile('spdrn', [{ modId: 'lite' }]),
  ]

  test('a pinned mod leaves the allowed list with its SMODS ids', () => {
    const impact = modDeleteImpact(pvp, profiles)
    expect(impact.pinnedVersion).toBe('1.4.2')
    expect(impact.allowedIds).toEqual(['MultiplayerPvP'])
    expect(impact.profiles.map((p) => p.slug)).toEqual(['mppvp'])
  })

  test('an unpinned mod changes no allowed mods', () => {
    const impact = modDeleteImpact(mouse, profiles)
    expect(impact.pinnedVersion).toBeNull()
    expect(impact.allowedIds).toEqual([])
    expect(impact.profiles).toEqual([])
  })
})

describe('profileDeleteImpact', () => {
  test('lists the titles of the profile mods, falling back to the id', () => {
    const p = profile('mppvp', [{ modId: 'pvp' }, { modId: 'gone' }])
    expect(profileDeleteImpact(p, mods).modTitles).toEqual([
      'Multiplayer PvP',
      'gone',
    ])
  })
})
