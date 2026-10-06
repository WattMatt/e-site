import { describe, expect, it } from 'vitest'
import { areaSupply, supplyByCode, type MapLicensee } from './supply-status'

const L = (p: Partial<MapLicensee> & Pick<MapLicensee, 'id'>): MapLicensee => ({ name: p.id.toUpperCase(), kind: 'municipal', mdbCode: null, liveFy: null, hasAnyYear: false, ...p })

describe('supply status by MDB code', () => {
  const map = supplyByCode([
    L({ id: 'buf', mdbCode: 'BUF', liveFy: '2026/27', hasAnyYear: true }),
    L({ id: 'ec136', mdbCode: 'EC136', hasAnyYear: true }),
    L({ id: 'nocode', liveFy: '2026/27', hasAnyYear: true }),
    L({ id: 'empty', mdbCode: 'NC087' }),
  ])
  it('a licensee with a published year is "published"', () => {
    expect(areaSupply('BUF', map)).toEqual({ status: 'published', licensee: { id: 'buf', name: 'BUF', liveFy: '2026/27' } })
  })
  it('a licensee with years still in review is "in_review"', () => {
    expect(areaSupply('EC136', map).status).toBe('in_review')
  })
  it('a licensee with no year at all is "no_tariffs"', () => {
    expect(areaSupply('NC087', map).status).toBe('no_tariffs')
  })
  it('a municipality no licensee claims is "no_licensee", and codes compare case-insensitively', () => {
    expect(areaSupply('WC011', map)).toEqual({ status: 'no_licensee', licensee: null })
    expect(areaSupply('buf', map).status).toBe('published')
  })
})
