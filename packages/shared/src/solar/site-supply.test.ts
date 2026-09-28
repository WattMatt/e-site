import { describe, it, expect } from 'vitest'
import { EMPTY_SITE_SUPPLY_FORM, validateSiteSupply, siteSupplyFormFromRow, type SiteSupplyForm } from './site-supply'

const form = (patch: Partial<SiteSupplyForm>): SiteSupplyForm => ({ ...EMPTY_SITE_SUPPLY_FORM, ...patch })

describe('validateSiteSupply', () => {
  it('an empty form is valid and saves all NULLs', () => {
    const r = validateSiteSupply(EMPTY_SITE_SUPPLY_FORM)
    expect(r.errors).toEqual({})
    expect(r.values).toEqual({
      latitude: null, longitude: null, elevation_m: null, licensee_name: null, supply_type: null,
      nmd_kva: null, supply_voltage_v: null, poc_node_id: null, export_mode: null, export_limit_kw: null,
      constraints_note: null,
    })
  })

  it('parses and rounds numbers (6 dp coordinates, comma decimals accepted)', () => {
    const r = validateSiteSupply(form({ latitude: '-26,1234567', longitude: '28.0473051', nmdKva: '500.456', elevationM: '1753.46' }))
    expect(r.errors).toEqual({})
    expect(r.values).toMatchObject({ latitude: -26.123457, longitude: 28.047305, nmd_kva: 500.46, elevation_m: 1753.5 })
  })

  it('refuses non-numbers and out-of-range coordinates', () => {
    const r = validateSiteSupply(form({ latitude: 'abc', longitude: '200' }))
    expect(r.errors.latitude).toBe('Enter a number')
    expect(r.errors.longitude).toBe('Longitude must be between -180 and 180')
  })

  it('needs both coordinates or neither', () => {
    expect(validateSiteSupply(form({ latitude: '-26' })).errors.longitude).toBe('Enter both latitude and longitude')
    expect(validateSiteSupply(form({ longitude: '28' })).errors.latitude).toBe('Enter both latitude and longitude')
  })

  it('warns — does not block — outside South Africa', () => {
    const r = validateSiteSupply(form({ latitude: '26', longitude: '28' }))
    expect(r.errors).toEqual({})
    expect(r.warnings.latitude).toBe('These coordinates are outside South Africa (latitude -35 to -22, longitude 16 to 33) — check the signs.')
  })

  it('NMD must be positive; voltage must be whole volts', () => {
    const r = validateSiteSupply(form({ nmdKva: '0', supplyVoltageV: '400.5' }))
    expect(r.errors.nmdKva).toBe('NMD must be more than 0 kVA')
    expect(r.errors.supplyVoltageV).toBe('Enter the supply voltage in whole volts')
  })

  it('only known customer types and export modes', () => {
    const r = validateSiteSupply(form({ supplyType: 'bartering', exportMode: 'sometimes' }))
    expect(r.errors.supplyType).toBe('Choose a customer type')
    expect(r.errors.exportMode).toBe('Choose whether export is allowed')
  })

  it('the export limit is kept only when export is allowed', () => {
    expect(validateSiteSupply(form({ exportMode: 'net_billing', exportLimitKw: '90' })).values.export_limit_kw).toBe(90)
    expect(validateSiteSupply(form({ exportMode: 'zero_export', exportLimitKw: '90' })).values.export_limit_kw).toBeNull()
    expect(validateSiteSupply(form({ exportMode: 'no_credit', exportLimitKw: '-1' })).errors.exportLimitKw).toBe('Export limit cannot be negative')
  })

  it('trims text and caps its length', () => {
    expect(validateSiteSupply(form({ licenseeName: '  City Power  ' })).values.licensee_name).toBe('City Power')
    expect(validateSiteSupply(form({ licenseeName: 'x'.repeat(201) })).errors.licenseeName).toBe('Keep the supply authority under 200 characters')
    expect(validateSiteSupply(form({ constraintsNote: 'x'.repeat(5001) })).errors.constraintsNote).toBe('Keep the notes under 5000 characters')
  })

  it('elevation must be plausible', () => {
    expect(validateSiteSupply(form({ elevationM: '12000' })).errors.elevationM).toBe('Elevation must be between -500 m and 9000 m')
  })
})

describe('siteSupplyFormFromRow', () => {
  it('turns a studies row into form strings and NULLs into empty strings', () => {
    expect(siteSupplyFormFromRow({ latitude: -26.1, longitude: '28.05', nmd_kva: '500.00', supply_voltage_v: 400, supply_type: 'municipal', licensee_name: null })).toEqual({
      ...EMPTY_SITE_SUPPLY_FORM, latitude: '-26.1', longitude: '28.05', nmdKva: '500', supplyVoltageV: '400', supplyType: 'municipal',
    })
    expect(siteSupplyFormFromRow(null)).toEqual(EMPTY_SITE_SUPPLY_FORM)
  })
})
