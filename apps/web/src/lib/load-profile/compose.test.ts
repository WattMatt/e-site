import { describe, expect, it } from 'vitest'
import { makeCharge, makeTariff, type TouCalendar } from '@esite/shared'
import { composeView, NO_CALENDAR, type SourceRow } from './compose'
import { buildExportModel } from './export-model'

/** 2025, 60-min, constant 10 kW: 87 600 kWh; MD 10 kW → 10.526… kVA at PF 0.95. */
function constantMeter(id: string, included = true): SourceRow {
  const first = Date.UTC(2025, 0, 1, 0) - 7_200_000 + 3_600_000 // 2025-01-01 00:00–01:00 SAST ends 01:00
  return {
    id, kind: 'meter', label: `meter ${id}`, included, file_name: 'm.csv', format: 'B', source_column: 'P (per kW)', kva_column: null,
    interval_min: 60, first_ts_end: new Date(first).toISOString(), values: Array(8760).fill(10), quality: Array(8760).fill(0),
    kva_values: null, conversion: 'kW as recorded', quality_report: null, params: null,
  }
}
const synthetic = (id: string, kind: 'admd' | 'tenant_schedule', params: Record<string, unknown>): SourceRow => ({
  id, kind, label: id, included: true, file_name: null, format: null, source_column: null, kva_column: null, interval_min: null,
  first_ts_end: null, values: null, quality: null, kva_values: null, conversion: null, quality_report: null, params,
})
const flat: TouCalendar = {
  highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
  windows: (['high', 'low'] as const).flatMap((season) => (['weekday', 'saturday', 'sunday'] as const).map((dayType) => ({ season, dayType, startMinute: 0, endMinute: 1440, period: 'off_peak' as const }))),
}
const tariff = makeTariff({ name: 'Flat', structure: 'tou', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, tou: 'off_peak' })] })

describe('composeView', () => {
  it('one measured meter: annual energy, interval MD, NMD and a flat-rate cost', () => {
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, sources: [constantMeter('a')], tenants: [], costing: { tariffId: 't', tariff, calendar: flat, calendarAssumedEskom: false, label: 'Flat' } })
    expect(v.analysis!.kpis.annualKwh).toBeCloseTo(87_600, 6)
    expect(v.analysis!.md!.peak.kva).toBeCloseTo(10 / 0.95, 9)
    expect(v.analysis!.nmd).toMatchObject({ kva: 15, basis: 'measured_md' }) // 10.526 × 1.1 = 11.58 → 15
    expect(v.cost).toMatchObject({ ok: true, nmdKva: 10.53, nmdIsSuggestion: true }) // the highest demand itself, not the suggestion
    if (v.cost?.ok) expect(v.cost.annual.totalExclVat).toBeCloseTo(87_600 * 2, 6) // R2.00/kWh
    expect(v.sources[0]).toMatchObject({ status: 'ok', annualKwh: 87_600, filled: { ownShape: 0 } })
  })

  it('measured + ADMD: sums the series, NMD adds the synthetic peak, composition splits energy', () => {
    const v = composeView({
      referenceYear: 2025, powerFactor: 0.95, nmdKva: 200, tenants: [], costing: null,
      sources: [constantMeter('a'), synthetic('flats', 'admd', { units: 10, admdKva: 2, archetype: 'anchor_24h' })],
    })
    const admdKwh = v.sources[1].annualKwh!
    expect(v.sources[1].peakKw).toBeCloseTo(10 * 2 * 0.95, 9)
    expect(v.analysis!.kpis.annualKwh).toBeCloseTo(87_600 + admdKwh, 6)
    expect(v.analysis!.composition).toEqual({ measuredKwh: expect.closeTo(87_600, 6), syntheticKwh: expect.closeTo(admdKwh, 6) })
    expect(v.analysis!.nmd.basis).toBe('measured_md_plus_synthetic')
    expect(v.analysis!.nmd.basisKva).toBeCloseTo(10 / 0.95 + 19 / 0.95, 9)
  })

  it('an excluded source is shown but not summed', () => {
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], costing: null, sources: [constantMeter('a'), constantMeter('b', false)] })
    expect(v.analysis!.kpis.annualKwh).toBeCloseTo(87_600, 6)
    expect(v.sources[1]).toMatchObject({ included: false, annualKwh: 87_600 })
  })

  it('tenant schedule: synthesised from the tenants, skipped ones reported', () => {
    const v = composeView({
      referenceYear: 2025, powerFactor: 0.95, nmdKva: null, costing: null,
      sources: [synthetic('schedule', 'tenant_schedule', { commonAreaPct: 10 })],
      tenants: [{ label: 'Shop 1', areaM2: 100, category: 'standard', densityWPerM2: 20 }, { label: 'Shop 2', areaM2: null, category: null }],
    })
    expect(v.sources[0].detail).toBe('1 tenant synthesised, 1 without an area skipped; common area +10 %')
    expect(v.analysis!.md).toBeNull()
    expect(v.analysis!.nmd.basis).toBe('design_peak')
  })

  it('a broken source is reported and left out; nothing included → no analysis', () => {
    const bad = { ...constantMeter('x'), values: [1], quality: [0] }
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], costing: null, sources: [bad] })
    expect(v.sources[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/no complete day/) })
    expect(v.analysis).toBeNull()
  })

  it('a tariff that could not be loaded is reported, not thrown', () => {
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], sources: [constantMeter('a')], costing: { tariffId: 't', error: 'This tariff is no longer published.' } })
    expect(v.cost).toEqual({ ok: false, tariffId: 't', error: 'This tariff is no longer published.' })
  })

  it('no TOU calendar loaded: a flat tariff is costed (no period split); a TOU tariff is refused with the reason', () => {
    const flatOnly = makeTariff({ name: 'Business flat', structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200 })] })
    const ok = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], sources: [constantMeter('a')], costing: { tariffId: 'f', tariff: flatOnly, calendar: null, calendarAssumedEskom: false, label: 'Flat' } })
    expect(ok.cost).toMatchObject({ ok: true, touSplit: false, calendarAssumedEskom: false, calendarNote: expect.stringMatching(/no calendar is needed/) })
    if (ok.cost?.ok) expect(ok.cost.annual.totalExclVat).toBeCloseTo(87_600 * 2, 6)
    const refused = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], sources: [constantMeter('a')], costing: { tariffId: 't', tariff, calendar: null, calendarAssumedEskom: false, label: 'TOU' } })
    expect(refused.cost).toEqual({ ok: false, tariffId: 't', error: NO_CALENDAR })
  })

  it('unconfirmed NMD: a demand tariff bills the measured MD, not the suggestion with headroom', () => {
    const demand = makeTariff({ name: 'Demand', structure: 'flat', charges: [makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 100, demandBasis: 'actual_md' })] })
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], sources: [constantMeter('a')], costing: { tariffId: 'd', tariff: demand, calendar: flat, calendarAssumedEskom: false, label: 'D' } })
    if (!v.cost?.ok) throw new Error('expected a cost')
    expect(v.cost.months[0].totalExclVat).toBeCloseTo(100 * 10.53, 6) // 10/0.95 = 10.526 → 10.53 kVA, not 15
    const confirmed = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: 40, tenants: [], sources: [constantMeter('a')], costing: { tariffId: 'd', tariff: demand, calendar: flat, calendarAssumedEskom: false, label: 'D' } })
    if (confirmed.cost?.ok) expect(confirmed.cost.months[0].totalExclVat).toBeCloseTo(4000, 6) // max(MD, NMD 40)
  })

  it('measured + ADMD: the billed monthly MD includes the block\'s own peak', () => {
    const demand = makeTariff({ name: 'Demand', structure: 'flat', charges: [makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 1, demandBasis: 'actual_md' })] })
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: 1, tenants: [], sources: [constantMeter('a'), synthetic('flats', 'admd', { units: 10, admdKva: 2, archetype: 'anchor_24h' })], costing: { tariffId: 'd', tariff: demand, calendar: flat, calendarAssumedEskom: false, label: 'D' } })
    if (!v.cost?.ok) throw new Error('expected a cost')
    // January: meter 10 kW → 10.526 kVA; ADMD block peaks at 19 kW → 20 kVA (its January peak, seasonal 1.1 × … ≤ the annual peak).
    expect(v.cost.months[0].mdKva).toBeGreaterThan(10 / 0.95 + 1)
    expect(v.cost.demandNote).toMatch(/plus the estimated block's own monthly peak/)
  })

  it('a malformed stored quality report is dropped, not rendered', () => {
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], costing: null, sources: [{ ...constantMeter('a'), quality_report: { coveragePct: 'lots' } as never }] })
    expect(v.sources[0].quality).toBeNull()
  })

  it('the composed view survives a JSON round trip unchanged (page → client props)', () => {
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], sources: [constantMeter('a'), synthetic('flats', 'admd', { units: 10, admdKva: 2, archetype: 'retail' })], costing: { tariffId: 't', tariff, calendar: flat, calendarAssumedEskom: false, label: 'Flat' } })
    expect(JSON.parse(JSON.stringify(v))).toEqual(v)
  })

  it('meters that never ran together: labelled as a sum of peaks in the export, never as a measured MD at a time', () => {
    const jan = { ...constantMeter('a'), values: Array(24 * 40).fill(10), quality: Array(24 * 40).fill(0) }
    const jul = { ...constantMeter('b'), first_ts_end: new Date(Date.UTC(2025, 6, 1) - 7_200_000 + 3_600_000).toISOString(), values: Array(24 * 40).fill(20), quality: Array(24 * 40).fill(0) }
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], costing: null, sources: [jan, jul] })
    expect(v.analysis!.md!.basis).toBe('sum_of_meter_peaks')
    const m = buildExportModel({ projectId: 'p', projectName: 'X', canEdit: false, profileId: 'x', settings: { referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tariffId: null }, tenants: { count: 0, withArea: 0, totalAreaM2: 0 }, ...v }, new Date())
    expect(m.kpis.find(([l]) => l === "Sum of each meter's own peak")?.[1]).toBeCloseTo(30 / 0.95, 1)
    expect(m.kpis.some(([l]) => l.startsWith('Maximum demand'))).toBe(false)
  })

  it('an unconfirmed NMD says every month is billed at no less than the highest demand', () => {
    const v = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tenants: [], sources: [constantMeter('a')], costing: { tariffId: 't', tariff, calendar: flat, calendarAssumedEskom: false, label: 'Flat' } })
    if (!v.cost?.ok) throw new Error('expected a cost')
    expect(v.cost.demandNote).toMatch(/billed at no less than 10.53 kVA/)
  })
})
