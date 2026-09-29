import { describe, it, expect } from 'vitest'
import { linear, niceTicks, formatNumber } from './scale'

describe('chart scale', () => {
  it('nice ticks cover the range with round steps', () => {
    expect(niceTicks(0, 87, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(0.1, 0.43, 4)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
    expect(niceTicks(5, 5, 5)).toEqual([4, 4.5, 5, 5.5, 6])
  })
  it('linear maps domain to range', () => {
    const s = linear([0, 10], [100, 0])
    expect(s(0)).toBe(100)
    expect(s(5)).toBe(50)
    expect(s.invert(25)).toBe(7.5)
  })
  it('formats with thousands separators', () => {
    expect(formatNumber(87600)).toBe('87 600')
    expect(formatNumber(1.2345, 2)).toBe('1.23')
  })
})
