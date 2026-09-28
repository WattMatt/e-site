import { describe, expect, it } from 'vitest'
import { cleanLabel, detectCategory, detectComponent, detectMetering, detectPhase, detectSeason, detectTou, labelUnit, voltageBandFromText } from './labels'

describe('cleanLabel', () => {
  it('strips bullets and collapses whitespace', () => {
    expect(cleanLabel('o   Basic charge: R168.81/day')).toBe('Basic charge: R168.81/day')
    expect(cleanLabel('§  Peak: 610.75c/kWh')).toBe('Peak: 610.75c/kWh')
    expect(cleanLabel('Ø       Network      capacity      charge:      R0.00A/kVA\nNMD/Month')).toBe('Network capacity charge: R0.00A/kVA NMD/Month')
    expect(cleanLabel('·       Large User Low Voltage Time of Use')).toBe('Large User Low Voltage Time of Use')
    expect(cleanLabel('Off-peak')).toBe('Off-peak')
  })
})

describe('season and TOU', () => {
  it.each([
    ['Summer Energy Charges', 'low'], ['Winter Energy Charge', 'high'], ['o Low Season', 'low'],
    ['High demand season [Jun - Aug]', 'high'], ['Low Demand (Sept - May) - Peak', 'low'],
    ['All season Demand Charge (R/kVA)', 'all'], ['All seasons', 'all'], ['Service Charge (R/month)', null],
    ['Conventional Normal meter-per kWh(single phase)summer tariff', 'low'],
  ] as const)('%s -> %s', (label, season) => expect(detectSeason(label)).toBe(season))
  it('reads off-peak before peak', () => {
    expect(detectTou('Off-peak')).toBe('off_peak')
    expect(detectTou('Off Peak')).toBe('off_peak')
    expect(detectTou('Peak(R/kWh):')).toBe('peak')
    expect(detectTou('Standard (R/kWh):')).toBe('standard')
    expect(detectTou('Summer Energy Charges')).toBeNull()
  })
})

describe('labelUnit', () => {
  it.each([
    ['Service Charge (R/month)', 'R_per_month'],
    ['All season Demand Charge (c/kVArh)', 'c_per_kVArh'],
    ['Basic Charge -  R/month', 'R_per_month'],
    ['Energy Charges - c/kWh', 'c_per_kWh'],
    ['BASIC LEVY - PER MONTH', 'R_per_month'],
    ['Block 1 (0-350kWh)', null],
    ['Large Power Users (80kVA up to 150kVA Commercial / Industrial) , Min 100A,', null],
    ['Residential Time of Use (<=80A)', null],
  ] as const)('%s -> %s', (label, unit) => expect(labelUnit(label)).toBe(unit))
})

describe('detectComponent', () => {
  it.each([
    ['All season Demand Charge (c/kVArh)', 'c_per_kVArh', null, 'reactive'],
    ['Wheeling Charge', null, null, 'wheeling_uos'],
    ['Network capacity charge', 'R_per_kVA_month', null, 'network_capacity'],
    ['Capacity Charge (R/month)', 'R_per_month', null, 'network_capacity'],
    ['Network demand charge [c/kWh]', 'c_per_kWh', null, 'network_demand'],
    ['Generation capacity charge [R/POD/day]', 'R_per_POD_day', null, 'gcc'],
    ['Ancillary service charge [c/kWh]', 'c_per_kWh', null, 'ancillary'],
    ["'Service and administration charge [R/POD/day]", 'R_per_POD_day', null, 'service'],
    ['Electrification and rural network subsidy charge [c/kWh]', 'c_per_kWh', null, 'ers'],
    ['Demand charge', 'R_per_kVA_month', null, 'demand'],
    ['Basic charge', 'R_per_day', null, 'basic'],
    ['Peak', 'c_per_kWh', null, 'energy'],
    ['Block 1 (0-350kWh)', null, null, 'energy'],
    ['Single Phase (Conventional Meters)', null, 'basic', 'basic'],
    ['Active energy charge [c/kWh]', 'c_per_kWh', 'export_credit', 'export_credit'],
    ['Urban low voltage subsidy charge [R/kVA/m]', 'R_per_kVA_month', null, 'lv_subsidy'],
    ['Peak demand charge', null, null, 'demand'],
  ] as const)('%s', (label, unit, hint, component) => expect(detectComponent(label, unit, hint)).toBe(component))
})

describe('category, metering, phase, voltage', () => {
  it('classifies', () => {
    expect(detectCategory('16. SSEG (New)')).toBe('sseg')
    expect(detectCategory('Gen-Offset Homeflex')).toBe('sseg')
    expect(detectCategory('Industrial LV (TOU)')).toBe('industrial')
    expect(detectCategory('Residential Single Phase 60A')).toBe('domestic')
    expect(detectCategory('Businessrate')).toBe('commercial')
    expect(detectMetering('Domestic Prepaid & Conventional')).toBe('both')
    expect(detectMetering('Residential Prepaid Low')).toBe('prepaid')
    expect(detectPhase('Commercial Three Phase Prepaid')).toBe('three')
    expect(voltageBandFromText('< 500V')).toBe('lt_500v')
    expect(voltageBandFromText('≥ 500V & < 66kV')).toBe('500v_66kv')
    expect(voltageBandFromText('> 132kV/Transmission connected')).toBe('gt_132kv')
  })
})
