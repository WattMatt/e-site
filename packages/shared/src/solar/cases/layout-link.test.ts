import { describe, it, expect } from 'vitest'
import { caseSizeFromLayout, importLayoutBom } from './layout-link'
import { defaultFinanceConfig } from './finance-config'
import { parseCaseConfig, defaultCaseConfig } from './config'
import type { BomRow } from '../layout/summary'

const fin = () => defaultFinanceConfig({})

describe('caseSizeFromLayout', () => {
  it('takes DC and AC from the layout summary', () => {
    expect(caseSizeFromLayout({ moduleCount: 182, dcKwp: 100.1, acKw: 80 })).toEqual({ ok: true, dcKwp: 100.1, acKw: 80 })
  })
  it('refuses a layout with no modules or no inverter — a case needs both sizes', () => {
    expect(caseSizeFromLayout({ moduleCount: 0, dcKwp: 0, acKw: 80 })).toEqual({ ok: false, error: 'This layout has no modules yet — place modules on it first.' })
    expect(caseSizeFromLayout({ moduleCount: 10, dcKwp: 5.5, acKw: 0 })).toEqual({ ok: false, error: 'This layout has no inverter yet — add one on the Layout tab first.' })
  })
})

describe('importLayoutBom', () => {
  const bom: BomRow[] = [
    { item: 'Module', description: 'Generic 550 W', quantity: 182, unit: 'ea' },
    { item: 'Inverter', description: 'Generic 80 kW', quantity: 1, unit: 'ea' },
    { item: 'Mounting', description: 'Racking positions (estimate)', quantity: 182, unit: 'ea' },
    { item: 'Mounting', description: 'Flush rail, two rails per module row (estimate)', quantity: 412.5, unit: 'm' },
    { item: 'DC cable', description: 'String home runs (estimate)', quantity: 640.25, unit: 'm' },
  ]
  it('maps every BOM row to a capex line (category, unit), rate left at 0 for the user', () => {
    const out = importLayoutBom(fin(), bom)
    expect(out.capex.map((l) => [l.category, l.description, l.qty, l.unit, l.rateZar, l.source])).toEqual([
      ['modules', 'Generic 550 W', 182, 'item', 0, 'layout_bom'],
      ['inverters', 'Generic 80 kW', 1, 'item', 0, 'layout_bom'],
      ['mounting', 'Racking positions (estimate)', 182, 'item', 0, 'layout_bom'],
      ['mounting', 'Flush rail, two rails per module row (estimate)', 412.5, 'm', 0, 'layout_bom'],
      ['dc_bos', 'String home runs (estimate)', 640.25, 'm', 0, 'layout_bom'],
    ])
  })
  it('replaces the lines it made last time and keeps every other line (rates the user typed on them carry over)', () => {
    const first = importLayoutBom(fin(), bom)
    const priced = { ...first, capex: [...first.capex.map((l, i) => (i === 0 ? { ...l, rateZar: 2500 } : l)), { id: 'm1', category: 'labour' as const, description: 'Install', qty: 1, unit: 'lot' as const, rateZar: 50_000, qualifies12b: true, source: 'manual' as const }] }
    const again = importLayoutBom(priced, [{ item: 'Module', description: 'Generic 550 W', quantity: 200, unit: 'ea' }])
    expect(again.capex.map((l) => [l.description, l.qty, l.rateZar, l.source])).toEqual([
      ['Install', 1, 50_000, 'manual'],
      ['Generic 550 W', 200, 2500, 'layout_bom'],
    ])
  })
  it('the imported config still parses (ids unique, ≤ 40 chars, descriptions ≤ 200)', () => {
    const out = importLayoutBom(fin(), [...bom, { item: 'Module', description: 'x'.repeat(260), quantity: 1, unit: 'ea' }])
    expect(new Set(out.capex.map((l) => l.id)).size).toBe(out.capex.length)
    expect(out.capex.every((l) => l.id.length <= 40 && l.description.length <= 200)).toBe(true)
  })
})

describe('a layout-sourced case config', () => {
  it('parses with pv.source = layout', () => {
    const c = defaultCaseConfig({}, { dcKwp: 100, acKw: 80 })
    expect(parseCaseConfig({ ...c, pv: { ...c.pv, source: 'layout' } }).ok).toBe(true)
  })
})
