import { describe, expect, test } from 'bun:test'
import {
  archiveDetailHref,
  archiveSegments,
  listedBundlePath,
} from './archive-path'

describe('listedBundlePath', () => {
  test('nothing is open on the index page', () => {
    expect(listedBundlePath([])).toBeNull()
  })

  test('a channel highlights itself', () => {
    expect(listedBundlePath(['g1', 'chan'])).toBe('g1/chan')
  })

  test('a thread highlights its parent channel', () => {
    expect(listedBundlePath(['g1', 'chan', 'threads', 't1'])).toBe('g1/chan')
  })
})

describe('archiveSegments', () => {
  test('the index path has no segments', () => {
    expect(archiveSegments('/admin/archives')).toEqual([])
    expect(archiveSegments('/admin/archives/')).toEqual([])
  })

  test('segments are decoded', () => {
    expect(archiveSegments('/admin/archives/g1/my%20chan')).toEqual([
      'g1',
      'my chan',
    ])
  })

  test('old links round trip', () => {
    const href = archiveDetailHref('g1/my chan/threads/t 1')
    expect(archiveSegments(href).join('/')).toBe('g1/my chan/threads/t 1')
  })
})
