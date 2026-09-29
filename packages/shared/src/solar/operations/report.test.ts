import { describe, it, expect } from 'vitest'
import { buildMonthlySnapshot, monthlyReportModel, NOTE_SECTIONS, type BuildMonthlyInput } from './report'
import { performanceRows, sourceRows, yearToDate } from './performance'
import { flatBaseline } from './__fixtures__/baseline'

const perfIn = {
  months: ['2026-02', '2026-03'], baseline: flatBaseline(),
  guarantee: { basis: 'p50' as const, pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 },
  commissioningDate: '2026-02-15', dcKwp: 100,
  actual: { '2026-02': { kwh: 450, coverageMinutes: 14 * 1440 }, '2026-03': { kwh: 900, coverageMinutes: 31 * 1440 } },
  generationMeterCount: 1, downtime: [], irradiation: [],
}
const rows = performanceRows(perfIn)
const input = (over: Partial<BuildMonthlyInput> = {}): BuildMonthlyInput => ({
  period: '2026-03', generatedAt: '2026-04-02T08:00:00.000Z', projectName: 'Acme Mall → North',
  commissioningDate: '2026-02-15',
  asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
    equipment: [{ kind: 'module', make: 'Acme Ω', model: 'M-550', rating: 550, unit: 'W', quantity: 182 }, { kind: 'inverter', make: 'Volt', model: 'I-80', rating: 80, unit: 'kW', quantity: 1 }] },
  baseline: flatBaseline(), guarantee: perfIn.guarantee,
  performance: rows[1]!,
  sources: sourceRows([{ meterId: 'm1', label: 'PV main', sharePct: null }], { m1: { '2026-03': { kwh: 900, n: 1488, intervalMin: 30 } } }, '2026-03', rows[1]!.guaranteeKwh),
  downtime: [{ startsAt: '2026-03-10T09:00:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', cause: 'inverter_fault', description: 'Trip ✓',
    excludedFromGuarantee: false, source: 'detected', lostKwh: 16.13, lostZar: 42.5 }],
  lostZarTotal: 42.5,
  tariff: { name: 'Business 1 (City of Tshwane, 2026/27)' },
  ytd: yearToDate(rows, '2026-03'),
  consumption: { gridKwh: 12000, meterLabels: ['Council main'] },
  notes: { summary: 'Solid month.', actions: 'Replace fuse.' },
  ...over,
})

describe('buildMonthlySnapshot', () => {
  it('freezes every figure the report prints, with the period in the shape the database checks', () => {
    const s = buildMonthlySnapshot(input())
    expect(s.version).toBe(1)
    expect(s.period).toBe('2026-03')
    expect(s.periodLabel).toBe('March 2026')
    expect(s.performance.actualKwh).toBe(900)
    expect(s.ytd.actualKwh).toBe(1350)
    expect(s.lost).toEqual({ kwh: 16.13, zar: 42.5 })
    expect(s.consumption.solarSharePct).toBeCloseTo((900 / (900 + 12000)) * 100, 2)
    expect(Object.keys(s.notes).sort()).toEqual([...NOTE_SECTIONS].sort())
    expect(s.notes.performance).toBe('')
  })
  it('without a tariff there is no Rand anywhere', () => {
    const s = buildMonthlySnapshot(input({ tariff: null, lostZarTotal: null, downtime: [{ ...input().downtime[0]!, lostZar: null }] }))
    expect(s.lost.zar).toBeNull()
    expect(s.downtime[0]!.lostZar).toBeNull()
  })
  it('no consumption meter → gridKwh and share are null (never the generation repeated, WM M10)', () => {
    const s = buildMonthlySnapshot(input({ consumption: { gridKwh: null, meterLabels: [] } }))
    expect(s.consumption).toEqual({ gridKwh: null, meterLabels: [], solarSharePct: null })
  })
})

describe('monthlyReportModel', () => {
  it('has every section of the spec, an equipment table from the record, real YTD and the tariff basis', () => {
    const m = monthlyReportModel(buildMonthlySnapshot(input()))
    expect(m.title).toBe('Solar monthly report — March 2026')
    expect(m.sections.map((x) => x.title)).toEqual([
      'Performance summary', 'Expected vs actual per source', 'Year to date', 'Downtime', 'Realised consumption',
      'Installed equipment', 'Commentary and actions', 'Basis of figures',
    ])
    const eq = m.sections.find((x) => x.title === 'Installed equipment')!.tables[0]!
    expect(eq.rows[0]).toEqual(['Module', 'Acme Ω', 'M-550', '550 W', '182'])
    const ytd = m.sections.find((x) => x.title === 'Year to date')!.tables[0]!
    expect(ytd.rows[0]![2]).toBe('1 350')
    const dt = m.sections.find((x) => x.title === 'Downtime')!
    expect(dt.paragraphs.join(' ')).toContain('Business 1 (City of Tshwane, 2026/27)')
    expect(m.summary).toEqual({ period: '2026-03', actualKwh: 900, guaranteeKwh: 1000, variancePct: -10 })
  })
  it('a month with no guarantee to compare against keeps its variance null, never 0 (review B8)', () => {
    const m = monthlyReportModel(buildMonthlySnapshot(input({ performance: { ...rows[1]!, variancePct: null } })))
    expect(m.summary.variancePct).toBeNull()
  })
  it('a GHI entry with no modelled TMY GHI says what the correction needs (review B7)', () => {
    const ghiRow = performanceRows({ ...perfIn, baseline: flatBaseline({ ghiKwhM2: null }), irradiation: [{ month: '2026-03', plane: 'ghi', kwhPerM2: 180, sourceNote: 'Portal' }] })[1]!
    const m = monthlyReportModel(buildMonthlySnapshot(input({ performance: ghiRow })))
    const cell = m.sections[0]!.tables[0]!.rows.find((r) => r[0] === 'Irradiation-corrected expected')![1]
    expect(cell).toBe('needs the modelled horizontal (TMY GHI) irradiation, which this baseline does not carry — record plane-of-array irradiation instead')
    const none = monthlyReportModel(buildMonthlySnapshot(input()))
    expect(none.sections[0]!.tables[0]!.rows.find((r) => r[0] === 'Irradiation-corrected expected')![1]).toBe('no irradiation recorded')
  })
  it('explains a partial share split and shares that do not add to 100 % (review B4)', () => {
    const partial = sourceRows([{ meterId: 'm1', label: 'A', sharePct: 40 }, { meterId: 'm2', label: 'B', sharePct: null }], {}, '2026-03', 1000)
    const p = monthlyReportModel(buildMonthlySnapshot(input({ sources: partial }))).sections[1]!.paragraphs
    expect(p).toEqual(['Meters without a set share take equal parts of what the set shares leave.'])
    const off = sourceRows([{ meterId: 'm1', label: 'A', sharePct: 70 }, { meterId: 'm2', label: 'B', sharePct: 20 }], {}, '2026-03', 1000)
    expect(monthlyReportModel(buildMonthlySnapshot(input({ sources: off }))).sections[1]!.paragraphs)
      .toEqual(['The expected shares of the generation meters add to 90 %, not 100 %.'])
  })
  it('drops empty commentary instead of printing blanks', () => {
    const m = monthlyReportModel(buildMonthlySnapshot(input({ notes: {} })))
    expect(m.sections.find((x) => x.title === 'Commentary and actions')!.paragraphs).toEqual(['No commentary was recorded for this month.'])
  })
})
