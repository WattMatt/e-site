import { describe, expect, it } from 'vitest'
import { percentile, rateStats } from './stats'
import { cpiFromTable, escalate, latestMonth, monthOf } from './escalate'
import { codeForSignature, describeSignature } from './catalogue'
import { groupKey } from './group'
import { budgetCsv } from './budget-csv'

describe('percentile (linear interpolation, Excel PERCENTILE.INC)', () => {
  it('matches hand-computed values', () => {
    expect(percentile([10], 0.5)).toBe(10)
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([1, 2, 3, 4], 0.75)).toBe(3.25)
    expect(percentile([5, 1, 3], 0.75)).toBe(4)
    expect(percentile([], 0.5)).toBeNull()
  })
})

describe('rateStats', () => {
  it('summarises and keeps the most recent observation as latest', () => {
    const s = rateStats([
      { rate: 100, pricedOn: '2025-01-10' }, { rate: 300, pricedOn: '2026-06-25' }, { rate: 200, pricedOn: '2026-02-01' },
    ])
    expect(s).toEqual({ n: 3, min: 100, median: 200, p75: 250, max: 300, latest: { rate: 300, pricedOn: '2026-06-25' } })
  })
  it('is empty-safe', () => {
    expect(rateStats([])).toEqual({ n: 0, min: null, median: null, p75: null, max: null, latest: null })
  })
})

describe('escalate (CPI)', () => {
  const cpi = cpiFromTable({ 2025: [100.3, 101.2, 101.6, 101.9, 102.1, 102.4, 103.3, 103.2, 103.4, 103.5, 103.4, 103.6, 102.5], 2026: [103.8, 104.2] })
  it('reads a table of 12 months + annual average, ignoring the average', () => {
    expect(cpi.get('2025-12')).toBe(103.6)
    expect(cpi.get('2026-02')).toBe(104.2)
    expect(cpi.size).toBe(14)
    expect(latestMonth(cpi)).toBe('2026-02')
  })
  it('scales by CPI(to) / CPI(base month)', () => {
    const e = escalate(1000, '2025-06-25', cpi)
    expect(e).toEqual({ value: 1017.58, factor: 1.017578, baseMonth: '2025-06', toMonth: '2026-02', flag: null })
  })
  it('does not escalate a price newer than the latest index, and says so', () => {
    expect(escalate(1000, '2026-09-01', cpi)).toMatchObject({ value: 1000, factor: 1, flag: 'base_after_latest_index' })
  })
  it('refuses to invent a factor before the series starts', () => {
    expect(escalate(1000, '2010-01-01', cpi)).toMatchObject({ value: null, factor: null, flag: 'base_before_series' })
  })
  it('monthOf takes the calendar month of a date', () => expect(monthOf('2026-06-25')).toBe('2026-06'))
})

describe('catalogue naming', () => {
  it('describes and codes a signature deterministically', () => {
    expect(describeSignature('conduit|m|dia=20|material=pvc')).toBe('Conduit, PVC, 20 mm dia')
    expect(describeSignature('lv_cable|m|conductor=cu|cores=4|install=ground+sleeve+tray|size=95'))
      .toBe('LV cable, 4 core × 95 mm², Cu, in ground / sleeve / tray')
    expect(codeForSignature('conduit|m|dia=20|material=pvc')).toBe('CONDUIT-20-PVC-M')
    expect(codeForSignature('lv_cable|m|conductor=cu|cores=4|install=ground+sleeve+tray|size=95'))
      .toBe('LV_CABLE-CU-4-GROUND+SLEEVE+TRAY-95-M')
  })
  it('different signatures never share a code', () => {
    expect(codeForSignature('trunking|no|component=straight|profile=p9000'))
      .not.toBe(codeForSignature('trunking|m|component=straight|profile=p9000'))
  })
})

describe('groupKey', () => {
  it('groups lines that read the same, whatever their spelling', () => {
    expect(groupKey(['A', 'CONDUIT'], '20mm Ø', 'm')).toBe(groupKey(['B', 'Conduit'], '20 mm ø', 'M'))
    expect(groupKey(['CONDUIT'], '20mm Ø', 'm')).not.toBe(groupKey(['CONDUIT'], '20mm Ø', 'No'))
  })
})

describe('budgetCsv', () => {
  it('writes one row per item, quoting where needed, with a BOM for Excel', () => {
    const csv = budgetCsv({
      statistic: 'median', escalatedTo: '2026-08', generatedOn: '2026-10-05',
      items: [{ code: 'CONDUIT-20-PVC-M', description: 'Conduit, PVC, 20 mm dia', unit: 'm', n: 3, rate: 9.6512, nominal: 9.5, earliest: '2025-01-10', latest: '2026-06-25' },
        { code: 'X', description: 'Has "quotes", and commas', unit: 'no', n: 1, rate: null, nominal: null, earliest: null, latest: null }],
    })
    const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(lines[0]).toBe('Code,Description,Unit,Statistic,Rate (ZAR excl VAT),Nominal rate,Observations,Earliest,Latest,Escalated to (CPI month)')
    expect(lines[1]).toBe('CONDUIT-20-PVC-M,"Conduit, PVC, 20 mm dia",m,median,9.65,9.50,3,2025-01-10,2026-06-25,2026-08')
    expect(lines[2]).toBe('X,"Has ""quotes"", and commas",no,median,,,1,,,2026-08')
  })
})
