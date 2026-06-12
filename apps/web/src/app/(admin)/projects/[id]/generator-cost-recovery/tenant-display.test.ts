import { describe, it, expect } from 'vitest'
import {
  toDisplayTenant, matchesFilter, filterCounts, needsSetup, isConfigured, zoneCoverage,
  type DisplayTenant, type TenantFilter,
} from './tenant-display'
import { DEFAULT_GENERATOR_SETTINGS } from '@esite/shared'

const base: DisplayTenant = {
  id: 't1', shop_number: 'T01', shop_name: 'Alpha', shop_area_m2: 100,
  category: 'standard', participation: 'shared', zoneId: 'z1', manualKwOverride: null,
}

describe('toDisplayTenant', () => {
  it('overlays a pending patch on server truth', () => {
    const t = toDisplayTenant(
      { id: 't1', shop_number: 'T01', shop_name: 'Alpha', shop_area_m2: 100, shop_category: 'standard', generator_participation: 'shared' },
      { node_id: 't1', zone_id: 'z1', manual_kw_override: null },
      { zone_id: null, participation: 'own' },
    )
    expect(t.zoneId).toBeNull()          // patched
    expect(t.participation).toBe('own')  // patched
    expect(t.category).toBe('standard')  // server
  })

  it('normalises an unknown server category to null', () => {
    const t = toDisplayTenant(
      { id: 't1', shop_number: 'T01', shop_name: 'Alpha', shop_area_m2: 100, shop_category: 'garbage' as never, generator_participation: 'shared' },
      undefined,
      undefined,
    )
    expect(t.category).toBeNull()
  })
})

describe('matchesFilter / filterCounts', () => {
  const tenants: DisplayTenant[] = [
    base,
    { ...base, id: 't2', zoneId: null },
    { ...base, id: 't3', category: null },
    { ...base, id: 't4', participation: 'own', zoneId: null },
  ]
  it('no_zone counts only participating shops without a zone', () => {
    expect(tenants.filter((t) => matchesFilter(t, 'no_zone')).map((t) => t.id)).toEqual(['t2'])
  })
  it('uncategorized / opted_out / zone filters', () => {
    expect(tenants.filter((t) => matchesFilter(t, 'uncategorized')).map((t) => t.id)).toEqual(['t3'])
    expect(tenants.filter((t) => matchesFilter(t, 'opted_out')).map((t) => t.id)).toEqual(['t4'])
    expect(tenants.filter((t) => matchesFilter(t, { zoneId: 'z1' })).map((t) => t.id)).toEqual(['t1', 't3'])
  })
  it('counts agree with predicates', () => {
    const c = filterCounts(tenants)
    expect(c).toEqual({ all: 4, no_zone: 1, uncategorized: 1, opted_out: 1, byZone: { z1: 2 } })
  })

  it('byZone counts zone members regardless of participation (table filter semantics, distinct from coverage)', () => {
    const optedOutInZone: DisplayTenant = { ...base, id: 't9', participation: 'own' }
    expect(filterCounts([base, optedOutInZone]).byZone).toEqual({ z1: 2 })
  })
})

describe('needsSetup / isConfigured', () => {
  it('shared shop without zone or category needs setup', () => {
    expect(needsSetup({ ...base, zoneId: null })).toBe(true)
    expect(needsSetup({ ...base, category: null })).toBe(true)
    expect(needsSetup(base)).toBe(false)
    expect(needsSetup({ ...base, participation: 'none', zoneId: null })).toBe(false)
  })
  it('configured = categorised AND (zoned OR opted out)', () => {
    expect(isConfigured(base)).toBe(true)
    expect(isConfigured({ ...base, zoneId: null })).toBe(false)
    expect(isConfigured({ ...base, zoneId: null, participation: 'own' })).toBe(true)
    expect(isConfigured({ ...base, category: null })).toBe(false)
  })
})

describe('zoneCoverage', () => {
  it('sums kW per zone and parses capacity only when every size parses', () => {
    const zones = [{ id: 'z1', zone_name: 'North', zone_number: 1 }] as never
    const gens  = [{ id: 'g1', zone_id: 'z1', generator_number: 1, generator_size: '250', generator_cost: 0 }] as never
    const cov = zoneCoverage([base, { ...base, id: 't2', shop_area_m2: 200 }], zones, gens, DEFAULT_GENERATOR_SETTINGS)
    expect(cov.perZone).toHaveLength(1)
    expect(cov.perZone[0].shopCount).toBe(2)
    expect(cov.perZone[0].totalKw).toBeGreaterThan(0)
    expect(cov.perZone[0].installedKva).toBe(250)
    expect(cov.configured).toBe(2)
    expect(cov.total).toBe(2)
  })
  it('omits capacity when a size does not parse', () => {
    const zones = [{ id: 'z1', zone_name: 'North', zone_number: 1 }] as never
    const gens  = [{ id: 'g1', zone_id: 'z1', generator_number: 1, generator_size: 'two-fifty', generator_cost: 0 }] as never
    const cov = zoneCoverage([base], zones, gens, DEFAULT_GENERATOR_SETTINGS)
    expect(cov.perZone[0].installedKva).toBeNull()
  })
})
