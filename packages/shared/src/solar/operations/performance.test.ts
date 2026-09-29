import { describe, it, expect } from 'vitest'
import { downtimeHoursInMonth, performanceRows, shareTotalNote, sourceRows, totalsByMonth, yearToDate, type PerformanceInput } from './performance'
import { flatBaseline } from './__fixtures__/baseline'

const base = (over: Partial<PerformanceInput> = {}): PerformanceInput => ({
  months: ['2026-02', '2026-03', '2026-04'],
  baseline: flatBaseline(),
  guarantee: { basis: 'p50', pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 },
  commissioningDate: '2026-02-15',
  dcKwp: 100,
  actual: { '2026-02': { kwh: 450, coverageMinutes: 14 * 1440 }, '2026-03': { kwh: 900, coverageMinutes: 31 * 1440 } },
  generationMeterCount: 1,
  downtime: [],
  irradiation: [],
  ...over,
})

describe('performanceRows', () => {
  it('expected, actual, variance and coverage per month; a month with no data has actual null', () => {
    const rows = performanceRows(base())
    expect(rows.map((r) => r.month)).toEqual(['2026-02', '2026-03', '2026-04'])
    expect(rows[0]).toMatchObject({ expectedKwh: 500, guaranteeKwh: 500, actualKwh: 450, varianceKwh: -50, variancePct: -10, coveragePct: 100 })
    expect(rows[1]).toMatchObject({ guaranteeKwh: 1000, actualKwh: 900, variancePct: -10 })
    expect(rows[2]).toMatchObject({ actualKwh: null, variancePct: null, coveragePct: null })
  })
  it('excluded downtime lowers the guarantee by the SHAPED expectation of its window', () => {
    // 11:00–13:00 on 10 March: 2 producing hours of 4 per day, 31 days → 2/124 of 1000 kWh.
    const rows = performanceRows(base({ downtime: [{ id: 'd1', startsAt: '2026-03-10T09:00:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', cause: 'grid_outage', description: null, excludedFromGuarantee: true, source: 'manual' }] }))
    const m = rows[1]!
    // Rows carry kWh rounded to 3 dp (r3), so compare at 3 dp.
    expect(m.excludedKwh).toBeCloseTo(1000 * 2 / 124, 3)
    expect(m.guaranteeKwh).toBeCloseTo(1000 - 1000 * 2 / 124, 3)
    expect(m.downtimeHours).toBe(2)
    expect(m.excludedHours).toBe(2)
  })
  it('POA irradiation gives PR and a PR-corrected expectation; GHI gives a ratio correction and no PR', () => {
    const poa = performanceRows(base({ irradiation: [{ month: '2026-03', plane: 'poa', kwhPerM2: 150, sourceNote: 'Station' }] }))[1]!
    expect(poa.performanceRatio).toBeCloseTo(900 / (100 * 150), 9)
    expect(poa.correctedExpectedKwh).toBeCloseTo(0.8 * 100 * 150, 6)
    const ghi = performanceRows(base({ irradiation: [{ month: '2026-03', plane: 'ghi', kwhPerM2: 180, sourceNote: 'Portal' }] }))[1]!
    expect(ghi.performanceRatio).toBeNull()
    expect(ghi.correctedExpectedKwh).toBeCloseTo(1000 * 180 / 200, 6)
  })
  it('months before commissioning are dropped', () => {
    expect(performanceRows(base({ months: ['2026-01', '2026-02'] })).map((r) => r.month)).toEqual(['2026-02'])
  })
})

describe('yearToDate — real sums, never the month repeated (WM M4)', () => {
  it('sums January (or commissioning) to the report month', () => {
    const rows = performanceRows(base())
    const y = yearToDate(rows, '2026-03')
    expect(y).toMatchObject({ year: 2026, fromMonth: '2026-02', toMonth: '2026-03', guaranteeKwh: 1500, actualKwh: 1350, monthsWithoutData: 0 })
    expect(y.variancePct).toBeCloseTo(-10, 9)
    expect(y.actualKwh).not.toBe(rows[1]!.actualKwh)
    expect(yearToDate(rows, '2026-04').monthsWithoutData).toBe(1)
  })
})

describe('helpers', () => {
  it('sums meters per month and counts downtime hours inside the month only', () => {
    expect(totalsByMonth({ a: { '2026-03': { kwh: 10, n: 2, intervalMin: 30 } }, b: { '2026-03': { kwh: 5, n: 4, intervalMin: 15 } } }))
      .toEqual({ '2026-03': { kwh: 15, coverageMinutes: 120 } })
    const d = [{ id: 'x', startsAt: '2026-03-31T20:00:00.000Z', endsAt: '2026-04-01T02:00:00.000Z', cause: 'other', description: null, excludedFromGuarantee: false, source: 'manual' as const }]
    expect(downtimeHoursInMonth(d, '2026-03')).toEqual({ total: 2, excluded: 0 })
    expect(downtimeHoursInMonth(d, '2026-04')).toEqual({ total: 4, excluded: 0 })
  })
  it('splits expected per source by share, or equally when no share is set', () => {
    const mm = { m1: { '2026-03': { kwh: 600, n: 1, intervalMin: 30 } }, m2: { '2026-03': { kwh: 300, n: 1, intervalMin: 30 } } }
    expect(sourceRows([{ meterId: 'm1', label: 'A', sharePct: null }, { meterId: 'm2', label: 'B', sharePct: null }], mm, '2026-03', 1000))
      .toEqual([
        { meterId: 'm1', label: 'A', sharePct: 50, expectedKwh: 500, actualKwh: 600, allocatedEqually: true },
        { meterId: 'm2', label: 'B', sharePct: 50, expectedKwh: 500, actualKwh: 300, allocatedEqually: true },
      ])
    expect(sourceRows([{ meterId: 'm1', label: 'A', sharePct: 70 }, { meterId: 'm2', label: 'B', sharePct: 30 }], mm, '2026-03', 1000)[0])
      .toMatchObject({ expectedKwh: 700, allocatedEqually: false })
  })
  it('meters without a share split the REMAINDER equally, never zero (review B4)', () => {
    const three = [{ meterId: 'm1', label: 'A', sharePct: 40 }, { meterId: 'm2', label: 'B', sharePct: null }, { meterId: 'm3', label: 'C', sharePct: null }]
    const rows = sourceRows(three, {}, '2026-03', 1000)
    expect(rows.map((r) => [r.sharePct, r.expectedKwh, r.allocatedEqually])).toEqual([[40, 400, false], [30, 300, true], [30, 300, true]])
    // Set shares above 100 leave nothing to split (floor 0).
    const over = sourceRows([{ meterId: 'm1', label: 'A', sharePct: 80 }, { meterId: 'm2', label: 'B', sharePct: 30 }, { meterId: 'm3', label: 'C', sharePct: null }], {}, '2026-03', 1000)
    expect(over.map((r) => r.sharePct)).toEqual([80, 30, 0])
  })
  it('says when the shares do not add to 100 % (review B4)', () => {
    expect(shareTotalNote([{ sharePct: null }, { sharePct: null }])).toBeNull()
    expect(shareTotalNote([{ sharePct: 40 }, { sharePct: null }])).toBeNull()
    expect(shareTotalNote([{ sharePct: 70 }, { sharePct: 30 }])).toBeNull()
    expect(shareTotalNote([{ sharePct: 70 }, { sharePct: 20 }])).toBe('The expected shares of the generation meters add to 90 %, not 100 %.')
    expect(shareTotalNote([{ sharePct: 80 }, { sharePct: 30 }, { sharePct: null }])).toBe('The expected shares of the generation meters add to 110 %, not 100 %.')
    expect(shareTotalNote([])).toBeNull()
  })
})

describe('commissioning month PR (review B6)', () => {
  it('prorates the month’s irradiation by the same active fraction as the expectation', () => {
    // Commissioned on the 16th of March: 16 of 31 days active.
    const rows = performanceRows(base({ commissioningDate: '2026-03-16', months: ['2026-03'], actual: { '2026-03': { kwh: 500, coverageMinutes: 16 * 1440 } },
      irradiation: [{ month: '2026-03', plane: 'poa', kwhPerM2: 150, sourceNote: 'Station' }] }))
    expect(rows[0]!.performanceRatio).toBeCloseTo(500 / (100 * 150 * (16 / 31)), 4)
  })
})
