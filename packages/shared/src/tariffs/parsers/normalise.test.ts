import { describe, expect, it } from 'vitest'
import { normaliseCharge, type NormaliseInput } from './normalise'
import { parseAmount } from './amount'

const base = (label: string, raw: string | number, over: Partial<NormaliseInput> = {}): NormaliseInput => ({
  label,
  amount: parseAmount(raw)!,
  rawValue: String(raw),
  unitColumn: null,
  contextUnit: null,
  headerUnit: null,
  componentHint: null,
  seasonState: { energy: 'all', general: 'all' },
  blockText: null,
  vatBasis: 'assumed_excl',
  extractionMethod: 'parser',
  locator: { sheet: 'T', row: 1 },
  ...over,
})

describe('normaliseCharge', () => {
  it('Buffalo City: c/kWh label with 3.09 becomes R/kWh, flagged', () => {
    const r = normaliseCharge(base('Part 1 - Charge per kWh (c/kWh)', 3.09))
    expect(r.ok && r.charge).toMatchObject({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 3.09, unitInferred: true })
  })
  it('City Power: a "(c/kVArh)" label under "Demand" is reactive at 37.64 c/kVArh', () => {
    const r = normaliseCharge(base('All season Demand Charge (c/kVArh)', 'R37,64'))
    expect(r.ok && r.charge).toMatchObject({ component: 'reactive', unit: 'c_per_kVArh', amountExclVat: 37.64, season: 'all', unitInferred: false })
  })
  it('uses a compatible header unit and ignores an incompatible one', () => {
    const energy = normaliseCharge(base('Block 1 (0-500kWh)', 227.28, { headerUnit: 'c_per_kWh' }))
    expect(energy.ok && energy.charge).toMatchObject({ unit: 'c_per_kWh', unitInferred: false, blockMinKwh: 0, blockMaxKwh: 500, blockBasis: 'monthly' })
    const hinted = normaliseCharge(base('Part 1 - Charge per kWh', 3.425, { contextUnit: 'R_per_kVA_month' }))
    expect(hinted.ok && hinted.charge).toMatchObject({ component: 'energy', unit: 'R_per_kWh', unitInferred: true })
  })
  it('assumes R/month for a unitless fixed charge, flagged (Centlec SSEG "R110,00")', () => {
    const r = normaliseCharge(base('Basic charges:', 'R110,00'))
    expect(r.ok && r.charge).toMatchObject({ component: 'basic', unit: 'R_per_month', unitInferred: true })
  })
  it('refuses a unitless non-fixed, non-energy charge (NMB "Wheeling Charge")', () => {
    const r = normaliseCharge(base('Wheeling Charge', 112.31))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.unresolved.reason).toMatch(/wheeling_uos/)
  })
  it('applies season state: energy follows the energy season, fixed charges stay all-season', () => {
    const state = { energy: 'high' as const, general: 'all' as const }
    const peak = normaliseCharge(base('Peak', 634.02, { headerUnit: 'c_per_kWh', seasonState: state }))
    const service = normaliseCharge(base('Service Charge (R/month)', 235.79, { seasonState: { energy: 'high', general: 'high' } }))
    expect(peak.ok && peak.charge).toMatchObject({ season: 'high', tou: 'peak' })
    expect(service.ok && service.charge.season).toBe('all')
  })
  it('marks per-kVA network capacity as NMD-based', () => {
    const r = normaliseCharge(base('Network capacity charge', 'R0.00A/kVA NMD/Month'))
    expect(r.ok && r.charge).toMatchObject({ component: 'network_capacity', unit: 'R_per_kVA_month', demandBasis: 'nmd', amountExclVat: 0 })
  })
  it('refuses a reactive charge in R/kVArh (no such unit) instead of billing it on maximum demand', () => {
    const r = normaliseCharge(base('Reactive energy charge (R/kVArh)', 'R0.25'))
    expect(r.ok).toBe(false)
  })
  it('refuses an explicit unit that cannot belong to the component', () => {
    const r = normaliseCharge(base('Service charge', '250c/kWh'))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.unresolved.reason).toMatch(/incompatible/)
  })
  it('sends a Wh block typo to review', () => {
    const r = normaliseCharge(base('Block 3 (>500Wh)', 322.61, { headerUnit: 'c_per_kWh' }))
    expect(r.ok && r.issues.map((i) => i.code)).toEqual(['block_unit_typo'])
  })
})
