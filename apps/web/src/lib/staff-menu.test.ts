import { describe, expect, test } from 'bun:test'
import { staffMenuGroups } from './staff-menu'

const labels = (role: { isAdmin: boolean; isModerator: boolean }) =>
  staffMenuGroups(role).map((g) => [g.label, g.items.map((i) => i.label)])

describe('staffMenuGroups', () => {
  test('a player sees no menu', () => {
    expect(staffMenuGroups({ isAdmin: false, isModerator: false })).toEqual([])
  })

  test('a moderator sees the moderation pages and Seasons and Blog', () => {
    expect(labels({ isAdmin: false, isModerator: true })).toEqual([
      [
        'Moderation',
        [
          'Service Queue',
          'Players',
          'Lobbies',
          'Staff Log',
          'Discord Archives',
        ],
      ],
      ['Ops', ['Seasons', 'Blog']],
    ])
  })

  test('an admin sees every page', () => {
    expect(labels({ isAdmin: true, isModerator: false })).toEqual([
      [
        'Moderation',
        [
          'Service Queue',
          'Players',
          'Lobbies',
          'Staff Log',
          'Discord Archives',
        ],
      ],
      [
        'Ops',
        ['Seasons', 'BET Releases', 'Blog', 'Configuration', 'Ranked Mods'],
      ],
    ])
  })

  test('no menu links the removed pages', () => {
    const hrefs = staffMenuGroups({ isAdmin: true, isModerator: true })
      .flatMap((g) => g.items)
      .map((i) => i.href)
    for (const gone of ['/admin/logs', '/admin/games', '/admin/users'])
      expect(hrefs.includes(gone)).toBe(false)
  })
})
