import { describe, it, expect } from 'vitest'
import {
  SOLAR_SETTING_FIELDS, SOLAR_ORG_SETTINGS_VERSION, solarOrgSettingDefaults, readSolarOrgSettings,
  solarSettingsToForm, validateSolarOrgSettings,
} from './org-settings'

describe('Solar org settings', () => {
  it('seeds the decided defaults (D-05, D-07, D-16 and the engine defaults table)', () => {
    const d = solarOrgSettingDefaults()
    expect(d).toMatchObject({
      discount_rate_pct: 11, cpi_pct: 5, escalation_start_pct: 9, escalation_year10_pct: 7,
      escalation_after_cpi_plus_pct: 1, analysis_years: 25, section_12b_default: false,
      // Owner default 5 (2026-09-28): SA company tax rate 27 %, 12B toggle off.
      tax_rate_pct: 27,
      om_r_per_kwp_yr: 150, insurance_pct_of_capex: 0.5,
      inverter_replacement_year: 12, inverter_replacement_pct: 60, battery_replacement_year: 10, battery_replacement_pct: 50,
      soiling_pct: 2, mismatch_pct: 1, dc_wiring_pct: 1.5, ac_wiring_pct: 1, lid_pct: 1.5, availability_pct: 99,
      albedo: 0.2, degradation_first_year_pct: 2, degradation_annual_pct: 0.5,
    })
    expect(SOLAR_ORG_SETTINGS_VERSION).toBe(1)
    expect(new Set(SOLAR_SETTING_FIELDS.map((f) => f.key)).size).toBe(SOLAR_SETTING_FIELDS.length)
  })

  it('reads stored values over the defaults and ignores junk', () => {
    const v = readSolarOrgSettings({ version: 1, values: { discount_rate_pct: 12, cpi_pct: 'x', unknown_key: 5, section_12b_default: true, tax_rate_pct: 28 } })
    expect(v.discount_rate_pct).toBe(12)
    expect(v.cpi_pct).toBe(5)
    expect(v.section_12b_default).toBe(true)
    expect(v.tax_rate_pct).toBe(28)
    expect('unknown_key' in v).toBe(false)
    expect(readSolarOrgSettings(null)).toEqual(solarOrgSettingDefaults())
  })

  it('round-trips through form strings', () => {
    const form = solarSettingsToForm(solarOrgSettingDefaults())
    expect(form.discount_rate_pct).toBe('11')
    expect(form.tax_rate_pct).toBe('27')
    expect(form.section_12b_default).toBe(false)
    expect(validateSolarOrgSettings(form)).toEqual({ values: solarOrgSettingDefaults(), errors: {} })
  })

  it('refuses non-numbers, out-of-range values and unknown keys', () => {
    const form = solarSettingsToForm(solarOrgSettingDefaults())
    const r = validateSolarOrgSettings({ ...form, discount_rate_pct: 'lots', availability_pct: '101', albedo: '0,25', bogus: '1' })
    expect(r.errors.discount_rate_pct).toBe('Enter a number')
    expect(r.errors.availability_pct).toBe('Must be between 50 and 100 %')
    expect(r.errors.bogus).toBe('Unknown setting')
    expect(r.values.albedo).toBe(0.25)
  })

  it('an emptied field is saved as not set (null)', () => {
    const form = solarSettingsToForm(solarOrgSettingDefaults())
    expect(validateSolarOrgSettings({ ...form, om_r_per_kwp_yr: '' }).values.om_r_per_kwp_yr).toBeNull()
  })
})
