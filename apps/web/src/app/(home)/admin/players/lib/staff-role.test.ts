import { describe, expect, test } from 'bun:test'
import {
  privilegesFor,
  roleChangeError,
  roleChoiceOf,
} from './staff-role'

describe('roleChoiceOf', () => {
  test('admin wins over moderator', () => {
    expect(roleChoiceOf(['moderator', 'admin'])).toBe('admin')
  })
  test('other privileges are a player', () => {
    expect(roleChoiceOf(['tester'])).toBe('player')
    expect(roleChoiceOf([])).toBe('player')
  })
})

describe('privilegesFor', () => {
  test('keeps other privileges and swaps the staff role', () => {
    expect(privilegesFor(['tester', 'moderator'], 'admin')).toEqual([
      'tester',
      'admin',
    ])
  })
  test('player drops every staff role', () => {
    expect(privilegesFor(['moderator', 'admin', 'tester'], 'player')).toEqual([
      'tester',
    ])
  })
})

describe('roleChangeError', () => {
  test('needs a different role', () => {
    expect(typeof roleChangeError(['moderator'], 'moderator', 'x')).toBe('string')
  })
  test('needs a note', () => {
    expect(typeof roleChangeError([], 'moderator', '  ')).toBe('string')
  })
  test('passes with a role and a note', () => {
    expect(roleChangeError([], 'moderator', 'trusted')).toBeNull()
  })
})
