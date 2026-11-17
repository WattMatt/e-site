import { describe, expect, it } from 'vitest'
import { activityRow } from '../persistence/fixtures'
import { outlineRows } from './outline'

const tree = () => [
  activityRow('B', { name: 'Beta', sort_order: 2, parent_id: 'S' }),
  activityRow('S', { name: 'Summary', type: 'summary', sort_order: 1 }),
  activityRow('A', { name: 'Alpha', sort_order: 1, parent_id: 'S' }),
  activityRow('A1', { name: 'A one', sort_order: 1, parent_id: 'A' }),
  activityRow('A2', { name: 'A two', sort_order: 2, parent_id: 'A', wbs_code: 'CUSTOM' }),
  activityRow('Z', { name: 'Zed', sort_order: 2 }),
  activityRow('X', { name: 'Dead', sort_order: 1, parent_id: 'S', is_tombstoned: true }),
]

describe('outlineRows', () => {
  it('orders depth-first by sort_order then name, with depth, wbs and hasChildren', () => {
    const rows = outlineRows(tree(), new Set())
    expect(rows.map((r) => [r.id, r.depth, r.wbs, r.hasChildren])).toEqual([
      ['S', 0, '1', true],
      ['A', 1, '1.1', true],
      ['A1', 2, '1.1.1', false],
      ['A2', 2, 'CUSTOM', false],
      ['B', 1, '1.2', false],
      ['Z', 0, '2', false],
    ])
  })
  it('excludes tombstoned rows', () => {
    expect(outlineRows(tree(), new Set()).some((r) => r.id === 'X')).toBe(false)
  })
  it('collapsed parents hide descendants and report collapsed', () => {
    const rows = outlineRows(tree(), new Set(['A']))
    expect(rows.map((r) => r.id)).toEqual(['S', 'A', 'B', 'Z'])
    expect(rows[1].collapsed).toBe(true)
    expect(rows[0].collapsed).toBe(false)
    expect(outlineRows(tree(), new Set(['S'])).map((r) => r.id)).toEqual(['S', 'Z'])
  })
  it('ties on sort_order fall back to name; null sort_order sorts last', () => {
    const rows = outlineRows([
      activityRow('1', { name: 'b', sort_order: null }), activityRow('2', { name: 'a', sort_order: null }),
      activityRow('3', { name: 'z', sort_order: 5 }),
    ], new Set())
    expect(rows.map((r) => r.id)).toEqual(['3', '2', '1'])
  })
  it('a parent that is tombstoned or missing promotes the child to the top level', () => {
    const rows = outlineRows([activityRow('C', { parent_id: 'GONE' })], new Set())
    expect(rows.map((r) => [r.id, r.depth])).toEqual([['C', 0]])
  })
})
