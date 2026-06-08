import { describe, it, expect } from 'vitest'
import { naturalCompare } from './natural-compare'

describe('naturalCompare', () => {
  it('orders DB-2 before DB-10 (numeric, not lexicographic)', () => {
    expect(naturalCompare('DB-2', 'DB-10')).toBeLessThan(0)
    expect(naturalCompare('DB-10', 'DB-2')).toBeGreaterThan(0)
  })

  it('sorts a realistic Kings Walk board set in natural order', () => {
    const input = ['DB-10', 'DB-2', 'DB-1', 'DB-52A', 'DB-9', 'DB-17B', 'DB-17A']
    const sorted = [...input].sort(naturalCompare)
    expect(sorted).toEqual(['DB-1', 'DB-2', 'DB-9', 'DB-10', 'DB-17A', 'DB-17B', 'DB-52A'])
  })

  it('places a suffixed code after its numeric base (DB-17 before DB-17A)', () => {
    expect(naturalCompare('DB-17', 'DB-17A')).toBeLessThan(0)
  })

  it('is case-insensitive', () => {
    expect(naturalCompare('db-2', 'DB-2')).toBe(0)
  })

  it('sorts equal codes as 0 (stable)', () => {
    expect(naturalCompare('MAIN BOARD 2.1', 'MAIN BOARD 2.1')).toBe(0)
  })
})
