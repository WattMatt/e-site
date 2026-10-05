import { describe, expect, it } from 'vitest'
import { regimeFinancialYearOn, nextDueDate, summariseCycle, type CycleYear } from './cycle'

describe('regimeFinancialYearOn / nextDueDate', () => {
  it('Eskom years start on 1 April, municipal years on 1 July', () => {
    expect(regimeFinancialYearOn('eskom', '2026-03-31')).toBe('2025/26')
    expect(regimeFinancialYearOn('eskom', '2026-04-01')).toBe('2026/27')
    expect(regimeFinancialYearOn('municipal', '2026-06-30')).toBe('2025/26')
    expect(regimeFinancialYearOn('municipal', '2026-07-01')).toBe('2026/27')
  })
  it('the next due date is the next start of a financial year', () => {
    expect(nextDueDate('eskom', '2026-10-05')).toBe('2027-04-01')
    expect(nextDueDate('municipal', '2026-10-05')).toBe('2027-07-01')
    expect(nextDueDate('eskom', '2026-04-01')).toBe('2027-04-01')
  })
})

describe('summariseCycle', () => {
  const lic = [
    { id: 'e', name: 'Eskom', kind: 'eskom' },
    { id: 'a', name: 'A', kind: 'municipal' },
    { id: 'b', name: 'B', kind: 'metro' },
    { id: 'c', name: 'C', kind: 'municipal' },
  ]
  const y = (p: Partial<CycleYear> & Pick<CycleYear, 'id' | 'licenseeId' | 'financialYear' | 'state'>): CycleYear =>
    ({ validationBlocking: null, validatedAt: null, publishedAt: null, ...p })
  const years: CycleYear[] = [
    y({ id: '1', licenseeId: 'e', financialYear: '2026/27', state: 'published', publishedAt: '2026-09-29T10:00:00Z' }),
    y({ id: '2', licenseeId: 'a', financialYear: '2026/27', state: 'in_review', validationBlocking: 3, validatedAt: '2026-09-30' }),
    y({ id: '3', licenseeId: 'b', financialYear: '2026/27', state: 'in_review', validationBlocking: 0, validatedAt: '2026-09-30' }),
    y({ id: '4', licenseeId: 'b', financialYear: '2025/26', state: 'published', publishedAt: '2026-09-29T09:00:00Z' }),
  ]
  const s = summariseCycle(lic, years, '2026-10-05')

  it('counts the current year per regime, including licensees with no row at all', () => {
    expect(s.eskom.targetFy).toBe('2026/27')
    expect(s.eskom.counts).toEqual({ published: 1, in_review: 0, ingesting: 0, missing: 0 })
    expect(s.municipal.targetFy).toBe('2026/27')
    expect(s.municipal.counts).toEqual({ published: 0, in_review: 2, ingesting: 0, missing: 1 })
  })
  it('separates years ready to publish from years with blocking issues', () => {
    expect(s.municipal.readyToPublish.map((r) => r.yearId)).toEqual(['3'])
    expect(s.municipal.blocked.map((r) => [r.yearId, r.blocking])).toEqual([['2', 3]])
  })
  it('lists publish history newest first', () => {
    expect(s.publishHistory.map((h) => h.yearId)).toEqual(['1', '4'])
  })
})
