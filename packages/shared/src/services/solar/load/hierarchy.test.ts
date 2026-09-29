import { describe, it, expect } from 'vitest'
import { descendants, doubleCountGuard, reconcileParents, supplyChildren, wouldCreateCycle } from './hierarchy'

const L = (fromMeterId: string, toMeterId: string, lineType: 'supply' | 'check' = 'supply') => ({ fromMeterId, toMeterId, lineType })

describe('supply hierarchy', () => {
  it('maps parents to distinct children and ignores check lines', () => {
    const c = supplyChildren([L('P', 'A'), L('P', 'B'), L('P', 'A'), L('A', 'X', 'check')])
    expect(c.get('P')).toEqual(['A', 'B'])
    expect(c.has('A')).toBe(false)
  })

  it('finds transitive descendants and survives a stored loop', () => {
    const c = supplyChildren([L('P', 'A'), L('A', 'B'), L('B', 'P')])
    expect([...descendants('P', c)].sort()).toEqual(['A', 'B'])
  })

  it('refuses a line that would close a loop, and a self line; a check line never loops', () => {
    const lines = [L('P', 'A'), L('A', 'B')]
    expect(wouldCreateCycle(lines, L('B', 'P'))).toBe(true)
    expect(wouldCreateCycle(lines, L('A', 'A'))).toBe(true)
    expect(wouldCreateCycle(lines, L('P', 'B'))).toBe(false)
    expect(wouldCreateCycle(lines, L('B', 'P', 'check'))).toBe(false)
  })

  it('double-count guard: children win, the parent is dropped (transitively)', () => {
    const lines = [L('P', 'A'), L('A', 'B')]
    const r = doubleCountGuard(['P', 'B', 'Z'], lines)
    expect(r.kept.sort()).toEqual(['B', 'Z'])
    expect(r.droppedParents).toEqual([{ meterId: 'P', includedDescendants: ['B'] }])
  })

  it('double-count guard keeps a parent whose children are not included', () => {
    expect(doubleCountGuard(['P'], [L('P', 'A')])).toEqual({ kept: ['P'], droppedParents: [] })
  })

  it('reconciles each parent against the sum of its children, skipping months either side lacks', () => {
    const monthly = new Map<string, number[]>([
      ['P', Array.from({ length: 12 }, (_, i) => (i === 0 ? NaN : 100))],
      ['A', Array(12).fill(60)],
      ['B', Array.from({ length: 12 }, (_, i) => (i === 1 ? 20 : 45))],
    ])
    const [r] = reconcileParents([L('P', 'A'), L('P', 'B')], monthly)
    expect(r.parentMeterId).toBe('P')
    expect(r.childMeterIds).toEqual(['A', 'B'])
    expect(r.months).toHaveLength(11)
    const feb = r.months.find((m) => m.month === 2)!
    expect(feb).toMatchObject({ parentKwh: 100, childrenKwh: 80, flagged: true })
    expect(feb.ratio).toBeCloseTo(0.8)
    const mar = r.months.find((m) => m.month === 3)!
    expect(mar).toMatchObject({ childrenKwh: 105, flagged: false })
  })

  it('a parent with zero energy but children with energy is flagged', () => {
    const monthly = new Map<string, number[]>([['P', Array(12).fill(0)], ['A', Array(12).fill(5)]])
    const [r] = reconcileParents([L('P', 'A')], monthly)
    expect(r.months[0]).toMatchObject({ ratio: null, flagged: true })
  })
})
