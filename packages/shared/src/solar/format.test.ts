import { describe, it, expect } from 'vitest'
import { formatSolarDate, formatRandWhole, joinNames } from './format'

describe('formatSolarDate', () => {
  it('formats in SAST (UTC+2) without relying on ICU month names', () => {
    expect(formatSolarDate('2026-09-28T08:00:00Z')).toBe('28 Sep 2026')
    // 23:30 UTC on the 28th is already the 29th in Johannesburg.
    expect(formatSolarDate('2026-09-28T23:30:00Z')).toBe('29 Sep 2026')
  })
  it('returns an empty string for garbage', () => {
    expect(formatSolarDate('not a date')).toBe('')
  })
})

describe('formatRandWhole', () => {
  it('formats whole rand with comma thousands', () => {
    expect(formatRandWhole(199900)).toBe('R1,999')
    expect(formatRandWhole(123456700)).toBe('R1,234,567')
    expect(formatRandWhole(5000)).toBe('R50')
  })
})

describe('joinNames', () => {
  it('joins with commas and a final "and"', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['Ann'])).toBe('Ann')
    expect(joinNames(['Ann', 'Ben'])).toBe('Ann and Ben')
    expect(joinNames(['Ann', 'Ben', 'Cy'])).toBe('Ann, Ben and Cy')
  })
})
