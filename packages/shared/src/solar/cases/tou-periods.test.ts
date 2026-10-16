import { describe, it, expect } from 'vitest'
import type { TouCalendar } from '../../tariffs/tou'
import { engineTouPeriods, monthlyTouSplit } from './tou-periods'

const cal: TouCalendar = {
  highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
  windows: [
    { season: 'low', dayType: 'weekday', startMinute: 7 * 60, endMinute: 10 * 60, period: 'peak' },
    { season: 'low', dayType: 'weekday', startMinute: 10 * 60, endMinute: 18 * 60, period: 'standard' },
    { season: 'high', dayType: 'weekday', startMinute: 6 * 60, endMinute: 9 * 60, period: 'peak' },
  ],
}

describe('engineTouPeriods', () => {
  const p = engineTouPeriods(cal, undefined, 2025)
  it('is 8760 long and uses the engine spelling off-peak', () => {
    expect(p).toHaveLength(8760)
    expect(new Set(p)).toEqual(new Set(['off-peak', 'peak', 'standard']))
  })
  it('2 Jan 2025 (Thursday) 08:00 is low-season peak; 4 Jan (Saturday) 08:00 is off-peak', () => {
    expect(p[24 + 8]).toBe('peak')
    expect(p[3 * 24 + 8]).toBe('off-peak')
  })
  it('a holiday treated as Sunday is off-peak', () => {
    const h = engineTouPeriods(cal, new Set(['2025-01-02']), 2025)
    expect(h[24 + 8]).toBe('off-peak')
  })
  it('high season uses its own windows (1 July 2025 is a Tuesday)', () => {
    const jul1 = (31 + 28 + 31 + 30 + 31 + 30) * 24
    expect(p[jul1 + 7]).toBe('peak')
    expect(p[jul1 + 9]).toBe('off-peak')
  })
})

describe('monthlyTouSplit', () => {
  it('splits each month by period and conserves energy', () => {
    const p = engineTouPeriods(cal, undefined, 2025)
    const s = monthlyTouSplit(new Float64Array(8760).fill(1), p)
    expect(s).toHaveLength(12)
    expect(s[0]!.peak + s[0]!.standard + s[0]!.offPeak).toBe(31 * 24)
    expect(s[0]!.peak).toBe(23 * 3) // 23 weekdays in January 2025, 3 peak hours each
  })
})

describe('engineTouPeriods with dated holiday treatment', () => {
  // 2025-04-28 is a Monday. Low season weekday 07-10 is peak in this calendar.
  const idx = (m: number, d: number, h: number) => {
    const before = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].slice(0, m - 1).reduce((a, b) => a + b, 0)
    return (before + d - 1) * 24 + h
  }
  it('a Monday billed as a Saturday has no peak hours; the Set form is unchanged', () => {
    const noRule = { ...cal, holidayTreatedAs: null }
    expect(engineTouPeriods(noRule, new Set(['2025-04-28']), 2025)[idx(4, 28, 8)]).toBe('peak')
    expect(engineTouPeriods(noRule, new Map([['2025-04-28', 'saturday' as const]]), 2025)[idx(4, 28, 8)]).toBe('off-peak')
  })
})
