import { describe, expect, it } from 'vitest'
import { meterKindFromLabel, profileComposition, roleOfKind } from './roles'

describe('meterKindFromLabel', () => {
  it.each([
    ['SOLAR PLANT 240', 'solar'], ['Solar PV1', 'solar'], ['GENERATOR METER', 'generator'], ['CHECK 1', 'check'],
    ['BULK METER', 'bulk'], ['LOCAL MAIN', 'bulk'], ['MS - 1', 'unknown'], ['MDB - 1.1', 'unknown'], ['Bulk Meter · Mini Sub - 1', 'unknown'], ['Kiosk 3', 'unknown'], ['SHOP 107 VACANT', 'vacant'], ['Meter 36339844', 'unknown'],
    ['E9001', 'unknown'], ['DB-26', 'unknown'], ['TENANT-23', 'tenant'], ['Common Area Lights', 'common'], [null, 'unknown'],
  ] as const)('%s → %s', (label, kind) => expect(meterKindFromLabel(label)).toBe(kind))
  it('several serials make a virtual meter', () => expect(meterKindFromLabel('LOCAL MAIN', 3)).toBe('virtual'))
  it('kinds map to default roles', () => {
    expect(['bulk', 'council', 'virtual', 'check', 'solar', 'generator', 'tenant', 'common', 'vacant', 'unknown'].map((k) => roleOfKind(k as never)))
      .toEqual(['bulk', 'bulk', 'submain', 'check', 'solar', 'generator', 'tenant', 'tenant', 'tenant', 'submain'])
  })
})

describe('profileComposition', () => {
  it('bulk present: bulk + additions; tenants are inside the bulk supply and NOT added again', () => {
    const c = profileComposition(['tenant', 'bulk', 'tenant', 'check', 'addition', 'solar'])
    expect(c.sum).toEqual([1, 4])
    expect(c.basis).toBe('bulk')
    expect(c.note).toBe('The profile is the bulk meter plus additions; 2 tenant sources are inside the bulk supply and not added again. 2 check, sub-supply, solar or generator sources are shown but not added.')
  })
  it('no bulk: the tenants + additions', () => {
    expect(profileComposition(['tenant', 'tenant', 'generator', 'addition'])).toMatchObject({ sum: [0, 1, 3], basis: 'tenants' })
  })
  it('additions only, and nothing summable', () => {
    expect(profileComposition(['addition'])).toMatchObject({ sum: [0], basis: 'additions_only' })
    expect(profileComposition(['check', 'solar'])).toMatchObject({ sum: [], basis: 'none' })
  })
  it('a submain is shown, never added', () => {
    expect(profileComposition(['submain', 'tenant'])).toMatchObject({ sum: [1], basis: 'tenants' })
  })
})
