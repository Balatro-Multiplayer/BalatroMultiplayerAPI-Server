import { describe, expect, test } from 'bun:test'
import {
  MAX_PRESET_LENGTH,
  addReason,
  canSaveList,
  editReason,
  isChanged,
  listProblem,
  moveReason,
  removeReason,
} from './lists'

describe('list edits', () => {
  test('move swaps with the neighbour and stops at the ends', () => {
    expect(moveReason(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveReason(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveReason(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveReason(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
  test('remove, edit and add leave the input alone', () => {
    const list = ['a', 'b']
    expect(removeReason(list, 0)).toEqual(['b'])
    expect(editReason(list, 1, 'z')).toEqual(['a', 'z'])
    expect(addReason(list, ' c ')).toEqual(['a', 'b', 'c'])
    expect(list).toEqual(['a', 'b'])
  })
})

describe('listProblem', () => {
  test('empty text, long text and repeats are problems', () => {
    expect(listProblem(['a', ' ']) === null).toBe(false)
    expect(listProblem(['x'.repeat(MAX_PRESET_LENGTH + 1)]) === null).toBe(
      false
    )
    expect(listProblem(['a', ' a']) === null).toBe(false)
    expect(listProblem(['a', 'b'])).toBeNull()
    expect(listProblem([])).toBeNull()
  })
})

describe('canSaveList', () => {
  test('needs a change, a note, a valid list and no save in flight', () => {
    expect(isChanged(['a'], ['a'])).toBe(false)
    expect(canSaveList(['a'], ['a'], 'why', false)).toBe(false)
    expect(canSaveList(['a'], ['a', 'b'], '  ', false)).toBe(false)
    expect(canSaveList(['a'], ['a', ' '], 'why', false)).toBe(false)
    expect(canSaveList(['a'], ['a', 'b'], 'why', true)).toBe(false)
    expect(canSaveList(['a'], ['a', 'b'], 'why', false)).toBe(true)
  })
})
