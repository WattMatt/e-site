import { describe, it, expect } from 'vitest'
import { voltageBandsFor, eligibilityReasons, groupTariffs, type TariffListItem } from './eligibility'

const t = (p: Partial<TariffListItem>): TariffListItem => ({
  id: p.name ?? 'x', code: null, name: 'Tariff', category: 'commercial', metering: 'conventional', structure: 'tou',
  voltageBand: null, phase: null, minKva: null, maxKva: null, minAmps: null, maxAmps: null, isLegacy: false,
  exportTariffId: null, ...p,
})

describe('voltageBandsFor', () => {
  it('maps a supply voltage to every Eskom band containing it', () => {
    expect(voltageBandsFor(400)).toEqual(['lt_500v'])
    expect(voltageBandsFor(11000)).toEqual(['500v_22kv', '500v_66kv'])
    expect(voltageBandsFor(33000)).toEqual(['500v_66kv'])
    expect(voltageBandsFor(132000)).toEqual(['66kv_132kv'])
    expect(voltageBandsFor(275000)).toEqual(['gt_132kv'])
    expect(voltageBandsFor(null)).toBeNull()
  })
})

describe('eligibilityReasons', () => {
  const supply = { nmdKva: 500, supplyVoltageV: 11000 }
  it('eligible when NMD and voltage fit', () => {
    expect(eligibilityReasons(t({ minKva: 100, maxKva: 1000, voltageBand: '500v_22kv' }), supply)).toEqual([])
  })
  it('names the NMD limit it breaks', () => {
    expect(eligibilityReasons(t({ maxKva: 100 }), supply)).toEqual(['NMD 500 kVA is above the 100 kVA maximum'])
    expect(eligibilityReasons(t({ minKva: 1000 }), supply)).toEqual(['NMD 500 kVA is below the 1000 kVA minimum'])
  })
  it('names a voltage mismatch, but never excludes on an unknown band string', () => {
    expect(eligibilityReasons(t({ voltageBand: 'lt_500v' }), supply)).toEqual(['Supply at 11 kV is outside this tariff\'s voltage band'])
    expect(eligibilityReasons(t({ voltageBand: 'LV three phase' }), supply)).toEqual([])
  })
  it('legacy and export tariffs are never offered as the supply tariff by default', () => {
    expect(eligibilityReasons(t({ isLegacy: true }), supply)).toEqual(['Legacy tariff (closed to new customers)'])
    expect(eligibilityReasons(t({ category: 'sseg' }), supply)).toEqual(['Export (SSEG) tariff: applied through the export rule'])
  })
  it('unknown NMD or voltage excludes nothing', () => {
    expect(eligibilityReasons(t({ maxKva: 1, voltageBand: 'gt_132kv' }), { nmdKva: null, supplyVoltageV: null })).toEqual([])
  })
})

describe('groupTariffs', () => {
  const items = [
    t({ id: 'a', name: 'Megaflex', category: 'industrial', minKva: 1000 }),
    t({ id: 'b', name: 'Miniflex', category: 'commercial', maxKva: 5000 }),
    t({ id: 'c', name: 'Businessrate', category: 'commercial', structure: 'flat', maxKva: 100 }),
    t({ id: 'd', name: 'Homeflex', category: 'domestic', metering: 'prepaid', phase: 'single' }),
  ]
  const supply = { nmdKva: 500, supplyVoltageV: 400 }
  it('shows only eligible tariffs by default, grouped in category order, with a hidden count', () => {
    const g = groupTariffs(items, { supply, showAll: false, query: '', metering: null, phase: null })
    expect(g.groups.map((x) => [x.category, x.tariffs.map((y) => y.id)])).toEqual([['domestic', ['d']], ['commercial', ['b']]])
    expect(g.hiddenCount).toBe(2)
  })
  it('Show all lists the ineligible ones with their reasons', () => {
    const g = groupTariffs(items, { supply, showAll: true, query: '', metering: null, phase: null })
    const mega = g.groups.flatMap((x) => x.tariffs).find((x) => x.id === 'a')!
    expect(mega.eligible).toBe(false)
    expect(mega.reasons).toEqual(['NMD 500 kVA is below the 1000 kVA minimum'])
    expect(g.hiddenCount).toBe(0)
  })
  it('filters by search text, metering and phase', () => {
    expect(groupTariffs(items, { supply, showAll: true, query: 'flex', metering: null, phase: null }).groups.flatMap((x) => x.tariffs).map((x) => x.id).sort()).toEqual(['a', 'b', 'd'])
    expect(groupTariffs(items, { supply, showAll: true, query: '', metering: 'prepaid', phase: null }).groups.flatMap((x) => x.tariffs).map((x) => x.id)).toEqual(['d'])
    expect(groupTariffs(items, { supply, showAll: true, query: '', metering: null, phase: 'three' }).groups.flatMap((x) => x.tariffs).map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
