import { describe, expect, it } from 'vitest'
import { buildChargeGroups, citeLocator, type ExplorerCharge } from './charge-rows'
import { ch, tariff } from './fixtures'

const ex = (id: string, c: ExplorerCharge['charge'], src: Partial<ExplorerCharge> = {}): ExplorerCharge => ({
  id, charge: c, sourceDocumentId: 'doc1', sourceTitle: 'Eskom tariffs 2026/27', ...src,
})

const peakHigh = ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 600, season: 'high', tou: 'peak', sourceLocator: { sheet: 'Megaflex NLA', cell: 'J8' } })
const offLow = ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 120, season: 'low', tou: 'off_peak' })
const basic = ch({ component: 'basic', unit: 'R_per_month', amountExclVat: 250, sourceLocator: { page: 12, raw_text: 'Basic 250' } })
const ancillary = ch({ component: 'ancillary', unit: 'c_per_kWh', amountExclVat: 0.5 })

describe('citeLocator', () => {
  it('cites a PDF page, a workbook cell, or the title alone', () => {
    expect(citeLocator('Book', { page: 12 })).toBe('Book, page 12')
    expect(citeLocator('Book', { sheet: 'Megaflex NLA', cell: 'J8' })).toBe('Book, Megaflex NLA J8')
    expect(citeLocator('Book', {})).toBe('Book')
    expect(citeLocator(null, { page: 3 })).toBe('No source recorded')
  })
})

describe('buildChargeGroups', () => {
  const now = tariff('Megaflex', [ancillary, basic, offLow, peakHigh])

  it('groups by component in reading order: energy, then fixed, then network and adders', () => {
    const groups = buildChargeGroups(now, now.charges.map((c, i) => ex(String(i), c)), null)
    expect(groups.map((g) => g.component)).toEqual(['energy', 'basic', 'ancillary'])
    expect(groups[0].label).toBe('Energy')
  })

  it('orders energy rows high season before low, peak before off-peak', () => {
    const [energy] = buildChargeGroups(now, now.charges.map((c, i) => ex(String(i), c)), null)
    expect(energy.rows.map((r) => [r.season, r.period])).toEqual([
      ['High demand (winter)', 'Peak'],
      ['Low demand (summer)', 'Off-peak'],
    ])
  })

  it('formats the amount with its unit and carries the citation', () => {
    const [energy, fixed] = buildChargeGroups(now, now.charges.map((c, i) => ex(String(i), c)), null)
    expect(energy.rows[0].amount).toBe('600.00 c/kWh')
    expect(energy.rows[0].citation).toBe('Eskom tariffs 2026/27, Megaflex NLA J8')
    expect(fixed.rows[0].amount).toBe('R250.00/month')
    expect(fixed.rows[0].citation).toBe('Eskom tariffs 2026/27, page 12')
    expect(fixed.rows[0].canViewSource).toBe(true)
  })

  it('says there is no previous year when none is given', () => {
    const rows = buildChargeGroups(now, now.charges.map((c, i) => ex(String(i), c)), null).flatMap((g) => g.rows)
    expect(rows.every((r) => r.yoy.kind === 'no_previous')).toBe(true)
  })

  it('computes YoY % against the same charge last year, and marks new and unchanged charges', () => {
    const prev = tariff('MEGAFLEX', [
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 500, season: 'high', tou: 'peak' }),
      ch({ component: 'basic', unit: 'R_per_month', amountExclVat: 250 }),
    ])
    const rows = buildChargeGroups(now, now.charges.map((c, i) => ex(String(i), c)), prev).flatMap((g) => g.rows)
    const byPeriod = (s: string) => rows.find((r) => r.period === s && r.component === 'energy')!
    expect(byPeriod('Peak').yoy).toEqual({ kind: 'changed', pct: 20 })
    expect(byPeriod('Off-peak').yoy).toEqual({ kind: 'new' })
    expect(rows.find((r) => r.component === 'basic')!.yoy).toEqual({ kind: 'changed', pct: 0 })
  })

  it('compares a c/kWh charge with an R/kWh one in rand, and flags a unit-class change', () => {
    const prev = tariff('Megaflex', [
      ch({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 5, season: 'high', tou: 'peak' }),
      ch({ component: 'basic', unit: 'R_per_day', amountExclVat: 8 }),
    ])
    const rows = buildChargeGroups(now, now.charges.map((c, i) => ex(String(i), c)), prev).flatMap((g) => g.rows)
    expect(rows.find((r) => r.period === 'Peak')!.yoy).toEqual({ kind: 'changed', pct: 20 })
    expect(rows.find((r) => r.component === 'basic')!.yoy).toEqual({ kind: 'unit_changed' })
  })

  it('shows a block range and a day type, and says when a unit was inferred', () => {
    const t = tariff('Domestic', [
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, blockMinKwh: 0, blockMaxKwh: 50, blockBasis: 'monthly', unitInferred: true, inferenceReason: 'magnitude' }),
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250, blockMinKwh: 50, blockMaxKwh: null, blockBasis: 'monthly', dayType: 'weekday' }),
    ], { structure: 'ibt' })
    const [g] = buildChargeGroups(t, t.charges.map((c, i) => ex(String(i), c, { sourceDocumentId: null, sourceTitle: null })), null)
    expect(g.rows.map((r) => r.block)).toEqual(['0–50 kWh/month', 'Above 50 kWh/month'])
    expect(g.rows[0].unitNote).toBe('Unit inferred: magnitude')
    expect(g.rows[1].dayType).toBe('Weekdays')
    expect(g.rows[0].canViewSource).toBe(false)
  })
})
