import { describe, expect, test } from 'bun:test'
import type { BlogPost } from '@/components/admin/blog/blog-types'
import {
  canPublish,
  filterPosts,
  foldMessage,
  linesOverFold,
  postCounts,
  sortByUpdated,
} from './posts'

const post = (id: number, status: BlogPost['status'], updatedAt: string) =>
  ({
    id,
    kind: 'news',
    title: `p${id}`,
    bodyHtml: '',
    status,
    publishedAt: null,
    authorPlayerId: 'a',
    createdAt: updatedAt,
    updatedAt,
  }) satisfies BlogPost

const posts = [
  post(1, 'draft', '2026-11-01T00:00:00Z'),
  post(2, 'published', '2026-11-03T00:00:00Z'),
  post(3, 'published', '2026-11-02T00:00:00Z'),
]

describe('blog list', () => {
  test('filters by status', () => {
    expect(filterPosts(posts, 'all')).toHaveLength(3)
    expect(filterPosts(posts, 'drafts').map((p) => p.id)).toEqual([1])
    expect(filterPosts(posts, 'published').map((p) => p.id)).toEqual([2, 3])
  })
  test('counts', () => {
    expect(postCounts(posts)).toEqual({ all: 3, drafts: 1, published: 2 })
  })
  test('sorts newest edit first without changing the input', () => {
    expect(sortByUpdated(posts).map((p) => p.id)).toEqual([2, 3, 1])
    expect(posts[0]?.id).toBe(1)
  })
})

describe('fold line', () => {
  test('no lines over when the body fits', () => {
    expect(linesOverFold(300, 398, 18)).toBe(0)
    expect(linesOverFold(398, 398, 18)).toBe(0)
  })
  test('counts partial lines as a line', () => {
    expect(linesOverFold(399, 398, 18)).toBe(1)
    expect(linesOverFold(398 + 54, 398, 18)).toBe(3)
  })
  test('message', () => {
    expect(foldMessage(0)).toContain('0 lines over')
    expect(foldMessage(1)).toContain('1 line over')
    expect(foldMessage(4)).toContain('4 lines over')
  })
})

describe('publish gate', () => {
  test('needs saved text, a note and no send in flight', () => {
    expect(canPublish(false, 'ok', false)).toBe(true)
    expect(canPublish(true, 'ok', false)).toBe(false)
    expect(canPublish(false, '  ', false)).toBe(false)
    expect(canPublish(false, 'ok', true)).toBe(false)
  })
})
