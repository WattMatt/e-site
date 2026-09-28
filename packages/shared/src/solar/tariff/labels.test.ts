import { describe, it, expect } from 'vitest'
import { UNIT_LABELS, COMPONENT_LABELS, TARIFF_CATEGORY_LABELS, formatRandAmount, formatChargeAmount, TOU_LABELS, SEASON_LABELS } from './labels'
import { TARIFF_UNITS, CHARGE_COMPONENTS, TARIFF_CATEGORIES } from '../../tariffs/types'

describe('tariff labels', () => {
  it('labels every stored unit and component (no raw enum reaches the screen)', () => {
    for (const u of TARIFF_UNITS) expect(UNIT_LABELS[u]).toBeTruthy()
    for (const c of CHARGE_COMPONENTS) expect(COMPONENT_LABELS[c]).toBeTruthy()
    for (const c of TARIFF_CATEGORIES) expect(TARIFF_CATEGORY_LABELS[c]).toBeTruthy()
    expect(TOU_LABELS.off_peak).toBe('Off-peak')
    expect(SEASON_LABELS.high).toBe('High demand (winter)')
  })
  it('formats rand with two decimals and comma thousands, never locale-dependent', () => {
    expect(formatRandAmount(3000)).toBe('R3,000.00')
    expect(formatRandAmount(1234567.891)).toBe('R1,234,567.89')
    expect(formatRandAmount(-12.5)).toBe('-R12.50')
    expect(formatRandAmount(0)).toBe('R0.00')
  })
  it('formats a charge amount with its unit', () => {
    expect(formatChargeAmount(250, 'c_per_kWh')).toBe('250.00 c/kWh')
    expect(formatChargeAmount(1.8423, 'R_per_kWh')).toBe('R1.8423/kWh')
    expect(formatChargeAmount(400, 'R_per_month')).toBe('R400.00/month')
    expect(formatChargeAmount(12.5, 'pct')).toBe('12.50 %')
  })
})
