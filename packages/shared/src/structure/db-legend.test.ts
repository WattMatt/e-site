import { describe, it, expect } from 'vitest'
import { planQuickAddWays, QUICK_ADD_MAX } from './db-legend'

describe('planQuickAddWays', () => {
  it('numbers from 1 on an empty board', () => {
    expect(planQuickAddWays([], 3)).toEqual(['1', '2', '3'])
  })

  it('continues from the highest existing integer circuit number', () => {
    expect(planQuickAddWays(['1', '2', '5'], 3)).toEqual(['6', '7', '8'])
  })

  it('ignores non-integer circuit numbers when computing the start', () => {
    expect(planQuickAddWays(['3+5+7', 'A1', '2'], 2)).toEqual(['3', '4'])
  })

  it('trims whitespace before parsing', () => {
    expect(planQuickAddWays([' 4 '], 1)).toEqual(['5'])
  })

  it('clamps count to QUICK_ADD_MAX', () => {
    expect(planQuickAddWays([], 999)).toHaveLength(QUICK_ADD_MAX)
  })

  it('clamps count to at least 1', () => {
    expect(planQuickAddWays([], 0)).toEqual(['1'])
    expect(planQuickAddWays([], -5)).toEqual(['1'])
  })
})
