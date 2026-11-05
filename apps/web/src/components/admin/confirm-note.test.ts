import { describe, expect, test } from 'bun:test'
import { canSendConfirm, cleanNote } from './confirm-note'

describe('confirm card note', () => {
  test('an empty or blank note cannot be sent', () => {
    expect(canSendConfirm('', false)).toBe(false)
    expect(canSendConfirm('   \n', false)).toBe(false)
  })
  test('a written note can be sent', () => {
    expect(canSendConfirm('Reached its end date', false)).toBe(true)
  })
  test('nothing is sent twice while a send is running', () => {
    expect(canSendConfirm('Reached its end date', true)).toBe(false)
  })
  test('the sent note has its edges trimmed', () => {
    expect(cleanNote('  Broken build \n')).toBe('Broken build')
  })
})
