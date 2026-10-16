import { describe, expect, it } from 'vitest'
import { browseLicensees, displayLicenseeName, provinceLabel } from './browse'
import type { LicenseeSearchItem } from './search'

const L = (name: string, kind: string, province: string | null, liveFy: string | null): LicenseeSearchItem => ({ id: name, name, kind, province, aliases: [], liveFy })

describe('browseLicensees', () => {
  const list = [
    L('ZETA TOWN', 'municipal', 'WC', '2026/27'),
    L('ALPHA METRO', 'metro', 'GP', '2025/26'),
    L('Eskom', 'eskom', 'national', '2026/27'),
    L('BETA METRO', 'metro', 'KZN', null),
    L('ALPHA TOWN', 'municipal', 'WC', '2025/26'),
    L('GAMMA TOWN', 'municipal', 'EC', '2026/27'),
    L('NOWHERE', 'municipal', null, '2026/27'),
    L('DELTA TOWN', 'municipal', 'EC', null),
  ]
  const b = browseLicensees(list)
  it('puts Eskom first, then the metros with a published year', () => {
    expect(b.featured.map((l) => l.name)).toEqual(['Eskom', 'ALPHA METRO'])
  })
  it('groups the other published authorities by province, alphabetically, unknown province last', () => {
    expect(b.provinces.map((p) => [p.label, p.items.map((l) => l.name)])).toEqual([
      ['Eastern Cape', ['GAMMA TOWN']],
      ['Western Cape', ['ALPHA TOWN', 'ZETA TOWN']],
      ['Province not recorded', ['NOWHERE']],
    ])
  })
  it('keeps the unpublished ones apart, metros included', () => {
    expect(b.unpublished.map((l) => l.name)).toEqual(['BETA METRO', 'DELTA TOWN'])
  })
  it('accounts for every authority exactly once', () => {
    const n = b.featured.length + b.provinces.reduce((s, p) => s + p.items.length, 0) + b.unpublished.length
    expect(n).toBe(list.length)
  })
})

describe('provinceLabel', () => {
  it('spells out the code, and passes an unknown one through', () => {
    expect(provinceLabel('KZN')).toBe('KwaZulu-Natal')
    expect(provinceLabel('XX')).toBe('XX')
    expect(provinceLabel(null)).toBe('Province not recorded')
  })
})

describe('displayLicenseeName', () => {
  it('turns a capitalised name into title case with small words lower', () => {
    expect(displayLicenseeName('CITY OF SAMPLEVILLE')).toBe('City of Sampleville')
    expect(displayLicenseeName('SAMPLE (NORTH)')).toBe('Sample (North)')
    expect(displayLicenseeName('!XAM HILLS')).toBe('!Xam Hills')
    expect(displayLicenseeName("O'SAMPLE")).toBe("O'Sample")
  })
  it('keeps initials and mixed-case names as written', () => {
    expect(displayLicenseeName('JB SAMPLE')).toBe('JB Sample')
    expect(displayLicenseeName('SAMPLETOWN EC')).toBe('Sampletown EC')
    expect(displayLicenseeName('Eskom (Local Authority tariffs)')).toBe('Eskom (Local Authority tariffs)')
  })
})
