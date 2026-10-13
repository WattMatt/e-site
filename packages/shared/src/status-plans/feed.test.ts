import { describe, it, expect } from 'vitest'
import { FEED_MAX_HOPS, compareBoardNames, feedingMainBoard, feedsFor, type FeedBoard, type FeedEdge } from './feed'

const e = (from: string, to: string): FeedEdge => ({ from, to })
const MB = (id: string, name: string): FeedBoard => ({ id, name })

describe('feedingMainBoard', () => {
  it('walks upstream through a sub-board to the main board', () => {
    const edges = [e('mb1', 'sb1'), e('sb1', 'db1')]
    expect(feedingMainBoard(edges, [MB('mb1', 'MB 1.1')], 'db1')).toEqual({ boardId: 'mb1', also: [], hops: 2 })
  })

  it('the nearest board wins over a farther one', () => {
    const edges = [e('mb2', 'x'), e('x', 'db1'), e('mb1', 'db1')]
    expect(feedingMainBoard(edges, [MB('mb1', 'MB 9.9'), MB('mb2', 'MB 1.1')], 'db1')?.boardId).toBe('mb1')
  })

  it('a tie at the same hop goes to the first board by name (numeric-aware); the rest are "also"', () => {
    const edges = [e('m101', 'db1'), e('m21', 'db1'), e('m20', 'db1')]
    const boards = [MB('m101', 'MB 10.1'), MB('m21', 'MB 2.1'), MB('m20', 'MB 2.0')]
    expect(feedingMainBoard(edges, boards, 'db1')).toEqual({ boardId: 'm20', also: ['m21', 'm101'], hops: 1 })
  })

  it('never walks downstream', () => {
    // db1 feeds mb1 (nonsense, but possible data): walking UP from db1 finds nothing.
    expect(feedingMainBoard([e('db1', 'mb1')], [MB('mb1', 'MB 1.1')], 'db1')).toBeNull()
  })

  it('is cycle-safe and answers null when no board is reachable', () => {
    const edges = [e('a', 'b'), e('b', 'a'), e('b', 'db1'), e('db1', 'db1')]
    expect(feedingMainBoard(edges, [MB('mb1', 'MB 1.1')], 'db1')).toBeNull()
  })

  it(`stops after ${FEED_MAX_HOPS} hops`, () => {
    const chain = (n: number) => {
      const ids = ['mb', ...Array.from({ length: n - 1 }, (_, i) => `n${i}`), 'db']
      return ids.slice(1).map((to, i) => e(ids[i]!, to))
    }
    expect(FEED_MAX_HOPS).toBe(12)
    expect(feedingMainBoard(chain(12), [MB('mb', 'MB 1')], 'db')?.hops).toBe(12)
    expect(feedingMainBoard(chain(13), [MB('mb', 'MB 1')], 'db')).toBeNull()
  })

  it('ignores duplicate edges and an unknown start', () => {
    expect(feedingMainBoard([e('mb1', 'db1'), e('mb1', 'db1')], [MB('mb1', 'MB 1.1')], 'db1')).toEqual({ boardId: 'mb1', also: [], hops: 1 })
    expect(feedingMainBoard([e('mb1', 'db1')], [MB('mb1', 'MB 1.1')], 'nope')).toBeNull()
  })
})

describe('feedsFor', () => {
  it('answers every id with the same result as feedingMainBoard', () => {
    const edges = [e('mb1', 'sb'), e('sb', 'db1'), e('mb2', 'db2')]
    const boards = [MB('mb1', 'MB 1.1'), MB('mb2', 'MB 2.1')]
    const out = feedsFor(edges, boards, ['db1', 'db2', 'db3'])
    expect(out).toEqual({
      db1: feedingMainBoard(edges, boards, 'db1'),
      db2: feedingMainBoard(edges, boards, 'db2'),
      db3: null,
    })
    expect(out.db1?.boardId).toBe('mb1')
  })
})

describe('compareBoardNames', () => {
  it('sorts numerically, case-insensitively, then by id', () => {
    const sorted = [MB('c', 'MB 10.1'), MB('b', 'mb 2.1'), MB('a', 'MB 2.1')].sort(compareBoardNames)
    expect(sorted.map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })
})
