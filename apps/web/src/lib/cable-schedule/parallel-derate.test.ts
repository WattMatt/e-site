// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { targetGroupedWith, groupSizeForNewStrand } from './parallel-derate'

describe('targetGroupedWith — existing strand after the supply strand count changes', () => {
  it('auto-managed value tracks the final strand count on add (1 → 2)', () => {
    // The F4 audit case: a 2nd strand added to a 1-strand supply — the
    // survivor must be re-derated at group size 2, not left at 1.
    expect(targetGroupedWith(1, 1, 2)).toBe(2)
  })

  it('auto-managed value tracks the final strand count on delete (3 → 2)', () => {
    // Strands stamped grouped_with = 3 by the set-create; deleting one
    // re-derates the survivors at 2.
    expect(targetGroupedWith(3, 3, 2)).toBe(2)
  })

  it('legacy under-derated value (grouped_with = 1 on a 3-strand supply) is healed to the final count', () => {
    expect(targetGroupedWith(1, 3, 4)).toBe(4)
  })

  it('user-entered trench group (> previous strand count) is preserved on add', () => {
    // Engineer recorded 6 cables in the trench (other runs share it);
    // adding a 3rd strand must not shrink the derate group below 6.
    expect(targetGroupedWith(6, 2, 3)).toBe(6)
  })

  it('user-entered trench group is preserved on delete', () => {
    expect(targetGroupedWith(6, 3, 2)).toBe(6)
  })

  it('user-entered trench group still rises when the strand count overtakes it', () => {
    expect(targetGroupedWith(4, 3, 8)).toBe(8)
  })

  it('garbage stored values are treated as 1 (auto) and track the final count', () => {
    expect(targetGroupedWith(0, 2, 3)).toBe(3)
    expect(targetGroupedWith(Number.NaN, 2, 3)).toBe(3)
  })
})

describe('groupSizeForNewStrand — new strand joining an existing supply', () => {
  it('fresh set: equals the set size', () => {
    expect(groupSizeForNewStrand([], 0, 5)).toBe(5)
  })

  it('plain add-strand: equals the final strand count', () => {
    expect(groupSizeForNewStrand([2, 2], 2, 3)).toBe(3)
  })

  it('inherits a sibling user-entered trench group', () => {
    // Siblings carry grouped_with = 6 (> old set size 2) — the new strand
    // joins the same trench and must be derated at 6, not 3.
    expect(groupSizeForNewStrand([6, 6], 2, 3)).toBe(6)
  })

  it('ignores sibling values at or below the old set size (auto-managed)', () => {
    expect(groupSizeForNewStrand([2, 1], 2, 3)).toBe(3)
  })
})
